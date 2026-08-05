package taskcontext_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storage"
	"github.com/sorface/openspec-studio/backend/internal/taskcontext"
)

func TestManagerCreatesAndSwitchesDirtyTaskWorkspaces(t *testing.T) {
	root := createStore(t)
	database, err := storage.Open(filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	item, err := database.Create(context.Background(), project.CreateInput{Name: "Store", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	manager := taskcontext.NewManager(database, filepath.Join(t.TempDir(), "task-worktrees"))

	initial, err := manager.List(context.Background(), item.ID)
	if err != nil || initial.Active == nil || initial.Active.Branch != "main" || initial.Active.Managed {
		t.Fatalf("initial = %#v, %v", initial, err)
	}
	if err := os.WriteFile(filepath.Join(root, "openspec", "local.md"), []byte("local\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	opened, err := manager.Open(context.Background(), item.ID, taskcontext.OpenInput{Branch: "BILL-1842"})
	if err != nil || opened.Active == nil || opened.Active.Branch != "BILL-1842" || !opened.Active.Managed {
		t.Fatalf("opened = %#v, %v", opened, err)
	}
	if _, err := os.Stat(filepath.Join(root, "openspec", "local.md")); err != nil {
		t.Fatalf("dirty base worktree changed: %v", err)
	}
	effective, err := database.Get(context.Background(), item.ID)
	if err != nil || effective.StorePath == root || effective.ActiveTask != "BILL-1842" {
		t.Fatalf("effective = %#v, %v", effective, err)
	}
	if err := os.WriteFile(filepath.Join(effective.StorePath, "openspec", "task.md"), []byte("task\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	returned, err := manager.Open(context.Background(), item.ID, taskcontext.OpenInput{Branch: "main"})
	if err != nil || returned.Active == nil || returned.Active.Branch != "main" {
		t.Fatalf("returned = %#v, %v", returned, err)
	}
	if _, err := os.Stat(filepath.Join(effective.StorePath, "openspec", "task.md")); err != nil {
		t.Fatalf("dirty task worktree changed: %v", err)
	}
	if _, err := manager.Open(context.Background(), item.ID, taskcontext.OpenInput{Branch: "bad name"}); !errors.Is(err, taskcontext.ErrInvalidBranch) {
		t.Fatalf("invalid branch error = %v", err)
	}
}

func TestManagerReusesExistingLocalBranch(t *testing.T) {
	root := createStore(t)
	runGit(t, root, "branch", "BILL-1907")
	database, err := storage.Open(filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	item, err := database.Create(context.Background(), project.CreateInput{Name: "Store", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	manager := taskcontext.NewManager(database, filepath.Join(t.TempDir(), "task-worktrees"))
	overview, err := manager.Open(context.Background(), item.ID, taskcontext.OpenInput{Branch: "BILL-1907"})
	if err != nil || overview.Active == nil || overview.Active.Branch != "BILL-1907" {
		t.Fatalf("overview = %#v, %v", overview, err)
	}
}

func TestManagerListsAndOpensRemoteTaskBranch(t *testing.T) {
	root := createStore(t)
	addRemoteBranch(t, root, "feature/CGA-1244")
	database, err := storage.Open(filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	item, err := database.Create(context.Background(), project.CreateInput{Name: "Store", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	manager := taskcontext.NewManager(database, filepath.Join(t.TempDir(), "task-worktrees"))

	overview, err := manager.List(context.Background(), item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(overview.RemoteBranches, ","); got != "origin/feature/CGA-1244,origin/main" {
		t.Fatalf("remote branches = %q", got)
	}
	opened, err := manager.Open(context.Background(), item.ID, taskcontext.OpenInput{RemoteBranch: "origin/feature/CGA-1244"})
	if err != nil || opened.Active == nil || opened.Active.Branch != "feature/CGA-1244" || !opened.Active.Managed {
		t.Fatalf("opened = %#v, %v", opened, err)
	}
	projectItem, err := database.Get(context.Background(), item.ID)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command("git", "-C", projectItem.StorePath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if output, err := command.CombinedOutput(); err != nil || strings.TrimSpace(string(output)) != "origin/feature/CGA-1244" {
		t.Fatalf("upstream: %v\n%s", err, output)
	}
}

func TestManagerRejectsMissingRemoteTaskBranch(t *testing.T) {
	root := createStore(t)
	database, err := storage.Open(filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	item, err := database.Create(context.Background(), project.CreateInput{Name: "Store", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	manager := taskcontext.NewManager(database, filepath.Join(t.TempDir(), "task-worktrees"))

	if _, err := manager.Open(context.Background(), item.ID, taskcontext.OpenInput{RemoteBranch: "origin/feature/missing"}); !errors.Is(err, taskcontext.ErrRemoteBranchNotFound) {
		t.Fatalf("missing remote branch error = %v", err)
	}
	command := exec.Command("git", "-C", root, "show-ref", "--verify", "--quiet", "refs/heads/feature/missing")
	if err := command.Run(); err == nil {
		t.Fatal("missing remote branch unexpectedly created a local branch")
	}
}

func TestManagerSyncFastForwardsAndPreservesLocalChanges(t *testing.T) {
	root := createStore(t)
	remote := filepath.Join(t.TempDir(), "remote.git")
	if output, err := exec.Command("git", "init", "--bare", remote).CombinedOutput(); err != nil {
		t.Fatalf("init remote: %v\n%s", err, output)
	}
	runGit(t, root, "remote", "add", "origin", remote)
	runGit(t, root, "push", "-u", "origin", "main")
	runGit(t, remote, "symbolic-ref", "HEAD", "refs/heads/main")
	updater := filepath.Join(t.TempDir(), "updater")
	if output, err := exec.Command("git", "clone", remote, updater).CombinedOutput(); err != nil {
		t.Fatalf("clone updater: %v\n%s", err, output)
	}
	runGit(t, updater, "config", "user.name", "Updater")
	runGit(t, updater, "config", "user.email", "updater@example.com")
	if err := os.WriteFile(filepath.Join(updater, "openspec", "remote.md"), []byte("remote\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, updater, "add", "openspec/remote.md")
	runGit(t, updater, "commit", "-m", "docs: remote")
	runGit(t, updater, "push")

	database, err := storage.Open(filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	item, err := database.Create(context.Background(), project.CreateInput{Name: "Store", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	manager := taskcontext.NewManager(database, filepath.Join(t.TempDir(), "task-worktrees"))
	if _, err := manager.List(context.Background(), item.ID); err != nil {
		t.Fatal(err)
	}
	localPath := filepath.Join(root, "openspec", "local.md")
	if err := os.WriteFile(localPath, []byte("local\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := manager.Sync(context.Background(), item.ID)
	if err != nil || !result.Updated || result.Task != "main" || result.Head == result.PreviousHead {
		t.Fatalf("sync = %#v, %v", result, err)
	}
	if _, err := os.Stat(filepath.Join(root, "openspec", "remote.md")); err != nil {
		t.Fatalf("remote file missing: %v", err)
	}
	if content, err := os.ReadFile(localPath); err != nil || string(content) != "local\n" {
		t.Fatalf("local change lost: %q, %v", content, err)
	}
	result, err = manager.Sync(context.Background(), item.ID)
	if err != nil || result.Updated || result.Head != result.PreviousHead {
		t.Fatalf("no-op sync = %#v, %v", result, err)
	}

	localSpec := filepath.Join(root, "openspec", "spec.md")
	if err := os.WriteFile(localSpec, []byte("# Local\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(updater, "openspec", "spec.md"), []byte("# Remote\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, updater, "add", "openspec/spec.md")
	runGit(t, updater, "commit", "-m", "docs: conflicting remote")
	runGit(t, updater, "push")
	if _, err := manager.Sync(context.Background(), item.ID); !errors.Is(err, taskcontext.ErrSyncConflict) {
		t.Fatalf("conflicting sync error = %v", err)
	}
	if content, err := os.ReadFile(localSpec); err != nil || string(content) != "# Local\n" {
		t.Fatalf("conflicting local change lost: %q, %v", content, err)
	}
}

func TestManagerSyncRequiresUpstream(t *testing.T) {
	root := createStore(t)
	database, err := storage.Open(filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	item, err := database.Create(context.Background(), project.CreateInput{Name: "Store", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	manager := taskcontext.NewManager(database, filepath.Join(t.TempDir(), "task-worktrees"))
	if _, err := manager.List(context.Background(), item.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Sync(context.Background(), item.ID); !errors.Is(err, taskcontext.ErrSyncUpstream) {
		t.Fatalf("missing upstream error = %v", err)
	}
}

func createStore(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "store")
	if err := os.MkdirAll(filepath.Join(root, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "init", "-b", "main")
	runGit(t, root, "config", "user.name", "Test")
	runGit(t, root, "config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(root, "openspec", "spec.md"), []byte("# Spec\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "openspec/spec.md")
	runGit(t, root, "commit", "-m", "docs: initial")
	return root
}

func runGit(t *testing.T, root string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", arguments, err, output)
	}
}

func addRemoteBranch(t *testing.T, root, branch string) {
	t.Helper()
	remote := filepath.Join(t.TempDir(), "remote.git")
	if output, err := exec.Command("git", "init", "--bare", remote).CombinedOutput(); err != nil {
		t.Fatalf("init remote: %v\n%s", err, output)
	}
	runGit(t, remote, "symbolic-ref", "HEAD", "refs/heads/main")
	runGit(t, root, "remote", "add", "origin", remote)
	runGit(t, root, "push", "-u", "origin", "main")
	runGit(t, root, "branch", branch)
	runGit(t, root, "push", "origin", branch)
	runGit(t, root, "branch", "-D", branch)
	runGit(t, root, "remote", "set-head", "origin", "-a")
}
