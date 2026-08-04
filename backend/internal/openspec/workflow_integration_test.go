package openspec

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storage"
)

type workflowFixtureAdapter struct {
	validation Validation
}

func (adapter workflowFixtureAdapter) Capability(context.Context, string) Capability {
	return Capability{Available: true, Supported: true, Version: "1.7.0"}
}

func (adapter workflowFixtureAdapter) List(_ context.Context, root string) (ListResult, error) {
	changeRoot := filepath.Join(root, "openspec", "changes", "agent-flow")
	if _, err := os.Stat(changeRoot); errors.Is(err, os.ErrNotExist) {
		return ListResult{Changes: []ChangeSummary{}}, nil
	}
	status, _ := adapter.Status(context.Background(), root, "agent-flow")
	completed := 0
	for _, artifact := range status.Artifacts {
		if artifact.Status == "done" {
			completed++
		}
	}
	return ListResult{Changes: []ChangeSummary{{
		Name: "agent-flow", Status: "in-progress",
		CompletedTasks: completed, TotalTasks: len(status.Artifacts),
	}}}, nil
}

func (adapter workflowFixtureAdapter) Status(_ context.Context, root, change string) (Status, error) {
	outputs := []struct {
		id       string
		path     string
		requires []string
	}{
		{id: "proposal", path: "proposal.md"},
		{id: "specs", path: "specs/example/spec.md", requires: []string{"proposal"}},
		{id: "design", path: "design.md", requires: []string{"specs"}},
		{id: "tasks", path: "tasks.md", requires: []string{"design"}},
	}
	done := map[string]bool{}
	artifacts := make([]Artifact, 0, len(outputs))
	for _, output := range outputs {
		_, err := os.Stat(filepath.Join(root, "openspec", "changes", change, output.path))
		status := "ready"
		if err == nil {
			status, done[output.id] = "done", true
		} else {
			for _, dependency := range output.requires {
				if !done[dependency] {
					status = "blocked"
				}
			}
		}
		missing := []string{}
		if status == "blocked" {
			for _, dependency := range output.requires {
				if !done[dependency] {
					missing = append(missing, dependency)
				}
			}
		}
		artifacts = append(artifacts, Artifact{
			ID: output.id, OutputPath: output.path, Status: status,
			Requires: output.requires, MissingDeps: missing,
		})
	}
	return Status{
		ChangeName: change, SchemaName: "spec-driven",
		IsComplete: done["proposal"] && done["specs"] && done["design"] && done["tasks"],
		Artifacts:  artifacts,
	}, nil
}

func (adapter workflowFixtureAdapter) Instructions(_ context.Context, root, change, artifact string) (Instructions, error) {
	outputs := map[string]string{
		"proposal": "proposal.md",
		"specs":    "specs/example/spec.md",
		"design":   "design.md",
		"tasks":    "tasks.md",
	}
	dependencyIDs := map[string][]string{
		"proposal": {},
		"specs":    {"proposal"},
		"design":   {"proposal", "specs"},
		"tasks":    {"proposal", "specs", "design"},
	}
	dependencyPaths := map[string]string{
		"proposal": "proposal.md",
		"specs":    "specs/example/spec.md",
		"design":   "design.md",
	}
	dependencies := make([]InstructionDependency, 0, len(dependencyIDs[artifact]))
	for _, dependency := range dependencyIDs[artifact] {
		dependencies = append(dependencies, InstructionDependency{
			ID: dependency, Done: true,
			Path: filepath.ToSlash(filepath.Join("openspec", "changes", change, dependencyPaths[dependency])),
		})
	}
	return Instructions{
		ArtifactID: artifact, Instruction: "Prepare " + artifact,
		Context: "Fixture context", Rules: []string{"Use Markdown"},
		Template:           "## Generated",
		ResolvedOutputPath: filepath.Join(root, "openspec", "changes", change, outputs[artifact]),
		Dependencies:       dependencies,
	}, nil
}

