package taskcontext_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storage"
	"github.com/sorface/openspec-studio/backend/internal/taskcontext"
)

type fakeMessageGenerator struct {
	message taskcontext.CommitMessage
	err     error
	request taskcontext.MessageRequest
}

func (generator *fakeMessageGenerator) Generate(_ context.Context, request taskcontext.MessageRequest) (taskcontext.CommitMessage, error) {
	generator.request = request
	return generator.message, generator.err
}

type fakeTaskPusher struct {
	path   string
	branch string
	err    error
}

func (pusher *fakeTaskPusher) StartTaskPush(_ context.Context, projectID, path, branch, _ string) (operation.Operation, error) {
	pusher.path, pusher.branch = path, branch
	return operation.Operation{ID: "push", ProjectID: projectID, Kind: operation.KindStoreGit, Status: operation.StatusQueued}, pusher.err
}

func TestPublicationPreviewOptionalAgentStaleAndExactCommit(t *testing.T) {
	root, database, projectItem := createPublicationStore(t)
	defer database.Close()
	if err := os.WriteFile(filepath.Join(root, "openspec", "spec.md"), []byte("# Changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "openspec", "new.md"), []byte("# New\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "code.go"), []byte("package ignored\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	generator := &fakeMessageGenerator{message: taskcontext.CommitMessage{
		Subject: "BILL-1842: уточнить правила биллинга", Body: "- Обновлено предложение\n- Уточнена спецификация",
	}}
	pusher := &fakeTaskPusher{}
	service := taskcontext.NewPublicationService(database, pusher, generator, t.TempDir())

	preview, err := service.Preview(context.Background(), projectItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Task != "BILL-1842" || preview.GeneratedBy != "manual" || preview.Message != "BILL-1842: публикация OpenSpec-артефактов" || len(preview.Paths) != 2 || preview.ExcludedCount != 1 {
		t.Fatalf("preview = %#v", preview)
	}
	if generator.request.Task != "" {
		t.Fatalf("preview unexpectedly invoked agent: %#v", generator.request)
	}
	preview, err = service.GenerateMessage(context.Background(), projectItem.ID, taskcontext.GeneratePublicationMessageInput{Token: preview.Token})
	if err != nil || preview.GeneratedBy != "agent" || preview.Message != "BILL-1842: уточнить правила биллинга" {
		t.Fatalf("generated preview = %#v, %v", preview, err)
	}
	if generator.request.Task != "BILL-1842" || strings.Contains(generator.request.Diff, "code.go") {
		t.Fatalf("agent request = %#v", generator.request)
	}
	if err := os.WriteFile(filepath.Join(root, "openspec", "spec.md"), []byte("# Changed again\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Confirm(context.Background(), projectItem.ID, taskcontext.ConfirmPublicationInput{Token: preview.Token}); !errors.Is(err, taskcontext.ErrPublicationStale) {
		t.Fatalf("stale confirm error = %v", err)
	}
	preview, err = service.Preview(context.Background(), projectItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Confirm(context.Background(), projectItem.ID, taskcontext.ConfirmPublicationInput{Token: preview.Token})
	if err != nil || result.CommitSHA == "" || result.Operation.ID != "push" {
		t.Fatalf("result = %#v, %v", result, err)
	}
	canonicalRoot, _ := filepath.EvalSymlinks(root)
	if pusher.path != canonicalRoot || pusher.branch != "BILL-1842" {
		t.Fatalf("push target = %s %s", pusher.path, pusher.branch)
	}
	show := gitText(t, root, "show", "--name-only", "--format=", "HEAD")
	if strings.Contains(show, "code.go") || !strings.Contains(show, "openspec/spec.md") || !strings.Contains(show, "openspec/new.md") {
		t.Fatalf("commit paths = %q", show)
	}
	if status := gitText(t, root, "status", "--porcelain", "--", "code.go"); !strings.Contains(status, "code.go") {
		t.Fatalf("excluded change was lost: %q", status)
	}
	if _, err := service.Preview(context.Background(), projectItem.ID); !errors.Is(err, taskcontext.ErrPublicationEmpty) {
		t.Fatalf("empty preview error = %v", err)
	}
}

func TestPublicationKeepsManualMessageWhenAgentMessageIsInvalid(t *testing.T) {
	root, database, projectItem := createPublicationStore(t)
	defer database.Close()
	if err := os.WriteFile(filepath.Join(root, "openspec", "spec.md"), []byte("changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := taskcontext.NewPublicationService(database, &fakeTaskPusher{}, &fakeMessageGenerator{
		message: taskcontext.CommitMessage{Subject: "invented message"},
	}, t.TempDir())
	preview, err := service.Preview(context.Background(), projectItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if preview.GeneratedBy != "manual" || preview.Message != "BILL-1842: публикация OpenSpec-артефактов" {
		t.Fatalf("manual preview = %#v", preview)
	}
	if _, err := service.GenerateMessage(context.Background(), projectItem.ID, taskcontext.GeneratePublicationMessageInput{Token: preview.Token}); !errors.Is(err, taskcontext.ErrPublicationMessage) {
		t.Fatalf("invalid agent message error = %v", err)
	}
}

func TestPublicationRejectsSymlinkInOpenSpecScope(t *testing.T) {
	root, database, projectItem := createPublicationStore(t)
	defer database.Close()
	if err := os.Symlink(filepath.Join(root, "outside"), filepath.Join(root, "openspec", "linked.md")); err != nil {
		t.Fatal(err)
	}
	service := taskcontext.NewPublicationService(database, &fakeTaskPusher{}, nil, t.TempDir())
	if _, err := service.Preview(context.Background(), projectItem.ID); !errors.Is(err, taskcontext.ErrPublicationScope) {
		t.Fatalf("symlink scope error = %v", err)
	}
}

func TestPublicationIncludesBothSidesOfRename(t *testing.T) {
	root, database, projectItem := createPublicationStore(t)
	defer database.Close()
	oldPath := filepath.Join(root, "openspec", "spec.md")
	newPath := filepath.Join(root, "openspec", "billing.md")
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatal(err)
	}
	service := taskcontext.NewPublicationService(database, &fakeTaskPusher{}, nil, t.TempDir())
	preview, err := service.Preview(context.Background(), projectItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Paths) != 2 || preview.Paths[0] != "openspec/billing.md" || preview.Paths[1] != "openspec/spec.md" {
		t.Fatalf("rename paths = %#v", preview.Paths)
	}
	if _, err := service.Confirm(context.Background(), projectItem.ID, taskcontext.ConfirmPublicationInput{Token: preview.Token}); err != nil {
		t.Fatal(err)
	}
	changed := gitText(t, root, "show", "--name-status", "--no-renames", "--format=", "HEAD")
	if !strings.Contains(changed, "A\topenspec/billing.md") || !strings.Contains(changed, "D\topenspec/spec.md") {
		t.Fatalf("rename commit = %q", changed)
	}
}

func createPublicationStore(t *testing.T) (string, *storage.SQLite, project.Project) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "store")
	if err := os.MkdirAll(filepath.Join(root, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "init", "-b", "BILL-1842")
	runGit(t, root, "config", "user.name", "Test")
	runGit(t, root, "config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(root, "openspec", "spec.md"), []byte("# Initial\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "openspec/spec.md")
	runGit(t, root, "commit", "-m", "docs: initial")
	remote := filepath.Join(t.TempDir(), "remote.git")
	if output, err := exec.Command("git", "init", "--bare", remote).CombinedOutput(); err != nil {
		t.Fatalf("init remote: %v\n%s", err, output)
	}
	runGit(t, root, "remote", "add", "origin", remote)
	database, err := storage.Open(filepath.Join(t.TempDir(), "publication.db"))
	if err != nil {
		t.Fatal(err)
	}
	item, err := database.Create(context.Background(), project.CreateInput{Name: "Store", StorePath: root})
	if err != nil {
		database.Close()
		t.Fatal(err)
	}
	provider := "codex"
	item, err = database.Update(context.Background(), item.ID, project.UpdateInput{DefaultProvider: &provider})
	if err != nil {
		database.Close()
		t.Fatal(err)
	}
	workspace, err := database.CreateTaskWorkspace(context.Background(), taskcontext.Workspace{
		ProjectID: item.ID, Branch: "BILL-1842", Path: root, Managed: false,
	})
	if err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.SetActiveTaskWorkspace(context.Background(), item.ID, workspace.ID); err != nil {
		database.Close()
		t.Fatal(err)
	}
	return root, database, item
}

func gitText(t *testing.T, root string, arguments ...string) string {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", arguments, err, output)
	}
	return string(output)
}
