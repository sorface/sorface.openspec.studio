package ai

import (
	"context"
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

func TestResolveEntriesFiltersTraversalAndSecrets(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "spec.md"), []byte("# Spec"), 0o600); err != nil {
		t.Fatal(err)
	}
	entries, err := resolveEntries(map[string]string{"store": root}, []ContextIntent{{Source: "store", Path: "spec.md"}})
	if err != nil || len(entries) != 1 || entries[0].Checksum == "" {
		t.Fatalf("entries=%#v err=%v", entries, err)
	}
	for _, testCase := range []struct{ path, reason string }{
		{"../outside", "PATH_OUTSIDE_SCOPE"},
		{".env", "DENYLIST"},
		{"private.key", "DENYLIST"},
	} {
		items, err := resolveEntries(map[string]string{"store": root}, []ContextIntent{{Source: "store", Path: testCase.path}})
		if err != nil || len(items) != 1 || items[0].Included || items[0].Reason != testCase.reason {
			t.Fatalf("path=%s items=%#v err=%v", testCase.path, items, err)
		}
	}
	binary := filepath.Join(root, "binary.bin")
	if err := os.WriteFile(binary, []byte{0, 1, 2}, 0o600); err != nil {
		t.Fatal(err)
	}
	items, err := resolveEntries(map[string]string{"store": root}, []ContextIntent{{Source: "store", Path: "binary.bin"}})
	if err != nil || items[0].Reason != "BINARY_FILE" {
		t.Fatalf("binary items=%#v err=%v", items, err)
	}
	large := filepath.Join(root, "large.txt")
	if err := os.WriteFile(large, make([]byte, maxFileBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	items, err = resolveEntries(map[string]string{"store": root}, []ContextIntent{{Source: "store", Path: "large.txt"}})
	if err != nil || items[0].Reason != "FILE_TOO_LARGE" {
		t.Fatalf("large items=%#v err=%v", items, err)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape.md")); err != nil {
		t.Fatal(err)
	}
	items, err = resolveEntries(map[string]string{"store": root}, []ContextIntent{{Source: "store", Path: "escape.md"}})
	if err != nil || items[0].Reason != "PATH_OUTSIDE_SCOPE" {
		t.Fatalf("symlink items=%#v err=%v", items, err)
	}
}

func TestFakeAgentEndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test")
	}
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(storeRoot, "openspec", "config.yaml")
	if err := os.WriteFile(configPath, []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "bin")
	if err := os.Mkdir(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	fake := filepath.Join(bin, "codex")
	script := "#!/bin/sh\nprintf 'schema: changed\\n' > openspec/config.yaml\nprintf '%s\\n' '{\"message\":\"done\"}'\n"
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	db, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	projectItem, err := db.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(db, processrunner.NewSupervisor(), filepath.Join(root, "data"))
	manifest, err := service.BuildManifest(context.Background(), projectItem.ID, ManifestRequest{})
	if err != nil {
		t.Fatal(err)
	}
	item, err := service.Start(context.Background(), projectItem.ID, CreateInput{
		ReviewToken: manifest.Token, Prompt: "Update schema", Provider: "codex",
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		item, err = db.GetOperation(context.Background(), item.ID)
		if err != nil {
			t.Fatal(err)
		}
		if item.Status.Terminal() {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if item.Status != operation.StatusAwaitingReview || !strings.Contains(item.ResultJSON, "openspec/config.yaml") {
		t.Fatalf("operation=%#v", item)
	}
	events, err := db.ListEvents(context.Background(), item.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	foundProviderEvent := false
	for _, event := range events {
		foundProviderEvent = foundProviderEvent || event.Type == "provider_event"
	}
	if !foundProviderEvent {
		t.Fatalf("normalized provider event not persisted: %#v", events)
	}
	contextEntries, err := db.ListContext(context.Background(), item.ID)
	if err != nil || len(contextEntries) != 1 || contextEntries[0].Checksum == "" {
		t.Fatalf("context=%#v err=%v", contextEntries, err)
	}
	audit, err := db.GetAudit(context.Background(), item.ID)
	if err != nil || audit.Executable != "codex" || strings.Contains(audit.Arguments, "Update schema") {
		t.Fatalf("audit=%#v err=%v", audit, err)
	}
	actual, _ := os.ReadFile(configPath)
	if string(actual) != "schema: spec-driven\n" {
		t.Fatal("real Store changed")
	}
}

func TestWorkspaceAndAuditLeaveStoreUnchanged(t *testing.T) {
	store := t.TempDir()
	path := filepath.Join(store, "proposal.md")
	if err := os.WriteFile(path, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	entry := resolvedEntry{
		ContextEntry: operationEntry("store", "proposal.md", []byte("before")),
		content:      []byte("before"),
	}
	baseline, working, cleanup, err := createWorkspace(t.TempDir(), "op", store, []resolvedEntry{entry})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	empty, err := auditWorkspace(baseline, working)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty diff=%#v err=%v", empty, err)
	}
	if err := os.WriteFile(filepath.Join(working, "proposal.md"), []byte("after"), 0o600); err != nil {
		t.Fatal(err)
	}
	diff, err := auditWorkspace(baseline, working)
	if err != nil || len(diff) != 1 || diff[0].After != "after" {
		t.Fatalf("diff=%#v err=%v", diff, err)
	}
	actual, _ := os.ReadFile(path)
	if string(actual) != "before" {
		t.Fatal("real Store was modified")
	}
	if err := os.WriteFile(filepath.Join(working, ".env"), []byte("SECRET=value"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := auditWorkspace(baseline, working); !errors.Is(err, ErrScopeViolation) {
		t.Fatalf("expected forbidden path violation, got %v", err)
	}
}

func TestCodexArgumentsAndPromptEnvelope(t *testing.T) {
	args, err := providerArguments("codex", "gpt-5", "/tmp/work", "", false)
	if err != nil || strings.Join(args, " ") != "exec --json --ephemeral --sandbox workspace-write --skip-git-repo-check --cd /tmp/work --model gpt-5 -" {
		t.Fatalf("args=%v err=%v", args, err)
	}
	if _, err := providerArguments("codex", "--dangerous", "/tmp/work", "", false); err == nil {
		t.Fatal("unsafe model accepted")
	}
	fastArgs, err := providerArguments("codex", "gpt-5", "/tmp/work", "low", true)
	if err != nil || !strings.Contains(strings.Join(fastArgs, " "), `--config model_reasoning_effort="low"`) {
		t.Fatalf("fast args=%v err=%v", fastArgs, err)
	}
	repositoryEntry := resolvedEntry{
		ContextEntry: operationEntry("repository-1", "src/main.go", []byte("package main")),
		content:      []byte("package main"),
		absolute:     "/private/repository/src/main.go",
	}
	envelope := promptEnvelope("Review", []resolvedEntry{repositoryEntry})
	if !strings.Contains(envelope, "source=repository-1 path=src/main.go") ||
		!strings.Contains(envelope, "package main") ||
		strings.Contains(envelope, repositoryEntry.absolute) {
		t.Fatalf("unsafe prompt envelope: %s", envelope)
	}
}

func TestReviewTokenTamperingAndExpiry(t *testing.T) {
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(storeRoot, "openspec", "config.yaml")
	if err := os.WriteFile(path, []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	db, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	projectItem, err := db.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(db, processrunner.NewSupervisor(), filepath.Join(root, "data"))
	manifest, err := service.BuildManifest(context.Background(), projectItem.ID, ManifestRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("schema: changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(context.Background(), projectItem.ID, CreateInput{
		ReviewToken: manifest.Token, Prompt: "test", Provider: "codex",
	}); !errors.Is(err, ErrContextStale) {
		t.Fatalf("expected stale checksum, got %v", err)
	}
	if err := os.WriteFile(path, []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest, err = service.BuildManifest(context.Background(), projectItem.ID, ManifestRequest{})
	if err != nil {
		t.Fatal(err)
	}
	service.mu.Lock()
	stored := service.manifests[manifest.Token]
	stored.expiresAt = time.Now().Add(-time.Second)
	service.manifests[manifest.Token] = stored
	service.mu.Unlock()
	if _, err := service.Start(context.Background(), projectItem.ID, CreateInput{
		ReviewToken: manifest.Token, Prompt: "test", Provider: "codex",
	}); !errors.Is(err, ErrContextStale) {
		t.Fatalf("expected expired token, got %v", err)
	}
}

func TestProviderProbeAndGigaCodeFixture(t *testing.T) {
	root := t.TempDir()
	fake := filepath.Join(root, "gigacode")
	script := "#!/bin/sh\nif [ \"$1\" = \"--help\" ]; then echo '--non-interactive --json --cwd'; exit 0; fi\n"
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", root+string(os.PathListSeparator)+os.Getenv("PATH"))
	capability := ProbeProvider(context.Background(), "gigacode")
	if !capability.Available || !capability.Supported || !capability.NonInteractive {
		t.Fatalf("capability=%#v", capability)
	}
	args, err := providerArguments("gigacode", "model-1", "/tmp/work", "", false)
	if err != nil || strings.Join(args, " ") != "--non-interactive --json --cwd /tmp/work --model model-1 -" {
		t.Fatalf("args=%v err=%v", args, err)
	}
}

func TestProviderUnavailableAndUnsupported(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, err := providerPath("codex"); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("expected unavailable provider, got %v", err)
	}
	if _, err := providerPath("unknown"); !errors.Is(err, ErrProviderUnsupported) {
		t.Fatalf("expected unsupported provider, got %v", err)
	}
	if diagnostic := safeDiagnostic("token=very-secret"); strings.Contains(diagnostic, "very-secret") {
		t.Fatalf("provider diagnostic leaked secret: %q", diagnostic)
	}
}

func TestProviderEventsAndSourceAudit(t *testing.T) {
	events := normalizeProviderEvents("{\"type\":\"item.completed\"}\nnot-json\n")
	if len(events) != 2 || events[0].Type != "provider_event" || events[1].Type != "provider_diagnostic" {
		t.Fatalf("events=%#v", events)
	}
	root := t.TempDir()
	path := filepath.Join(root, "file.md")
	if err := os.WriteFile(path, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	entry := resolvedEntry{ContextEntry: operationEntry("repository", "file.md", []byte("before")), absolute: path, content: []byte("before")}
	if err := verifySources([]resolvedEntry{entry}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("after"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifySources([]resolvedEntry{entry}); !errors.Is(err, ErrScopeViolation) {
		t.Fatalf("expected scope violation, got %v", err)
	}
}

func TestAiConflictTimeoutAndCancellation(t *testing.T) {
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storeRoot, "openspec", "config.yaml"), []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "bin")
	if err := os.Mkdir(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "codex"), []byte("#!/bin/sh\nsleep 10\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	db, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	projectItem, err := db.Create(context.Background(), project.CreateInput{Name: "Test", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	supervisor := processrunner.NewSupervisor()
	service := NewService(db, supervisor, filepath.Join(root, "data"))
	active, err := db.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindAI, Status: operation.StatusQueued, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := service.BuildManifest(context.Background(), projectItem.ID, ManifestRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(context.Background(), projectItem.ID, CreateInput{
		ReviewToken: manifest.Token, Prompt: "test", Provider: "codex",
	}); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	active.Status = operation.StatusFailed
	if _, err := db.UpdateOperation(context.Background(), active); err != nil {
		t.Fatal(err)
	}

	service.timeout = 30 * time.Millisecond
	manifest, _ = service.BuildManifest(context.Background(), projectItem.ID, ManifestRequest{})
	timed, err := service.Start(context.Background(), projectItem.ID, CreateInput{
		ReviewToken: manifest.Token, Prompt: "timeout", Provider: "codex",
	})
	if err != nil {
		t.Fatal(err)
	}
	timed = waitTerminal(t, db, timed.ID)
	if timed.Status != operation.StatusFailed || timed.ErrorCode != "AI_TIMEOUT" {
		t.Fatalf("timeout operation=%#v", timed)
	}

	service.timeout = 10 * time.Second
	manifest, _ = service.BuildManifest(context.Background(), projectItem.ID, ManifestRequest{})
	cancelled, err := service.Start(context.Background(), projectItem.ID, CreateInput{
		ReviewToken: manifest.Token, Prompt: "cancel", Provider: "codex",
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		cancelled, _ = db.GetOperation(context.Background(), cancelled.ID)
		if cancelled.Status == operation.StatusRunning {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := service.Cancel(context.Background(), projectItem.ID, cancelled.ID); err != nil {
		t.Fatal(err)
	}
	cancelled = waitTerminal(t, db, cancelled.ID)
	if cancelled.Status != operation.StatusCancelled {
		t.Fatalf("cancelled operation=%#v", cancelled)
	}
}

func waitTerminal(t *testing.T, db *storage.SQLite, id string) operation.Operation {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		item, err := db.GetOperation(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if item.Status.Terminal() {
			return item
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("operation did not finish")
	return operation.Operation{}
}

func operationEntry(source, path string, content []byte) operation.ContextEntry {
	return operation.ContextEntry{Source: source, Path: path, Size: int64(len(content)), Checksum: checksum(content), Included: true}
}
