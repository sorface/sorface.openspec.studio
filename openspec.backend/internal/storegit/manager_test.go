package storegit_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/gitstatus"
	"github.com/sorface/openspec-studio/backend/internal/operation"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storegit"
)

type managerStore struct {
	mu     sync.Mutex
	item   project.Project
	ops    map[string]operation.Operation
	events map[string][]operation.Event
	next   int
}

func newManagerStore(root string) *managerStore {
	return &managerStore{item: project.Project{ID: "project", StorePath: root}, ops: map[string]operation.Operation{}, events: map[string][]operation.Event{}}
}

func (store *managerStore) Get(_ context.Context, id string) (project.Project, error) {
	if id != store.item.ID {
		return project.Project{}, project.ErrNotFound
	}
	return store.item, nil
}

func (store *managerStore) CreateOperation(_ context.Context, item operation.Operation) (operation.Operation, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.next++
	item.ID = string(rune('a' + store.next))
	item.CreatedAt, item.UpdatedAt = time.Now(), time.Now()
	store.ops[item.ID] = item
	return item, nil
}

func (store *managerStore) GetOperation(_ context.Context, id string) (operation.Operation, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	item, ok := store.ops[id]
	if !ok {
		return operation.Operation{}, project.ErrNotFound
	}
	return item, nil
}

func (store *managerStore) UpdateOperation(_ context.Context, item operation.Operation) (operation.Operation, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	item.UpdatedAt = time.Now()
	store.ops[item.ID] = item
	return item, nil
}

func (store *managerStore) HasActiveOperation(_ context.Context, projectID string, kind operation.Kind) (bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, item := range store.ops {
		if item.ProjectID == projectID && item.Kind == kind && !item.Status.Terminal() {
			return true, nil
		}
	}
	return false, nil
}

func (store *managerStore) AddEvent(_ context.Context, event operation.Event) (operation.Event, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	event.Sequence = int64(len(store.events[event.OperationID]) + 1)
	store.events[event.OperationID] = append(store.events[event.OperationID], event)
	return event, nil
}

func (store *managerStore) ListEvents(_ context.Context, id string, after int64) ([]operation.Event, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	result := []operation.Event{}
	for _, event := range store.events[id] {
		if event.Sequence > after {
			result = append(result, event)
		}
	}
	return result, nil
}

