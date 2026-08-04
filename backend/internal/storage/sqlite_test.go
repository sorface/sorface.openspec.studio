package storage_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storage"
	"github.com/sorface/openspec-studio/backend/internal/taskcontext"
)

func TestProjectsSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.db")
	first, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	created, err := first.Create(context.Background(), project.CreateInput{Name: "Platform", StorePath: "/store"})
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	loaded, err := second.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Name != created.Name || loaded.StorePath != created.StorePath {
		t.Fatalf("loaded project differs: %#v", loaded)
	}
}

func TestTaskWorkspacePersistenceAndEffectiveStorePath(t *testing.T) {
	store, err := storage.Open(filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	created, err := store.Create(context.Background(), project.CreateInput{Name: "Platform", StorePath: "/base/store"})
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := store.CreateTaskWorkspace(context.Background(), taskcontext.Workspace{
		ProjectID: created.ID, Branch: "BILL-1842", Path: "/tasks/bill-1842", Managed: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetActiveTaskWorkspace(context.Background(), created.ID, workspace.ID); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.StorePath != workspace.Path || loaded.BaseStorePath != created.StorePath || loaded.ActiveTask != workspace.Branch {
		t.Fatalf("effective project = %#v", loaded)
	}
	base, err := store.GetBaseProject(context.Background(), created.ID)
	if err != nil || base.StorePath != created.StorePath || base.BaseStorePath != created.StorePath {
		t.Fatalf("base project = %#v, %v", base, err)
	}
	items, err := store.ListTaskWorkspaces(context.Background(), created.ID)
	if err != nil || len(items) != 1 || !items[0].Active {
		t.Fatalf("task workspaces = %#v, %v", items, err)
	}
	if err := store.SetActiveTaskWorkspace(context.Background(), created.ID, "missing"); !errors.Is(err, taskcontext.ErrWorkspaceNotFound) {
		t.Fatalf("missing workspace error = %v", err)
	}
}

func TestOperationRepositoryAndRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "operations.db")
	store, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	projectItem, err := store.Create(context.Background(), project.CreateInput{Name: "Platform", StorePath: "/store"})
	if err != nil {
		t.Fatal(err)
	}
	item, err := store.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindOpenSpec, InputJSON: "{}",
		OpenSpecAction: "prepare_artifact", OpenSpecChange: "add-auth",
		OpenSpecSchema: "spec-driven", OpenSpecArtifact: "proposal",
		OpenSpecFingerprint: "fingerprint",
	})
	if err != nil {
		t.Fatal(err)
	}
	item.Status = operation.StatusRunning
	if _, err := store.UpdateOperation(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	event, err := store.AddEvent(context.Background(), operation.Event{
		OperationID: item.ID, Type: "progress", Payload: `{"message":"running"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	events, err := store.ListEvents(context.Background(), item.ID, event.Sequence-1)
	if err != nil || len(events) != 1 {
		t.Fatalf("events=%#v err=%v", events, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	recovered, err := store.RecoverInterrupted(context.Background())
	if err != nil || recovered != 1 {
		t.Fatalf("recovered=%d err=%v", recovered, err)
	}
	loaded, err := store.GetOperation(context.Background(), item.ID)
	if err != nil || loaded.Status != operation.StatusFailed || loaded.ErrorCode != "APPLICATION_RESTARTED" {
		t.Fatalf("loaded=%#v err=%v", loaded, err)
	}
	if loaded.OpenSpecAction != "prepare_artifact" || loaded.OpenSpecChange != "add-auth" ||
		loaded.OpenSpecSchema != "spec-driven" || loaded.OpenSpecArtifact != "proposal" ||
		loaded.OpenSpecFingerprint != "fingerprint" {
		t.Fatalf("OpenSpec metadata not persisted: %#v", loaded)
	}
}

func TestMigratesLegacyOperationsTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`
		CREATE TABLE operations (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			status TEXT NOT NULL,
			provider TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			prompt TEXT NOT NULL DEFAULT '',
			input_json TEXT NOT NULL DEFAULT '{}',
			result_json TEXT NOT NULL DEFAULT '',
			error_code TEXT NOT NULL DEFAULT '',
			error_message TEXT NOT NULL DEFAULT '',
			correlation_id TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
}

func TestRepositoryPersistenceAndContextTransaction(t *testing.T) {
	store, err := storage.Open(filepath.Join(t.TempDir(), "repositories.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	projectItem, err := store.Create(context.Background(), project.CreateInput{Name: "Platform", StorePath: "/store"})
	if err != nil {
		t.Fatal(err)
	}
	link, err := store.CreateRepository(context.Background(), operation.RepositoryLink{
		ProjectID: projectItem.ID, Name: "code", Path: "/code", RemoteURL: "https://example.test/code.git",
		Fingerprint: "fingerprint", Branch: "main", CommitSHA: "abc",
	})
	if err != nil {
		t.Fatal(err)
	}
	links, err := store.ListRepositories(context.Background(), projectItem.ID)
	if err != nil || len(links) != 1 || links[0].ID != link.ID || !links[0].ReadOnlyForAI {
		t.Fatalf("links=%#v err=%v", links, err)
	}
	operationItem, err := store.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindAI, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveContext(context.Background(), operationItem.ID, []operation.ContextEntry{{
		Source: "store", Path: "openspec/config.yaml", Size: 10, Checksum: "sum",
		Reason: "selected", Included: true,
	}}); err != nil {
		t.Fatal(err)
	}
	contextEntries, err := store.ListContext(context.Background(), operationItem.ID)
	if err != nil || len(contextEntries) != 1 || contextEntries[0].Checksum != "sum" {
		t.Fatalf("context=%#v err=%v", contextEntries, err)
	}
	if err := store.SaveAudit(context.Background(), operation.Audit{
		OperationID: operationItem.ID, Executable: "codex", Arguments: "--token [REDACTED]",
		ExitCode: 0, StdoutBytes: 10, DurationMS: 20,
	}); err != nil {
		t.Fatal(err)
	}
	audit, err := store.GetAudit(context.Background(), operationItem.ID)
	if err != nil || audit.Arguments != "--token [REDACTED]" {
		t.Fatalf("audit=%#v err=%v", audit, err)
	}
}

func TestDraftMutationSetPersistence(t *testing.T) {
	store, err := storage.Open(filepath.Join(t.TempDir(), "drafts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	projectItem, err := store.Create(context.Background(), project.CreateInput{Name: "Platform", StorePath: "/store"})
	if err != nil {
		t.Fatal(err)
	}
	operationItem, err := store.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindOpenSpec, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	set, err := store.CreateDraftSet(context.Background(), operation.DraftSet{
		ProjectID: projectItem.ID, OperationID: operationItem.ID,
		Mutations: []operation.DraftMutation{
			{Type: "create", Path: "openspec/changes/add-auth/proposal.md", After: "# Why"},
			{Type: "delete", Path: "openspec/changes/add-auth/old.md", Before: "old"},
		},
	})
	if err != nil || len(set.Mutations) != 2 || set.Mutations[0].ID == "" {
		t.Fatalf("set=%#v err=%v", set, err)
	}
	loaded, err := store.GetDraftSet(context.Background(), set.ID)
	if err != nil || len(loaded.Mutations) != 2 || loaded.Status != operation.DraftAccepted {
		t.Fatalf("loaded=%#v err=%v", loaded, err)
	}
	written, err := store.UpdateDraftSetStatus(context.Background(), set.ID, operation.DraftWritten)
	if err != nil || written.Status != operation.DraftWritten {
		t.Fatalf("written=%#v err=%v", written, err)
	}
}
