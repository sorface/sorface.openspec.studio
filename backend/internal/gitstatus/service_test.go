package gitstatus

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/project"
)

type projectStore struct {
	item project.Project
}

func (store projectStore) Get(context.Context, string) (project.Project, error) {
	return store.item, nil
}

type pathValidator struct{}

func (pathValidator) Validate(_ context.Context, value string) (string, error) {
	return filepath.EvalSymlinks(value)
}

func TestStatusAndDiff(t *testing.T) {
	root := filepath.Join(t.TempDir(), "store")
	if err := os.MkdirAll(filepath.Join(root, ".openspec-store"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".openspec-store", "store.yaml"), []byte("store-id: git-test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	document := filepath.Join(root, "openspec", "spec.md")
	if err := os.WriteFile(document, []byte("# Initial\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "init")
	runGit(t, root, "add", ".")
	runGit(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init")
	if err := os.WriteFile(document, []byte("# Changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(projectStore{item: project.Project{ID: "project", StorePath: root}}, pathValidator{})
	status, err := service.Get(context.Background(), "project")
	if err != nil {
		t.Fatal(err)
	}
	if status.Head == "" || len(status.Changes) != 1 || status.Changes[0].Path != "openspec/spec.md" {
		t.Fatalf("status = %#v", status)
	}
	if status.Detached || status.Branch == "" || status.Upstream != "" || len(status.LocalBranches) != 1 {
		t.Fatalf("branch status = %#v", status)
	}
	if status.Diff == "" || status.DiffTruncated {
		t.Fatalf("diff = %q truncated=%v", status.Diff, status.DiffTruncated)
	}
}

func TestStatusWithUpstreamAndDetachedHead(t *testing.T) {
	root := filepath.Join(t.TempDir(), "store")
	remote := filepath.Join(t.TempDir(), "remote.git")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(remote, 0o700); err != nil {
		t.Fatal(err)
	}
	runGit(t, remote, "init", "--bare")
	runGit(t, root, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("store\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", ".")
	runGit(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init")
	runGit(t, root, "remote", "add", "origin", remote)
	runGit(t, root, "push", "-u", "origin", "main")
	service := NewService(projectStore{item: project.Project{ID: "project", StorePath: root}}, pathValidator{})
	status, err := service.Get(context.Background(), "project")
	if err != nil {
		t.Fatal(err)
	}
	if status.Upstream != "origin/main" || status.Ahead != 0 || status.Behind != 0 || len(status.Remotes) != 1 || status.Remotes[0] != "origin" {
		t.Fatalf("upstream status = %#v", status)
	}
	if len(status.RemoteBranches) != 1 || status.RemoteBranches[0] != "origin/main" {
		t.Fatalf("remote branches = %#v", status.RemoteBranches)
	}
	runGit(t, root, "checkout", "--detach", "HEAD")
	status, err = service.Get(context.Background(), "project")
	if err != nil {
		t.Fatal(err)
	}
	if !status.Detached || status.Branch != "" || status.Head == "" {
		t.Fatalf("detached status = %#v", status)
	}
}

func TestParseStatus(t *testing.T) {
	changes := parseStatus(" M openspec/a.md\x00A  openspec/b.md\x00?? openspec/c.md\x00")
	if len(changes) != 3 || changes[0].Worktree != "M" || changes[1].Index != "A" || changes[2].Index != "?" {
		t.Fatalf("changes = %#v", changes)
	}
}

func runGit(t *testing.T, directory string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", directory}, arguments...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", arguments, err, output)
	}
}
