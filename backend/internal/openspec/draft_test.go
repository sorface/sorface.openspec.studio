package openspec

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storage"
	"github.com/sorface/openspec-studio/backend/internal/taskcontext"
)

func TestAcceptAndWriteDraftMutationSet(t *testing.T) {
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	updatePath := filepath.Join(storeRoot, "openspec", "update.md")
	deletePath := filepath.Join(storeRoot, "openspec", "delete.md")
	renamePath := filepath.Join(storeRoot, "openspec", "rename.md")
	for path, content := range map[string]string{
		updatePath: "before-update", deletePath: "before-delete", renamePath: "before-rename",
	} {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	database, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectItem, err := database.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	result := `{"files":[` +
		`{"type":"create","path":"openspec/create.md","after":"created"},` +
		`{"type":"update","path":"openspec/update.md","before":"before-update","after":"after-update"},` +
		`{"type":"delete","path":"openspec/delete.md","before":"before-delete"},` +
		`{"type":"rename","path":"openspec/renamed.md","previousPath":"openspec/rename.md","before":"before-rename","after":"before-rename"}` +
		`],"diagnostics":[]}`
	item := createReviewOperation(t, database, projectItem.ID, result)
	service := NewDraftService(database, filepath.Join(root, "data"))
	set, err := service.Accept(context.Background(), projectItem.ID, item.ID)
	if err != nil || len(set.Mutations) != 4 {
		t.Fatalf("set=%#v err=%v", set, err)
	}
	repeated, err := service.Accept(context.Background(), projectItem.ID, item.ID)
	if err != nil || repeated.ID != set.ID || len(repeated.Mutations) != len(set.Mutations) {
		t.Fatalf("repeated accept=%#v err=%v", repeated, err)
	}
	loadedOperation, err := database.GetOperation(context.Background(), item.ID)
	if err != nil || loadedOperation.Status != operation.StatusAccepted {
		t.Fatalf("operation=%#v err=%v", loadedOperation, err)
	}
	written, err := service.Write(context.Background(), projectItem.ID, set.ID)
	if err != nil || written.Status != operation.DraftWritten {
		t.Fatalf("written=%#v err=%v", written, err)
	}
	assertFileContent(t, filepath.Join(storeRoot, "openspec", "create.md"), "created")
	assertFileContent(t, updatePath, "after-update")
	if _, err := os.Stat(deletePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("delete path still exists: %v", err)
	}
	if _, err := os.Stat(renamePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rename source still exists: %v", err)
	}
	assertFileContent(t, filepath.Join(storeRoot, "openspec", "renamed.md"), "before-rename")
}

func TestDraftConflictDoesNotApplyEarlierMutation(t *testing.T) {
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	conflictPath := filepath.Join(storeRoot, "openspec", "conflict.md")
	if err := os.WriteFile(conflictPath, []byte("external"), 0o600); err != nil {
		t.Fatal(err)
	}
	database, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectItem, err := database.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	operationItem, err := database.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindOpenSpec, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	set, err := database.CreateDraftSet(context.Background(), operation.DraftSet{
		ProjectID: projectItem.ID, OperationID: operationItem.ID,
		Mutations: []operation.DraftMutation{
			{Type: "create", Path: "openspec/new.md", After: "new"},
			{Type: "update", Path: "openspec/conflict.md", Before: "expected", After: "changed"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewDraftService(database, filepath.Join(root, "data"))
	if _, err := service.Write(context.Background(), projectItem.ID, set.ID); !errors.Is(err, ErrDraftConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(storeRoot, "openspec", "new.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("earlier create was partially applied")
	}
	assertFileContent(t, conflictPath, "external")
}

func TestDraftWriteKeepsOperationTaskWorkspaceAfterSwitch(t *testing.T) {
	root := t.TempDir()
	baseRoot := filepath.Join(root, "base")
	taskA := filepath.Join(root, "task-a")
	taskB := filepath.Join(root, "task-b")
	for _, directory := range []string{baseRoot, taskA, taskB} {
		if err := os.MkdirAll(filepath.Join(directory, "openspec"), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "openspec", "spec.md"), []byte("before"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	database, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectItem, err := database.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: baseRoot})
	if err != nil {
		t.Fatal(err)
	}
	workspaceA, err := database.CreateTaskWorkspace(context.Background(), taskcontext.Workspace{
		ProjectID: projectItem.ID, Branch: "BILL-1842", Path: taskA, Managed: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	workspaceB, err := database.CreateTaskWorkspace(context.Background(), taskcontext.Workspace{
		ProjectID: projectItem.ID, Branch: "BILL-1907", Path: taskB, Managed: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(actionExecution{StorePath: workspaceA.Path})
	if err != nil {
		t.Fatal(err)
	}
	operationItem, err := database.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindOpenSpec, InputJSON: string(payload),
	})
	if err != nil {
		t.Fatal(err)
	}
	set, err := database.CreateDraftSet(context.Background(), operation.DraftSet{
		ProjectID: projectItem.ID, OperationID: operationItem.ID,
		Mutations: []operation.DraftMutation{{
			Type: "update", Path: "openspec/spec.md", Before: "before", After: "after-a",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.SetActiveTaskWorkspace(context.Background(), projectItem.ID, workspaceB.ID); err != nil {
		t.Fatal(err)
	}
	service := NewDraftService(database, filepath.Join(root, "data"))
	if _, err := service.Write(context.Background(), projectItem.ID, set.ID); err != nil {
		t.Fatal(err)
	}
	assertFileContent(t, filepath.Join(taskA, "openspec", "spec.md"), "after-a")
	assertFileContent(t, filepath.Join(taskB, "openspec", "spec.md"), "before")
}

func TestRejectReviewOperation(t *testing.T) {
	root := t.TempDir()
	database, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectItem, err := database.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	item := createReviewOperation(t, database, projectItem.ID, `{"files":[],"diagnostics":[]}`)
	service := NewDraftService(database, filepath.Join(root, "data"))
	rejected, err := service.Reject(context.Background(), projectItem.ID, item.ID)
	if err != nil || rejected.Status != operation.StatusRejected {
		t.Fatalf("rejected=%#v err=%v", rejected, err)
	}
}

func createReviewOperation(t *testing.T, database *storage.SQLite, projectID, result string) operation.Operation {
	t.Helper()
	item, err := database.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectID, Kind: operation.KindOpenSpec, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []operation.Status{
		operation.StatusRunning, operation.StatusValidating, operation.StatusAwaitingReview,
	} {
		item.Status = status
		item.ResultJSON = result
		item, err = database.UpdateOperation(context.Background(), item)
		if err != nil {
			t.Fatal(err)
		}
	}
	return item
}

func assertFileContent(t *testing.T, path, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil || string(content) != expected {
		t.Fatalf("path=%s content=%q err=%v", path, content, err)
	}
}
