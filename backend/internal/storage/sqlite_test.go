package storage_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storage"
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
		ProjectID: projectItem.ID, Kind: operation.KindAI, InputJSON: "{}",
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
