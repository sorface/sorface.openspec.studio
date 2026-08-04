package repository

import (
	"context"
	"encoding/json"
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
	if err := os.MkdirAll(storeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	runGit(t, root, "init", source)
	runGit(t, source, "config", "user.email", "test@example.com")
	runGit(t, source, "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(source, "README.md"), []byte("arbitrary repository\n"), 0o600); err != nil {
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
	if _, err := service.inspect(projectItem, remote, target); err != nil {
		t.Fatalf("arbitrary repository rejected: %v", err)
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
	if _, err := os.Stat(secondTarget); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unpersisted managed clone must be removed, err=%v", err)
	}
	_ = time.Second
}

func TestContextRepositoryImport(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := t.TempDir()
	projectsRoot := filepath.Join(root, "projects")
	storeRoot := filepath.Join(projectsRoot, "project-space", "store")
	if err := os.MkdirAll(storeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	runGit(t, root, "init", source)
	runGit(t, source, "config", "user.email", "test@example.com")
	runGit(t, source, "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(source, "README.md"), []byte("context\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, source, "add", ".")
	runGit(t, source, "commit", "-m", "context")
	remote := filepath.Join(root, "context.git")
	runGit(t, root, "clone", "--bare", source, remote)

	db, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	projectItem, err := db.Create(context.Background(), project.CreateInput{Name: "Demo", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(db, processrunner.NewSupervisor(), projectsRoot)
	summary := service.ImportContext(context.Background(), projectItem, []string{remote, filepath.Join(root, "missing.git")})
	if summary.Imported != 1 || len(summary.Failures) != 1 || summary.Failures[0].Code != "GIT_CLONE_FAILED" {
		t.Fatalf("unexpected import summary: %#v", summary)
	}
	links, err := db.ListRepositories(context.Background(), projectItem.ID)
	if err != nil || len(links) != 1 || !links[0].ReadOnlyForAI || links[0].RemoteURL != remote {
		t.Fatalf("unexpected links: %#v err=%v", links, err)
	}
}

func TestContextRepositorySwitchesExistingBranchAndFastForwardsUpdate(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := t.TempDir()
	projectsRoot := filepath.Join(root, "projects")
	storeRoot := filepath.Join(projectsRoot, "project-space", "store")
	if err := os.MkdirAll(storeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	runGit(t, root, "init", "-b", "main", source)
	runGit(t, source, "config", "user.email", "test@example.com")
	runGit(t, source, "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(source, "README.md"), []byte("main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, source, "add", ".")
	runGit(t, source, "commit", "-m", "main")
	runGit(t, source, "switch", "-c", "feature/context")
	if err := os.WriteFile(filepath.Join(source, "feature.md"), []byte("first\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, source, "add", ".")
	runGit(t, source, "commit", "-m", "feature")
	runGit(t, source, "switch", "main")
	remote := filepath.Join(root, "context.git")
	runGit(t, root, "clone", "--bare", source, remote)

	db, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	projectItem, err := db.Create(context.Background(), project.CreateInput{Name: "Demo", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(db, processrunner.NewSupervisor(), projectsRoot)
	if summary := service.ImportContext(context.Background(), projectItem, []string{remote}); summary.Imported != 1 {
		t.Fatalf("unexpected import summary: %#v", summary)
	}
	items, err := service.List(context.Background(), projectItem.ID)
	if err != nil || len(items) != 1 || !contains(items[0].RemoteBranches, "origin/feature/context") || contains(items[0].RemoteBranches, "origin") {
		t.Fatalf("unexpected live repository: %#v err=%v", items, err)
	}
	switched, err := service.SwitchBranch(context.Background(), projectItem.ID, items[0].ID, SwitchBranchInput{
		Branch: "origin/feature/context", Remote: true,
	})
	if err != nil || switched.Branch != "feature/context" || switched.Upstream != "origin/feature/context" {
		t.Fatalf("switch result=%#v err=%v", switched, err)
	}
	previousHead := switched.CommitSHA

	runGit(t, source, "switch", "feature/context")
	if err := os.WriteFile(filepath.Join(source, "feature.md"), []byte("second\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, source, "add", ".")
	runGit(t, source, "commit", "-m", "update feature")
	runGit(t, source, "push", remote, "feature/context")
	updated, err := service.Update(context.Background(), projectItem.ID, items[0].ID)
	if err != nil || updated.CommitSHA == previousHead || updated.Behind != 0 {
		t.Fatalf("update result=%#v err=%v", updated, err)
	}
	content, err := os.ReadFile(filepath.Join(updated.Path, "feature.md"))
	if err != nil || string(content) != "second\n" {
		t.Fatalf("updated content=%q err=%v", content, err)
	}
	if err := os.WriteFile(filepath.Join(updated.Path, "local.txt"), []byte("dirty"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SwitchBranch(context.Background(), projectItem.ID, items[0].ID, SwitchBranchInput{Branch: "main"}); !errors.Is(err, ErrWorktreeDirty) {
		t.Fatalf("expected dirty switch rejection, got %v", err)
	}
	if _, err := service.Update(context.Background(), projectItem.ID, items[0].ID); !errors.Is(err, ErrWorktreeDirty) {
		t.Fatalf("expected dirty update rejection, got %v", err)
	}
}

func TestValidateContextRepositories(t *testing.T) {
	service := NewService(nil, processrunner.NewSupervisor())
	values, err := service.ValidateContextRepositories([]string{
		" git@example.com:team/one.git ",
		"git@example.com:team/one.git",
		"ssh://git@example.com/team/two.git",
	})
	if err != nil || len(values) != 2 || values[0] != "git@example.com:team/one.git" {
		t.Fatalf("unexpected normalized URLs: %#v err=%v", values, err)
	}
	if _, err := service.ValidateContextRepositories([]string{"--upload-pack=evil"}); !errors.Is(err, project.ErrInvalidContextRepositoryURL) {
		t.Fatalf("expected context URL error, got %v", err)
	}
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
	managedRoot := filepath.Join(root, "projects")
	service := NewService(db, supervisor, managedRoot)
	service.gitPath = fake
	item, err := service.StartClone(context.Background(), projectItem.ID, CloneInput{
		URL: "https://example.test/code.git",
	})
	if err != nil {
		t.Fatal(err)
	}
	var metadata cloneMetadata
	if err := json.Unmarshal([]byte(item.InputJSON), &metadata); err != nil {
		t.Fatal(err)
	}
	target := metadata.TargetPath
	// Package-level parallelism can delay the child process callback on loaded CI hosts.
	// Keep waiting for the observable progress event instead of cancelling on scheduler latency.
	deadline := time.Now().Add(5 * time.Second)
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

func TestProjectRepositoriesRootIsIsolated(t *testing.T) {
	projectsRoot := filepath.Join(t.TempDir(), "projects")
	service := NewService(nil, processrunner.NewSupervisor(), projectsRoot)
	firstStore := filepath.Join(projectsRoot, "first-space", "store")
	secondStore := filepath.Join(projectsRoot, "second-space", "store")
	if err := os.MkdirAll(firstStore, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(secondStore, 0o700); err != nil {
		t.Fatal(err)
	}
	first := service.projectRepositoriesRoot(project.Project{ID: "first", StorePath: firstStore})
	second := service.projectRepositoriesRoot(project.Project{ID: "second", StorePath: secondStore})
	if first == second || filepath.Dir(first) == filepath.Dir(second) {
		t.Fatalf("project repository roots overlap: first=%q second=%q", first, second)
	}
	if filepath.Base(first) != "repositories" || filepath.Base(second) != "repositories" {
		t.Fatalf("unexpected roots: first=%q second=%q", first, second)
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
	code, message := safeCloneError("fatal: https://user:pass@example.test/private")
	if code != "GIT_CLONE_FAILED" || strings.Contains(message, "pass") {
		t.Fatalf("failure leaked credentials: code=%q message=%q", code, message)
	}
}

func TestGitCloneEnvironmentUsesOnlyAgentSocket(t *testing.T) {
	t.Setenv("SSH_AUTH_SOCK", "/tmp/agent.sock")
	t.Setenv("SSH_AGENT_PID", "123")
	t.Setenv("SSH_ASKPASS", "/tmp/askpass")
	environment := gitCloneEnvironment()
	if environment["SSH_AUTH_SOCK"] != "/tmp/agent.sock" || environment["GIT_TERMINAL_PROMPT"] != "0" {
		t.Fatalf("unexpected environment: %#v", environment)
	}
	if _, ok := environment["SSH_AGENT_PID"]; ok {
		t.Fatal("SSH_AGENT_PID must not be passed")
	}
	if _, ok := environment["SSH_ASKPASS"]; ok {
		t.Fatal("SSH_ASKPASS must not be passed")
	}
}

func TestSafeCloneErrorClassification(t *testing.T) {
	tests := []struct {
		stderr string
		code   string
	}{
		{"git@github.com: Permission denied (publickey).", "GIT_AUTH_FAILED"},
		{"fatal: Could not read from remote repository.", "GIT_AUTH_FAILED"},
		{"Host key verification failed.", "SSH_HOST_KEY_FAILED"},
		{"WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!", "SSH_HOST_KEY_FAILED"},
		{"fatal: repository not found", "GIT_REPOSITORY_NOT_FOUND"},
		{"fatal: network failed token=secret", "GIT_CLONE_FAILED"},
	}
	for _, test := range tests {
		code, message := safeCloneError(test.stderr)
		if code != test.code {
			t.Fatalf("%q: code=%q want=%q", test.stderr, code, test.code)
		}
		if strings.Contains(message, "secret") || strings.Contains(message, "github.com") {
			t.Fatalf("unsafe message: %q", message)
		}
	}
}