func (adapter workflowFixtureAdapter) Show(context.Context, string, string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func (adapter workflowFixtureAdapter) Validate(context.Context, string, string) (Validation, error) {
	if adapter.validation.Diagnostics != nil || adapter.validation.Valid {
		return adapter.validation, nil
	}
	return Validation{Valid: true, Diagnostics: []Diagnostic{}}, nil
}

func (workflowFixtureAdapter) NewChange(_ context.Context, root, change string) error {
	return os.MkdirAll(filepath.Join(root, "openspec", "changes", change), 0o700)
}

func (workflowFixtureAdapter) Archive(_ context.Context, root, change string) error {
	source := filepath.Join(root, "openspec", "changes", change)
	target := filepath.Join(root, "openspec", "changes", "archive", "2026-07-30-"+change)
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	return os.Rename(source, target)
}

func TestAgentWorkflowCreatesAllArtifactsAndArchivesOnlyAfterWrite(t *testing.T) {
	root, storeRoot, database, projectItem, actionService, draftService, workflow :=
		newWorkflowFixture(t, workflowFixtureAdapter{})
	defer database.Close()

	runAndWriteWorkflowAction(t, actionService, draftService, workflow, projectItem.ID, CreateActionInput{
		Kind: ActionCreate, Change: "agent-flow", Proposal: "## Why\n\nAccepted proposal",
	})
	createdStatus, err := workflow.adapter.Status(context.Background(), storeRoot, "agent-flow")
	if err != nil || !artifactDone(createdStatus, "proposal") || artifactDone(createdStatus, "specs") {
		t.Fatalf("create must prepare only proposal: status=%#v err=%v", createdStatus, err)
	}
	details, err := workflow.Details(context.Background(), projectItem.ID, "agent-flow")
	if err != nil {
		t.Fatal(err)
	}
	runAndWriteWorkflowAction(t, actionService, draftService, workflow, projectItem.ID, CreateActionInput{
		Kind: ActionPrepare, Change: "agent-flow", Artifact: "specs",
		Goal: "Prepare specs", Provider: "codex", StatusFingerprint: details.Fingerprint,
	})
	for _, artifact := range []string{"design", "tasks"} {
		details, err = workflow.Details(context.Background(), projectItem.ID, "agent-flow")
		if err != nil {
			t.Fatal(err)
		}
		runAndWriteWorkflowAction(t, actionService, draftService, workflow, projectItem.ID, CreateActionInput{
			Kind: ActionPrepare, Change: "agent-flow", Artifact: artifact,
			Goal: "Prepare " + artifact, Provider: "codex", StatusFingerprint: details.Fingerprint,
		})
		status, err := workflow.adapter.Status(context.Background(), storeRoot, "agent-flow")
		if err != nil || !artifactDone(status, artifact) {
			t.Fatalf("artifact=%s status=%#v err=%v", artifact, status, err)
		}
	}

	details, err = workflow.Details(context.Background(), projectItem.ID, "agent-flow")
	if err != nil || !details.Complete {
		t.Fatalf("details=%#v err=%v", details, err)
	}
	operationItem, err := actionService.Start(context.Background(), projectItem.ID, CreateActionInput{
		Kind: ActionArchive, Change: "agent-flow", StatusFingerprint: details.Fingerprint,
	})
	if err != nil {
		t.Fatal(err)
	}
	operationItem = waitForOpenSpecOperation(t, actionService, projectItem.ID, operationItem.ID)
	if operationItem.Status != operation.StatusAwaitingReview {
		t.Fatalf("archive operation=%#v", operationItem)
	}
	if _, err := os.Stat(filepath.Join(storeRoot, "openspec", "changes", "agent-flow", "tasks.md")); err != nil {
		t.Fatalf("archive preview changed Store before acceptance: %v", err)
	}
	set, err := draftService.Accept(context.Background(), projectItem.ID, operationItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := draftService.Write(context.Background(), projectItem.ID, set.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(storeRoot, "openspec", "changes", "archive", "2026-07-30-agent-flow", "tasks.md")); err != nil {
		t.Fatalf("archive was not written: %v", err)
	}
	if _, err := os.Stat(filepath.Join(storeRoot, "openspec", "changes", "agent-flow")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("archived change source directory still exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "data", "operations", operationItem.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("isolated operation workspace was not cleaned up: %v", err)
	}
}

func TestFixValidationFailureProducesNoRealStoreChanges(t *testing.T) {
	adapter := workflowFixtureAdapter{validation: Validation{
		Valid:       false,
		Diagnostics: []Diagnostic{{Level: "ERROR", Path: "proposal.md", Message: "missing requirement"}},
	}}
	_, storeRoot, database, projectItem, actionService, _, workflow := newWorkflowFixture(t, adapter)
	defer database.Close()
	changeRoot := filepath.Join(storeRoot, "openspec", "changes", "agent-flow")
	if err := os.MkdirAll(filepath.Join(changeRoot, "specs", "example"), 0o700); err != nil {
		t.Fatal(err)
	}
	for path, content := range map[string]string{
		"proposal.md":           "before proposal",
		"specs/example/spec.md": "spec",
		"design.md":             "design",
		"tasks.md":              "tasks",
	} {
		if err := os.WriteFile(filepath.Join(changeRoot, path), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	details, err := workflow.Details(context.Background(), projectItem.ID, "agent-flow")
	if err != nil {
		t.Fatal(err)
	}
	item, err := actionService.Start(context.Background(), projectItem.ID, CreateActionInput{
		Kind: ActionFix, Change: "agent-flow", Artifact: "proposal",
		Goal: "Fix proposal", Provider: "codex", StatusFingerprint: details.Fingerprint,
	})
	if err != nil {
		t.Fatal(err)
	}
	item = waitForOpenSpecOperation(t, actionService, projectItem.ID, item.ID)
	if item.Status != operation.StatusFailed || item.ErrorCode != "OPENSPEC_VALIDATION_FAILED" ||
		!strings.Contains(item.ResultJSON, "missing requirement") {
		t.Fatalf("operation=%#v", item)
	}
	content, err := os.ReadFile(filepath.Join(changeRoot, "proposal.md"))
	if err != nil || string(content) != "before proposal" {
		t.Fatalf("real Store changed: content=%q err=%v", content, err)
	}
}

func newWorkflowFixture(
	t *testing.T,
	adapter workflowFixtureAdapter,
) (string, string, *storage.SQLite, project.Project, *ActionService, *DraftService, *Service) {
	t.Helper()
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec", "changes"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storeRoot, "openspec", "config.yaml"), []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	script := `#!/bin/sh
target=""
while IFS= read -r line; do
  case "$line" in
    "Declared output: "*) target="${line#Declared output: }" ;;
  esac
done
if [ -z "$target" ]; then exit 2; fi
mkdir -p "$(dirname "$target")"
printf '## Generated\n\n%s\n' "$target" > "$target"
printf '%s\n' '{"message":"artifact ready"}'
`
	if err := os.WriteFile(filepath.Join(bin, "codex"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	database, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	projectItem, err := database.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: storeRoot})
	if err != nil {
		database.Close()
		t.Fatal(err)
	}
	workflow := NewService(database, adapter)
	actionService := NewActionService(database, workflow, adapter, processrunner.NewSupervisor(), filepath.Join(root, "data"))
	draftService := NewDraftService(database, filepath.Join(root, "data"))
	return root, storeRoot, database, projectItem, actionService, draftService, workflow
}

func runAndWriteWorkflowAction(
	t *testing.T,
	actionService *ActionService,
	draftService *DraftService,
	workflow *Service,
	projectID string,
	input CreateActionInput,
) {
	t.Helper()
	item, err := actionService.Start(context.Background(), projectID, input)
	if err != nil {
		t.Fatal(err)
	}
	item = waitForOpenSpecOperation(t, actionService, projectID, item.ID)
	if item.Status != operation.StatusAwaitingReview {
		t.Fatalf("operation=%#v", item)
	}
	set, err := draftService.Accept(context.Background(), projectID, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := draftService.Write(context.Background(), projectID, set.ID); err != nil {
		t.Fatal(err)
	}
	details, err := workflow.Details(context.Background(), projectID, "agent-flow")
	if err != nil || details.Fingerprint == "" {
		t.Fatalf("details after write=%#v err=%v", details, err)
	}
}

func waitForOpenSpecOperation(t *testing.T, service *ActionService, projectID, operationID string) operation.Operation {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		item, err := service.Get(context.Background(), projectID, operationID)
		if err != nil {
			t.Fatal(err)
		}
		if item.Status.Terminal() {
			return item
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("operation timed out")
	return operation.Operation{}
}

func artifactDone(status Status, artifact string) bool {
	for _, item := range status.Artifacts {
		if item.ID == artifact {
			return item.Status == "done"
		}
	}
	return false
}
