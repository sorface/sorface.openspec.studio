package openspec

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/project"
)

type fakeProjects struct {
	item project.Project
	err  error
}

func (store fakeProjects) Get(context.Context, string) (project.Project, error) {
	return store.item, store.err
}

type fakeAdapter struct {
	capability   Capability
	list         ListResult
	status       Status
	instructions map[string]Instructions
	validation   Validation
}

func (adapter fakeAdapter) Capability(context.Context, string) Capability {
	return adapter.capability
}
func (adapter fakeAdapter) List(context.Context, string) (ListResult, error) {
	return adapter.list, nil
}
func (adapter fakeAdapter) Status(context.Context, string, string) (Status, error) {
	return adapter.status, nil
}
func (adapter fakeAdapter) Instructions(_ context.Context, _, _, artifact string) (Instructions, error) {
	return adapter.instructions[artifact], nil
}
func (adapter fakeAdapter) Show(context.Context, string, string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}
func (adapter fakeAdapter) Validate(context.Context, string, string) (Validation, error) {
	return adapter.validation, nil
}

func TestDetailsComputesActionsAndFingerprint(t *testing.T) {
	root := t.TempDir()
	proposal := filepath.Join(root, "openspec", "changes", "add-auth", "proposal.md")
	if err := os.MkdirAll(filepath.Dir(proposal), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(proposal, []byte("# Proposal\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	adapter := fakeAdapter{
		capability: Capability{Available: true, Supported: true, Version: "1.7.0"},
		list:       ListResult{Changes: []ChangeSummary{{Name: "add-auth", Status: "in-progress"}}},
		status: Status{
			ChangeName: "add-auth", SchemaName: "spec-driven",
			Artifacts: []Artifact{
				{ID: "proposal", Status: "done"},
				{ID: "design", Status: "ready", Requires: []string{"proposal"}},
				{ID: "tasks", Status: "blocked", MissingDeps: []string{"design"}},
			},
		},
		instructions: map[string]Instructions{
			"proposal": {ArtifactID: "proposal", ResolvedOutputPath: proposal},
			"design": {
				ArtifactID: "design", ResolvedOutputPath: filepath.Join(root, "openspec/changes/add-auth/design.md"),
				Dependencies: []InstructionDependency{{ID: "proposal", Done: true, Path: "openspec/changes/add-auth/proposal.md"}},
			},
		},
	}
	service := NewService(fakeProjects{item: project.Project{ID: "p1", StorePath: root}}, adapter)
	details, err := service.Details(context.Background(), "p1", "add-auth")
	if err != nil || details.Schema != "spec-driven" || details.Fingerprint == "" || len(details.Actions) != 4 {
		t.Fatalf("details=%#v err=%v", details, err)
	}
	if !details.Actions[1].Available || details.Actions[2].Available ||
		details.Actions[2].Reason != "MISSING_DEPENDENCIES" || details.Actions[3].Available {
		t.Fatalf("actions=%#v", details.Actions)
	}
	previous := details.Fingerprint
	if err := os.WriteFile(proposal, []byte("# Changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	details, err = service.Details(context.Background(), "p1", "add-auth")
	if err != nil || details.Fingerprint == previous {
		t.Fatalf("fingerprint did not change: before=%s after=%s err=%v", previous, details.Fingerprint, err)
	}
	if details.Deletion.TotalFiles != 1 ||
		details.Deletion.Files[0] != "openspec/changes/add-auth/proposal.md" {
		t.Fatalf("deletion preview=%#v", details.Deletion)
	}
}

func TestDeleteRequiresCurrentFingerprintAndExactConfirmation(t *testing.T) {
	root := t.TempDir()
	changeRoot := filepath.Join(root, "openspec", "changes", "remove-me")
	if err := os.MkdirAll(filepath.Join(changeRoot, "specs", "example"), 0o700); err != nil {
		t.Fatal(err)
	}
	for path, content := range map[string]string{
		"proposal.md":           "# Proposal\n",
		"specs/example/spec.md": "# Spec\n",
	} {
		if err := os.WriteFile(filepath.Join(changeRoot, path), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	adapter := fakeAdapter{
		capability: Capability{Available: true, Supported: true},
		list: ListResult{Changes: []ChangeSummary{{
			Name: "remove-me", Status: "in-progress",
		}}},
		status:       Status{ChangeName: "remove-me", SchemaName: "spec-driven"},
		instructions: map[string]Instructions{},
	}
	service := NewService(fakeProjects{item: project.Project{ID: "p1", StorePath: root}}, adapter)
	details, err := service.Details(context.Background(), "p1", "remove-me")
	if err != nil || details.Deletion.TotalFiles != 2 ||
		details.Deletion.Files[0] != "openspec/changes/remove-me/proposal.md" {
		t.Fatalf("details=%#v err=%v", details, err)
	}
	if _, err := service.Delete(context.Background(), "p1", "remove-me", DeleteChangeInput{
		Confirmation: "wrong", StatusFingerprint: details.Fingerprint,
	}); !errors.Is(err, ErrDeleteConfirmation) {
		t.Fatalf("confirmation err=%v", err)
	}
	if err := os.WriteFile(filepath.Join(changeRoot, "proposal.md"), []byte("# Changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Delete(context.Background(), "p1", "remove-me", DeleteChangeInput{
		Confirmation: "remove-me", StatusFingerprint: details.Fingerprint,
	}); !errors.Is(err, ErrStatusStale) {
		t.Fatalf("stale err=%v", err)
	}
	current, err := service.Details(context.Background(), "p1", "remove-me")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Delete(context.Background(), "p1", "remove-me", DeleteChangeInput{
		Confirmation: "remove-me", StatusFingerprint: current.Fingerprint,
	})
	if err != nil || !result.Deleted || len(result.DeletedFiles) != 2 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if _, err := os.Stat(changeRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("change still exists: %v", err)
	}
}

func TestDeleteRejectsUnsafeChangeRoots(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "outside")
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatal(err)
	}
	changesRoot := filepath.Join(root, "openspec", "changes")
	if err := os.MkdirAll(changesRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(changesRoot, "linked-change")); err != nil {
		t.Fatal(err)
	}
	adapter := fakeAdapter{
		capability:   Capability{Available: true, Supported: true},
		list:         ListResult{Changes: []ChangeSummary{{Name: "linked-change"}}},
		status:       Status{ChangeName: "linked-change"},
		instructions: map[string]Instructions{},
	}
	service := NewService(fakeProjects{item: project.Project{ID: "p1", StorePath: root}}, adapter)
	if _, err := service.Details(context.Background(), "p1", "linked-change"); !errors.Is(err, ErrInvalidChange) {
		t.Fatalf("symlink err=%v", err)
	}
	if _, err := service.Delete(context.Background(), "p1", "../outside", DeleteChangeInput{
		Confirmation: "../outside", StatusFingerprint: "fingerprint",
	}); !errors.Is(err, ErrInvalidChange) {
		t.Fatalf("traversal err=%v", err)
	}
}

func TestOverviewRejectsUnsupportedCLI(t *testing.T) {
	service := NewService(
		fakeProjects{item: project.Project{ID: "p1", StorePath: t.TempDir()}},
		fakeAdapter{capability: Capability{Available: true, Supported: false, Version: "2.0.0"}},
	)
	overview, err := service.Overview(context.Background(), "p1")
	if err != ErrVersionUnsupported || overview.Capability.Version != "2.0.0" {
		t.Fatalf("overview=%#v err=%v", overview, err)
	}
}
