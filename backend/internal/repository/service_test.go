package repository

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storage"
)

func TestValidateGitURL(t *testing.T) {
	for _, value := range []string{"https://example.com/a.git", "ssh://git@example.com/a.git", "git@example.com:a.git"} {
		if _, err := ValidateGitURL(value); err != nil {
			t.Fatalf("%s: %v", value, err)
		}
	}
	for _, value := range []string{"", "--upload-pack=evil", "file:///tmp/repo", "https://u:p@example.com/a"} {
		if !errors.Is(mustURL(value), ErrInvalidGitURL) {
			t.Fatalf("expected invalid URL: %q", value)
		}
	}
}

func TestCloneBareRemoteEndToEnd(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, ".openspec-store"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storeRoot, ".openspec-store", "store.yaml"), []byte("store-id: test-store\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	runGit(t, root, "init", source)
	runGit(t, source, "config", "user.email", "test@example.com")
	runGit(t, source, "config", "user.name", "Test")
	if err := os.MkdirAll(filepath.Join(source, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "openspec", "config.yaml"), []byte("store: test-store\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, source, "add", ".")
	runGit(t, source, "commit", "-m", "test")
	remote := filepath.Join(root, "remote.git")
	runGit(t, root, "clone", "--bare", source, remote)

	db, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	projectItem, err := db.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	item, err := db.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindRepositoryClone, Status: operation.StatusQueued, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(db, processrunner.NewSupervisor())
	target := filepath.Join(root, "clone")
	service.runClone(item, projectItem, remote, target, true)
	loaded, err := db.GetOperation(context.Background(), item.ID)
	if err != nil || loaded.Status != operation.StatusCompleted {
		t.Fatalf("operation=%#v err=%v", loaded, err)
	}
	links, err := db.ListRepositories(context.Background(), projectItem.ID)
	if err != nil || len(links) != 1 || links[0].CommitSHA == "" {
		t.Fatalf("links=%#v err=%v", links, err)
	}
	if err := os.WriteFile(filepath.Join(target, "openspec", "config.yaml"), []byte("store: another-store\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.inspect(projectItem, remote, target); !errors.Is(err, ErrStoreMismatch) {
		t.Fatalf("expected mismatch, got %v", err)
	}
	failing := &failingRepositoryStore{SQLite: db}
	failingService := NewService(failing, processrunner.NewSupervisor())
	second, err := db.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindRepositoryClone, Status: operation.StatusQueued, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	secondTarget := filepath.Join(root, "clone-persistence-failure")
	failingService.runClone(second, projectItem, remote, secondTarget, true)
	second, err = db.GetOperation(context.Background(), second.ID)
	if err != nil || second.ErrorCode != "PERSISTENCE_ERROR" {
		t.Fatalf("persistence operation=%#v err=%v", second, err)
	}
	if _, err := os.Stat(secondTarget); err != nil {
		t.Fatalf("validated clone must be preserved after persistence error: %v", err)
	}
	_ = time.Second
}

type failingRepositoryStore struct {
	*storage.SQLite
}

func (*failingRepositoryStore) CreateRepository(context.Context, operation.RepositoryLink) (operation.RepositoryLink, error) {
	return operation.RepositoryLink{}, errors.New("persistence failed")
}

func TestCloneCancellationRemovesOnlyCreatedTarget(t *testing.T) {
	if testing.Short() {
		t.Skip("process integration")
	}
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(storeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	db, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	projectItem, err := db.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	fake := filepath.Join(root, "git")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\nmkdir -p \"$5\"\necho 'Receiving objects: 10%' >&2\nsleep 10\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	supervisor := processrunner.NewSupervisor()
	service := NewService(db, supervisor)
	service.gitPath = fake
	target := filepath.Join(root, "clone")
	item, err := service.StartClone(context.Background(), projectItem.ID, CloneInput{
		URL: "https://example.test/code.git", TargetPath: target,
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		loaded, _ := db.GetOperation(context.Background(), item.ID)
		events, _ := db.ListEvents(context.Background(), item.ID, 0)
		for _, event := range events {
			if loaded.Status == operation.StatusRunning && event.Type == "progress" {
				deadline = time.Time{}
				break
			}
		}
		if deadline.IsZero() {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := service.Cancel(context.Background(), projectItem.ID, item.ID); err != nil {
		t.Fatal(err)
	}
	events, err := db.ListEvents(context.Background(), item.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	foundProgress := false
	for _, event := range events {
		foundProgress = foundProgress || event.Type == "progress"
	}
	if !foundProgress {
		t.Fatalf("clone progress was not persisted: %#v", events)
	}
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(target); errors.Is(err, os.ErrNotExist) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("created clone target was not removed after cancellation")
}

func runGit(t *testing.T, directory string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
}

func mustURL(value string) error {
	_, err := ValidateGitURL(value)
	return err
}

func TestValidateTarget(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "clone")
	got, created, err := ValidateTarget(target, []string{filepath.Join(root, "store")})
	if err != nil || got != target || !created {
		t.Fatalf("got=%s created=%v err=%v", got, created, err)
	}
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "file"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ValidateTarget(target, nil); !errors.Is(err, ErrTargetNotEmpty) {
		t.Fatalf("expected non-empty error, got %v", err)
	}
}

func TestReadStoreID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("schema: spec-driven\nstore: \"platform\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	value, err := readStoreID(path, "store")
	if err != nil || value != "platform" {
		t.Fatalf("value=%s err=%v", value, err)
	}
	if err := os.WriteFile(path, []byte("store: [invalid\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readStoreID(path, "store"); err == nil {
		t.Fatal("invalid YAML accepted")
	}
	if err := os.WriteFile(path, []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readStoreID(path, "store"); !errors.Is(err, ErrInvalidStore) {
		t.Fatalf("missing store: %v", err)
	}
}

func TestSanitizeProgress(t *testing.T) {
	got := sanitizeProgress("remote: Receiving objects: 42% secret=https://user:pass@example.test")
	if !strings.Contains(got, "Receiving objects: 42%") {
		t.Fatalf("progress not parsed: %q", got)
	}
	if strings.Contains(got, "pass") || strings.Contains(got, "example.test") {
		t.Fatalf("progress leaked credentials: %q", got)
	}
	if got := sanitizeProgress("fatal: https://user:pass@example.test/private"); got != "" {
		t.Fatalf("unsafe diagnostic leaked: %q", got)
	}
	if got := safeMessage("fatal: https://user:pass@example.test/private"); strings.Contains(got, "pass") {
		t.Fatalf("failure message leaked credentials: %q", got)
	}
}
