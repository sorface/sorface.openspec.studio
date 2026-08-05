package document_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/document"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

type projectReader struct {
	item project.Project
	err  error
}

func (reader projectReader) Get(context.Context, string) (project.Project, error) {
	return reader.item, reader.err
}

func fixture(t *testing.T) (string, *document.Service) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "openspec", "specs", "example"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "openspec", "changes", "add-test"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "openspec", "changes", "add-test", "specs", "example"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "openspec", "specs", "example", "spec.md"), []byte("# Spec\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "openspec", "changes", "add-test", "proposal.md"), []byte("# Proposal\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"design.md": "# Design\n",
		"tasks.md":  "# Tasks\n",
	} {
		if err := os.WriteFile(filepath.Join(root, "openspec", "changes", "add-test", name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "openspec", "changes", "add-test", "specs", "example", "spec.md"), []byte("# Delta spec\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "openspec", "changes", "add-test", "ignore.txt"), []byte("ignore"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root, document.NewService(projectReader{item: project.Project{ID: "project-1", StorePath: root}})
}

func TestListAndReadDocuments(t *testing.T) {
	_, service := fixture(t)
	items, err := service.List(context.Background(), "project-1")
	if err != nil {
		t.Fatal(err)
	}
	var paths []string
	for _, item := range items {
		paths = append(paths, item.Path)
	}
	joined := strings.Join(paths, "\n")
	if !strings.Contains(joined, "openspec/specs/example/spec.md") ||
		!strings.Contains(joined, "openspec/changes/add-test/proposal.md") ||
		strings.Contains(joined, "ignore.txt") {
		t.Fatalf("unexpected paths: %v", paths)
	}
	changeStart := -1
	for index, path := range paths {
		if path == "openspec/changes/add-test" {
			changeStart = index
			break
		}
	}
	expectedChangeOrder := []string{
		"openspec/changes/add-test",
		"openspec/changes/add-test/proposal.md",
		"openspec/changes/add-test/specs",
		"openspec/changes/add-test/specs/example",
		"openspec/changes/add-test/specs/example/spec.md",
		"openspec/changes/add-test/design.md",
		"openspec/changes/add-test/tasks.md",
	}
	if changeStart < 0 || changeStart+len(expectedChangeOrder) > len(paths) {
		t.Fatalf("change subtree is incomplete: %v", paths)
	}
	for offset, expected := range expectedChangeOrder {
		if actual := paths[changeStart+offset]; actual != expected {
			t.Fatalf("unexpected change order at %d: got %q, want %q; all paths: %v", offset, actual, expected, paths)
		}
	}
	content, err := service.Read(context.Background(), "project-1", "openspec/specs/example/spec.md")
	if err != nil {
		t.Fatal(err)
	}
	if content.Content != "# Spec\n" || len(content.ContentHash) != 64 {
		t.Fatalf("unexpected content: %#v", content)
	}
}

func TestWriteAndConflict(t *testing.T) {
	root, service := fixture(t)
	current, err := service.Read(context.Background(), "project-1", "openspec/specs/example/spec.md")
	if err != nil {
		t.Fatal(err)
	}
	written, err := service.Write(context.Background(), "project-1", document.WriteInput{
		Path: current.Path, Content: "# Changed\n", BaseContentHash: current.ContentHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	if written.ContentHash == current.ContentHash {
		t.Fatal("hash was not updated")
	}
	data, err := os.ReadFile(filepath.Join(root, "openspec", "specs", "example", "spec.md"))
	if err != nil || string(data) != "# Changed\n" {
		t.Fatalf("unexpected file: %q %v", data, err)
	}
	_, err = service.Write(context.Background(), "project-1", document.WriteInput{
		Path: current.Path, Content: "# Lost\n", BaseContentHash: current.ContentHash,
	})
	if !errors.Is(err, document.ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
}

func TestDocumentHistory(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	root, service := fixture(t)
	for _, arguments := range [][]string{
		{"init"},
		{"add", "."},
		{"-c", "user.name=Test Analyst", "-c", "user.email=test@example.com", "commit", "-m", "initial artifacts"},
	} {
		command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", arguments, err, output)
		}
	}
	proposalPath := filepath.Join(root, "openspec", "changes", "add-test", "proposal.md")
	if err := os.WriteFile(proposalPath, []byte("# Updated proposal\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, arguments := range [][]string{
		{"add", "openspec/changes/add-test/proposal.md"},
		{"-c", "user.name=Test Developer", "-c", "user.email=test@example.com", "commit", "-m", "refine proposal"},
	} {
		command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", arguments, err, output)
		}
	}

	entries, err := service.History(context.Background(), "project-1", "openspec/changes/add-test/proposal.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("history length = %d, entries = %#v", len(entries), entries)
	}
	if entries[0].Subject != "refine proposal" || entries[0].Author != "Test Developer" ||
		entries[1].Subject != "initial artifacts" || len(entries[0].Hash) != 40 || entries[0].ShortHash == "" {
		t.Fatalf("unexpected history: %#v", entries)
	}
}

func TestDocumentAnnotations(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	root, service := fixture(t)
	proposalPath := filepath.Join(root, "openspec", "changes", "add-test", "proposal.md")
	if err := os.WriteFile(proposalPath, []byte("# Proposal\nShared context\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, arguments := range [][]string{
		{"init"},
		{"add", "."},
		{"-c", "user.name=Test Analyst", "-c", "user.email=analyst@example.com", "commit", "-m", "initial artifacts"},
	} {
		command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", arguments, err, output)
		}
	}
	if err := os.WriteFile(proposalPath, []byte("# Updated proposal\nShared context\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, arguments := range [][]string{
		{"add", "openspec/changes/add-test/proposal.md"},
		{"-c", "user.name=Test Developer", "-c", "user.email=developer@example.com", "commit", "-m", "refine proposal"},
	} {
		command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", arguments, err, output)
		}
	}
	if err := os.WriteFile(proposalPath, []byte("# Updated proposal\nShared context\nLocal note\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	entries, err := service.Annotations(context.Background(), "project-1", "openspec/changes/add-test/proposal.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("annotation length = %d, entries = %#v", len(entries), entries)
	}
	if entries[0].StartLine != 1 || entries[0].Author != "Test Developer" || entries[0].Subject != "refine proposal" ||
		entries[0].ShortHash == "" || entries[0].AuthoredAt == "" || entries[0].Lines[0] != "# Updated proposal" {
		t.Fatalf("unexpected updated annotation: %#v", entries[0])
	}
	if entries[1].StartLine != 2 || entries[1].Author != "Test Analyst" || entries[1].Lines[0] != "Shared context" {
		t.Fatalf("unexpected original annotation: %#v", entries[1])
	}
	if entries[2].StartLine != 3 || !entries[2].Local || entries[2].Hash != "" ||
		entries[2].Author != "Локальные изменения" || entries[2].Lines[0] != "Local note" {
		t.Fatalf("unexpected local annotation: %#v", entries[2])
	}
}

func TestRejectsUnsafeAndInvalidDocuments(t *testing.T) {
	root, service := fixture(t)
	for _, path := range []string{"../secret.md", "/tmp/secret.md", "README.md", "openspec/specs/example/ignore.txt"} {
		if _, err := service.Read(context.Background(), "project-1", path); !errors.Is(err, document.ErrPathOutsideScope) {
			t.Fatalf("%s: expected path error, got %v", path, err)
		}
		if _, err := service.History(context.Background(), "project-1", path); !errors.Is(err, document.ErrPathOutsideScope) {
			t.Fatalf("%s: expected history path error, got %v", path, err)
		}
		if _, err := service.Annotations(context.Background(), "project-1", path); !errors.Is(err, document.ErrPathOutsideScope) {
			t.Fatalf("%s: expected annotations path error, got %v", path, err)
		}
	}
	invalidPath := filepath.Join(root, "openspec", "specs", "example", "invalid.md")
	if err := os.WriteFile(invalidPath, []byte{0xff, 0xfe}, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Read(context.Background(), "project-1", "openspec/specs/example/invalid.md"); !errors.Is(err, document.ErrInvalidContent) {
		t.Fatalf("expected invalid content, got %v", err)
	}
	largePath := filepath.Join(root, "openspec", "specs", "example", "large.md")
	if err := os.WriteFile(largePath, make([]byte, document.MaxDocumentSize+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Read(context.Background(), "project-1", "openspec/specs/example/large.md"); !errors.Is(err, document.ErrTooLarge) {
		t.Fatalf("expected too large, got %v", err)
	}
}

func TestRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation may require privileges")
	}
	root, service := fixture(t)
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("# Outside\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "openspec", "specs", "example", "escape.md")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Read(context.Background(), "project-1", "openspec/specs/example/escape.md"); !errors.Is(err, document.ErrPathOutsideScope) {
		t.Fatalf("expected path error, got %v", err)
	}
}

func TestProjectErrorIsPreserved(t *testing.T) {
	service := document.NewService(projectReader{err: project.ErrNotFound})
	if _, err := service.List(context.Background(), "missing"); !errors.Is(err, project.ErrNotFound) {
		t.Fatalf("expected project error, got %v", err)
	}
}
