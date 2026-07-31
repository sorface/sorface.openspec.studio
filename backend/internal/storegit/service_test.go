package storegit

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/project"
)

func TestValidateStore(t *testing.T) {
	root := createStore(t)
	service := NewService()
	canonical, err := service.Validate(context.Background(), root)
	if err != nil || canonical != root {
		t.Fatalf("validate = %q, %v", canonical, err)
	}
	if _, err := service.Validate(context.Background(), "git@example.com:store.git"); !errors.Is(err, project.ErrInvalidStorePath) {
		t.Fatalf("url err = %v", err)
	}
	if _, err := service.Validate(context.Background(), filepath.Join(root, "openspec")); !errors.Is(err, project.ErrInvalidStore) {
		t.Fatalf("nested err = %v", err)
	}
}

func TestValidateAcceptsRepositoryWithoutOpenSpecMetadataAndRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	runGit(t, root, "init")
	service := NewService()
	if canonical, err := service.Validate(context.Background(), root); err != nil || canonical == "" {
		t.Fatalf("repository without metadata = %q, %v", canonical, err)
	}
	valid := createStore(t)
	link := filepath.Join(t.TempDir(), "store-link")
	if err := os.Symlink(valid, link); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Validate(context.Background(), link); !errors.Is(err, project.ErrInvalidStorePath) {
		t.Fatalf("symlink err = %v", err)
	}
}

func TestCloneLocalStore(t *testing.T) {
	managedRoot := t.TempDir()
	bin := filepath.Join(t.TempDir(), "git")
	script := `#!/bin/sh
if [ "$1" = "clone" ]; then
  target="$5"
  mkdir -p "$target"
  printf 'arbitrary repository\n' > "$target/README.md"
  exit 0
fi
if [ "$1" = "rev-parse" ]; then
  pwd
  exit 0
fi
exit 1
`
	if err := os.WriteFile(bin, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	service := &Service{gitPath: bin, managedRoot: managedRoot}
	canonical, err := service.Clone(context.Background(), "git@example.com:owner/store.git")
	canonicalRoot, rootErr := filepath.EvalSymlinks(managedRoot)
	if err != nil || filepath.Base(canonical) != "store" ||
		rootErr != nil || !strings.HasPrefix(canonical, canonicalRoot+string(filepath.Separator)) {
		t.Fatalf("clone = %q, rootErr=%v, err=%v", canonical, rootErr, err)
	}
	if _, err := os.Stat(filepath.Join(canonical, "README.md")); err != nil {
		t.Fatal(err)
	}
}

func TestCloneValidationAndSafeErrors(t *testing.T) {
	service := NewService(t.TempDir())
	if _, err := service.Clone(context.Background(), "--upload-pack=evil"); !errors.Is(err, project.ErrInvalidGitURL) {
		t.Fatalf("url err = %v", err)
	}
	if !errors.Is(classifyCloneError("git@example.com: Permission denied (publickey)."), project.ErrGitAuthFailed) {
		t.Fatal("publickey error was not classified")
	}
	if !errors.Is(classifyCloneError("Host key verification failed."), project.ErrSSHHostKeyFailed) {
		t.Fatal("host key error was not classified")
	}
}

func createStore(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "store")
	if err := os.MkdirAll(filepath.Join(root, ".openspec-store"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".openspec-store", "store.yaml"), []byte("store-id: test-store\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "openspec", "config.yaml"), []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "init")
	runGit(t, root, "add", ".")
	runGit(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init")
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}

func runGit(t *testing.T, directory string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", directory}, arguments...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", arguments, err, output)
	}
}