func TestManagerStageUnstageCommitAndPathSafety(t *testing.T) {
	root := createManagedStore(t)
	store := newManagerStore(root)
	validator := storegit.NewService()
	status := gitstatus.NewService(store, validator)
	manager := storegit.NewManager(store, processrunner.NewSupervisor(), validator, status)
	if _, err := manager.Stage(context.Background(), "project", storegit.PathsInput{}); !errors.Is(err, storegit.ErrInvalidSelection) {
		t.Fatalf("empty selection err = %v", err)
	}
	writeFile(t, filepath.Join(root, "openspec", "spec.md"), "# Changed\n")
	writeFile(t, filepath.Join(root, "openspec", "new.md"), "# New\n")

	result, err := manager.Stage(context.Background(), "project", storegit.PathsInput{Paths: []string{"openspec/spec.md", "openspec/new.md"}})
	if err != nil || len(result.Changes) != 2 {
		t.Fatalf("stage = %#v, %v", result, err)
	}
	if _, err := manager.Unstage(context.Background(), "project", storegit.PathsInput{Paths: []string{"openspec/new.md"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Commit(context.Background(), "project", storegit.CommitInput{Paths: []string{"openspec/spec.md"}, Message: "wrong", ExpectedHead: result.Head}); !errors.Is(err, storegit.ErrInvalidMessage) {
		t.Fatalf("message err = %v", err)
	}
	if _, err := manager.Commit(context.Background(), "project", storegit.CommitInput{Paths: []string{"openspec/spec.md"}, Message: "", ExpectedHead: result.Head}); !errors.Is(err, storegit.ErrInvalidMessage) {
		t.Fatalf("empty message err = %v", err)
	}
	if _, err := manager.Commit(context.Background(), "project", storegit.CommitInput{Paths: []string{"openspec/spec.md"}, Message: "docs: update spec", ExpectedHead: "stale"}); !errors.Is(err, storegit.ErrHeadChanged) {
		t.Fatalf("head err = %v", err)
	}
	if _, err := manager.Commit(context.Background(), "project", storegit.CommitInput{Paths: []string{"openspec/new.md"}, Message: "docs: update spec", ExpectedHead: result.Head}); !errors.Is(err, storegit.ErrIndexChanged) {
		t.Fatalf("index err = %v", err)
	}
	committed, err := manager.Commit(context.Background(), "project", storegit.CommitInput{Paths: []string{"openspec/spec.md"}, Message: "docs: update spec", ExpectedHead: result.Head})
	if err != nil || committed.Head == result.Head {
		t.Fatalf("commit = %#v, %v", committed, err)
	}
	if err := os.Remove(filepath.Join(root, "openspec", "spec.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Stage(context.Background(), "project", storegit.PathsInput{Paths: []string{"openspec/spec.md"}}); err != nil {
		t.Fatalf("stage deleted path: %v", err)
	}
	if _, err := manager.Unstage(context.Background(), "project", storegit.PathsInput{Paths: []string{"openspec/spec.md"}}); err != nil {
		t.Fatalf("unstage deleted path: %v", err)
	}
	runGit(t, root, "checkout", "--", "openspec/spec.md")
	writeFile(t, filepath.Join(root, "openspec", "spec.md"), "# Hook rejected\n")
	runGit(t, root, "add", "openspec/spec.md")
	hook := filepath.Join(root, ".git", "hooks", "pre-commit")
	writeFile(t, hook, "#!/bin/sh\nexit 1\n")
	if err := os.Chmod(hook, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Commit(context.Background(), "project", storegit.CommitInput{Paths: []string{"openspec/spec.md"}, Message: "docs: rejected by hook", ExpectedHead: committed.Head}); !errors.Is(err, storegit.ErrGitOperation) {
		t.Fatalf("hook err = %v", err)
	}
	if head := gitOutput(t, root, "rev-parse", "HEAD"); head != committed.Head {
		t.Fatalf("hook changed HEAD: %s", head)
	}
	if err := os.Remove(hook); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "reset", "--hard", "HEAD")
	if _, err := manager.Stage(context.Background(), "project", storegit.PathsInput{Paths: []string{"../outside"}}); !errors.Is(err, storegit.ErrInvalidPath) {
		t.Fatalf("traversal err = %v", err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "outside-link")); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Stage(context.Background(), "project", storegit.PathsInput{Paths: []string{"outside-link/file.md"}}); !errors.Is(err, storegit.ErrInvalidPath) {
		t.Fatalf("symlink err = %v", err)
	}
}

func TestManagerBranchesAndRemoteTracking(t *testing.T) {
	root := createManagedStore(t)
	remote := filepath.Join(t.TempDir(), "remote.git")
	if err := os.MkdirAll(remote, 0o700); err != nil {
		t.Fatal(err)
	}
	runGit(t, remote, "init", "--bare")
	runGit(t, root, "remote", "add", "origin", remote)
	runGit(t, root, "push", "-u", "origin", "main")
	store := newManagerStore(root)
	validator := storegit.NewService()
	status := gitstatus.NewService(store, validator)
	manager := storegit.NewManager(store, processrunner.NewSupervisor(), validator, status)

	created, err := manager.CreateBranch(context.Background(), "project", storegit.CreateBranchInput{Name: "change/test"})
	if err != nil || created.Branch != "change/test" {
		t.Fatalf("create branch = %#v, %v", created, err)
	}
	if _, err := manager.CreateBranch(context.Background(), "project", storegit.CreateBranchInput{Name: "change/test"}); !errors.Is(err, storegit.ErrBranchExists) {
		t.Fatalf("occupied branch err = %v", err)
	}
	if _, err := manager.CreateBranch(context.Background(), "project", storegit.CreateBranchInput{Name: "bad name"}); !errors.Is(err, storegit.ErrInvalidBranch) {
		t.Fatalf("invalid branch err = %v", err)
	}
	writeFile(t, filepath.Join(root, "dirty.md"), "dirty\n")
	if _, err := manager.SwitchBranch(context.Background(), "project", storegit.SwitchBranchInput{Branch: "main"}); !errors.Is(err, storegit.ErrWorktreeDirty) {
		t.Fatalf("dirty switch err = %v", err)
	}
	if err := os.Remove(filepath.Join(root, "dirty.md")); err != nil {
		t.Fatal(err)
	}
	if switched, err := manager.SwitchBranch(context.Background(), "project", storegit.SwitchBranchInput{Branch: "main"}); err != nil || switched.Branch != "main" {
		t.Fatalf("switch = %#v, %v", switched, err)
	}
	if _, err := manager.SwitchBranch(context.Background(), "project", storegit.SwitchBranchInput{Branch: "missing"}); !errors.Is(err, storegit.ErrBranchNotFound) {
		t.Fatalf("missing branch err = %v", err)
	}
	runGit(t, root, "branch", "remote-only")
	runGit(t, root, "push", "origin", "remote-only")
	runGit(t, root, "branch", "-D", "remote-only")
	tracked, err := manager.SwitchBranch(context.Background(), "project", storegit.SwitchBranchInput{RemoteBranch: "origin/remote-only", LocalBranch: "tracked"})
	if err != nil || tracked.Branch != "tracked" || tracked.Upstream != "origin/remote-only" {
		t.Fatalf("tracked = %#v, %v", tracked, err)
	}
	if _, err := manager.SwitchBranch(context.Background(), "project", storegit.SwitchBranchInput{RemoteBranch: "origin/remote-only", LocalBranch: "main"}); !errors.Is(err, storegit.ErrBranchExists) {
		t.Fatalf("tracking collision err = %v", err)
	}
	if _, err := manager.SwitchBranch(context.Background(), "project", storegit.SwitchBranchInput{RemoteBranch: "origin/missing", LocalBranch: "missing"}); !errors.Is(err, storegit.ErrBranchNotFound) {
		t.Fatalf("missing remote ref err = %v", err)
	}
	runGit(t, root, "checkout", "--detach")
	detached, err := manager.CreateBranch(context.Background(), "project", storegit.CreateBranchInput{Name: "from-detached"})
	if err != nil || detached.Branch != "from-detached" {
		t.Fatalf("branch from detached = %#v, %v", detached, err)
	}
}

func TestManagerPushLifecycleAndSafeFailure(t *testing.T) {
	root := createManagedStore(t)
	remote := filepath.Join(t.TempDir(), "remote.git")
	if err := os.MkdirAll(remote, 0o700); err != nil {
		t.Fatal(err)
	}
	runGit(t, remote, "init", "--bare")
	runGit(t, root, "remote", "add", "origin", remote)
	store := newManagerStore(root)
	validator := storegit.NewService()
	status := gitstatus.NewService(store, validator)
	supervisor := processrunner.NewSupervisor()
	manager := storegit.NewManager(store, supervisor, validator, status)
	if _, err := manager.StartFetch(context.Background(), "project", storegit.FetchInput{Remote: "missing"}); !errors.Is(err, storegit.ErrRemoteNotFound) {
		t.Fatalf("remote err = %v", err)
	}
	item, err := manager.StartPush(context.Background(), "project", storegit.PushInput{Remote: "origin", TargetBranch: "main"})
	if err != nil || item.GitAction != "push" || item.GitRemote != "origin" {
		t.Fatalf("start push = %#v, %v", item, err)
	}
	item = waitOperation(t, manager, item.ID)
	if item.Status != operation.StatusCompleted {
		t.Fatalf("push = %#v", item)
	}
	events, err := manager.Events(context.Background(), "project", item.ID, 0)
	if err != nil || len(events) < 3 {
		t.Fatalf("events = %#v, %v", events, err)
	}

	competitor := filepath.Join(t.TempDir(), "competitor")
	runGit(t, filepath.Dir(competitor), "clone", "-b", "main", remote, competitor)
	runGit(t, competitor, "config", "user.name", "Other")
	runGit(t, competitor, "config", "user.email", "other@example.com")
	writeFile(t, filepath.Join(competitor, "remote.md"), "remote\n")
	runGit(t, competitor, "add", ".")
	runGit(t, competitor, "commit", "-m", "docs: remote update")
	runGit(t, competitor, "push")
	writeFile(t, filepath.Join(root, "local.md"), "local\n")
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-m", "docs: local update")

	fetch, err := manager.StartFetch(context.Background(), "project", storegit.FetchInput{Remote: "origin"})
	if err != nil || waitOperation(t, manager, fetch.ID).Status != operation.StatusCompleted {
		t.Fatalf("fetch lifecycle = %#v, %v", fetch, err)
	}
	rejected, err := manager.StartPush(context.Background(), "project", storegit.PushInput{})
	if err != nil {
		t.Fatal(err)
	}
	rejected = waitOperation(t, manager, rejected.ID)
	if rejected.Status != operation.StatusFailed || rejected.ErrorCode != "GIT_NON_FAST_FORWARD" || rejected.ErrorMessage == "" {
		t.Fatalf("non-fast-forward = %#v", rejected)
	}
	if rejected.ResultJSON != "" {
		t.Fatalf("raw output leaked: %q", rejected.ResultJSON)
	}
	runGit(t, root, "checkout", "--detach")
	if _, err := manager.StartPush(context.Background(), "project", storegit.PushInput{}); !errors.Is(err, storegit.ErrDetachedHead) {
		t.Fatalf("detached push err = %v", err)
	}
}

func waitOperation(t *testing.T, manager *storegit.Manager, id string) operation.Operation {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		item, err := manager.Get(context.Background(), "project", id)
		if err != nil {
			t.Fatal(err)
		}
		if item.Status.Terminal() {
			return item
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("operation did not finish")
	return operation.Operation{}
}

func createManagedStore(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "store")
	if err := os.MkdirAll(filepath.Join(root, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "openspec", "spec.md"), "# Initial\n")
	runGit(t, root, "init", "-b", "main")
	runGit(t, root, "config", "user.name", "Test")
	runGit(t, root, "config", "user.email", "test@example.com")
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-m", "docs: initial")
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}

func writeFile(t *testing.T, path, value string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
		t.Fatal(err)
	}
}

func runGit(t *testing.T, directory string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", directory}, arguments...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", arguments, err, output)
	}
}

func gitOutput(t *testing.T, directory string, arguments ...string) string {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", directory}, arguments...)...)
	output, err := command.Output()
	if err != nil {
		t.Fatalf("git %v: %v", arguments, err)
	}
	return string(output[:len(output)-1])
}
