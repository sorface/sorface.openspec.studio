package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	aiservice "github.com/sorface/openspec-studio/backend/internal/ai"
	"github.com/sorface/openspec-studio/backend/internal/document"
	"github.com/sorface/openspec-studio/backend/internal/gitstatus"
	"github.com/sorface/openspec-studio/backend/internal/httpapi"
	openspecworkflow "github.com/sorface/openspec-studio/backend/internal/openspec"
	"github.com/sorface/openspec-studio/backend/internal/operation"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/repository"
	"github.com/sorface/openspec-studio/backend/internal/storage"
	"github.com/sorface/openspec-studio/backend/internal/storegit"
	"github.com/sorface/openspec-studio/backend/internal/tools"
)

type fakeStoreManager struct {
	validatePath string
	clonePath    string
	validateErr  error
	cloneErr     error
}

type fakeContextImporter struct {
	validateErr error
	summary     project.ContextImportSummary
}

func (importer fakeContextImporter) ValidateContextRepositories(values []string) ([]string, error) {
	if importer.validateErr != nil {
		return nil, importer.validateErr
	}
	return values, nil
}

func (importer fakeContextImporter) ImportContext(context.Context, project.Project, []string) project.ContextImportSummary {
	return importer.summary
}

type fakeOpenSpecAdapter struct {
	capability openspecworkflow.Capability
	list       openspecworkflow.ListResult
	status     openspecworkflow.Status
	validation openspecworkflow.Validation
}

func (adapter fakeOpenSpecAdapter) Capability(context.Context, string) openspecworkflow.Capability {
	return adapter.capability
}

func (adapter fakeOpenSpecAdapter) List(context.Context, string) (openspecworkflow.ListResult, error) {
	return adapter.list, nil
}

func (adapter fakeOpenSpecAdapter) Status(_ context.Context, root, change string) (openspecworkflow.Status, error) {
	status := adapter.status
	for index := range status.Artifacts {
		if status.Artifacts[index].ID == "proposal" {
			path := filepath.Join(root, "openspec", "changes", change, "proposal.md")
			if _, err := os.Stat(path); err == nil {
				status.Artifacts[index].Status = "done"
			}
		}
	}
	return status, nil
}

func (adapter fakeOpenSpecAdapter) Instructions(_ context.Context, _, _, artifact string) (openspecworkflow.Instructions, error) {
	return openspecworkflow.Instructions{
		ArtifactID: artifact, ResolvedOutputPath: "openspec/changes/add-auth/" + artifact + ".md",
	}, nil
}

func (adapter fakeOpenSpecAdapter) Show(context.Context, string, string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func (adapter fakeOpenSpecAdapter) Validate(context.Context, string, string) (openspecworkflow.Validation, error) {
	return adapter.validation, nil
}

func (adapter fakeOpenSpecAdapter) NewChange(_ context.Context, root, change string) error {
	return os.MkdirAll(filepath.Join(root, "openspec", "changes", change), 0o700)
}

func (adapter fakeOpenSpecAdapter) Archive(_ context.Context, root, change string) error {
	source := filepath.Join(root, "openspec", "changes", change)
	target := filepath.Join(root, "openspec", "changes", "archive", "2026-07-30-"+change)
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	return os.Rename(source, target)
}

func (manager fakeStoreManager) Validate(context.Context, string) (string, error) {
	return manager.validatePath, manager.validateErr
}

func (manager fakeStoreManager) Clone(context.Context, string) (string, error) {
	return manager.clonePath, manager.cloneErr
}

func newHandler(t *testing.T) http.Handler {
	t.Helper()
	store, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	projectService := project.NewService(store)
	server := httpapi.New(httpapi.Options{
		Address:      "127.0.0.1:0",
		Projects:     projectService,
		Documents:    document.NewService(projectService),
		Repositories: repository.NewService(store, processrunner.NewSupervisor(), filepath.Join(t.TempDir(), "projects")),
		AIOperations: aiservice.NewService(store, processrunner.NewSupervisor(), t.TempDir()),
		Static:       http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) { response.WriteHeader(http.StatusOK) }),
		Capabilities: func(context.Context) tools.Capabilities {
			return tools.Capabilities{OS: "test", Arch: "test", Tools: []tools.Tool{{Name: "git", Available: true}}}
		},
	})
	return server.Handler()
}

func csrfToken(t *testing.T, handler http.Handler) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/system/session", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var payload struct {
		Token string `json:"csrfToken"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Token
}

func request(handler http.Handler, method, path string, body []byte, token string) *httptest.ResponseRecorder {
	httpRequest := httptest.NewRequest(method, path, bytes.NewReader(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	if token != "" {
		httpRequest.Header.Set("X-CSRF-Token", token)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httpRequest)
	return response
}

func createGitStore(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "store")
	if err := os.MkdirAll(filepath.Join(root, ".openspec-store"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".openspec-store", "store.yaml"), []byte("store-id: api-test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	documentPath := filepath.Join(root, "openspec", "spec.md")
	if err := os.WriteFile(documentPath, []byte("# Initial\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, arguments := range [][]string{
		{"init"},
		{"add", "."},
		{"-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"},
	} {
		command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", arguments, err, output)
		}
	}
	if err := os.WriteFile(documentPath, []byte("# Changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}

func TestHealthAndCorrelationID(t *testing.T) {
	response := request(newHandler(t), http.MethodGet, "/api/v1/system/health", nil, "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if response.Header().Get("X-Correlation-ID") == "" {
		t.Fatal("correlation id is missing")
	}
}

func TestCapabilities(t *testing.T) {
	response := request(newHandler(t), http.MethodGet, "/api/v1/system/capabilities", nil, "")
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"available":true`)) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body)
	}
}

func TestRejectsForeignOrigin(t *testing.T) {
	handler := newHandler(t)
	httpRequest := httptest.NewRequest(http.MethodGet, "/api/v1/system/health", nil)
	httpRequest.Header.Set("Origin", "https://example.com")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httpRequest)
	if response.Code != http.StatusForbidden || !bytes.Contains(response.Body.Bytes(), []byte("ORIGIN_REJECTED")) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body)
	}
}

func TestRejectsMutationWithoutCSRF(t *testing.T) {
	response := request(newHandler(t), http.MethodPost, "/api/v1/projects", []byte(`{"name":"Test","storePath":"/tmp/store"}`), "")
	if response.Code != http.StatusForbidden || !bytes.Contains(response.Body.Bytes(), []byte("CSRF_REJECTED")) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body)
	}
}

func TestProjectCRUD(t *testing.T) {
	handler := newHandler(t)
	token := csrfToken(t, handler)

	created := request(handler, http.MethodPost, "/api/v1/projects", []byte(`{"name":"Platform","storePath":"/tmp/store"}`), token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body)
	}
	var item project.Project
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}

	list := request(handler, http.MethodGet, "/api/v1/projects", nil, "")
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte(`"Platform"`)) {
		t.Fatalf("list: %d %s", list.Code, list.Body)
	}

	updated := request(handler, http.MethodPatch, "/api/v1/projects/"+item.ID, []byte(`{"name":"Platform 2"}`), token)
	if updated.Code != http.StatusOK || !bytes.Contains(updated.Body.Bytes(), []byte(`"Platform 2"`)) {
		t.Fatalf("update: %d %s", updated.Code, updated.Body)
	}

	deleted := request(handler, http.MethodDelete, "/api/v1/projects/"+item.ID, nil, token)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", deleted.Code, deleted.Body)
	}

	missing := request(handler, http.MethodGet, "/api/v1/projects/"+item.ID, nil, "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing: %d %s", missing.Code, missing.Body)
	}
}

func TestValidatesProjectName(t *testing.T) {
	handler := newHandler(t)
	response := request(handler, http.MethodPost, "/api/v1/projects", []byte(`{"name":"  ","storePath":"/tmp/store"}`), csrfToken(t, handler))
	if response.Code != http.StatusBadRequest || !bytes.Contains(response.Body.Bytes(), []byte("INVALID_PROJECT_NAME")) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body)
	}
}

func TestValidatedLocalAndGitProjectCreation(t *testing.T) {
	database, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	localPath := filepath.Join(t.TempDir(), "local-store")
	clonedPath := filepath.Join(t.TempDir(), "cloned-store")
	if err := os.MkdirAll(clonedPath, 0o700); err != nil {
		t.Fatal(err)
	}
	manager := fakeStoreManager{validatePath: localPath, clonePath: clonedPath}
	projectService := project.NewService(database, manager)
	server := httpapi.New(httpapi.Options{
		Address: "127.0.0.1:0", Projects: projectService, Static: http.NotFoundHandler(),
	})
	handler := server.Handler()
	token := csrfToken(t, handler)

	local := request(handler, http.MethodPost, "/api/v1/projects",
		[]byte(`{"name":"Local","storePath":"/input/store"}`), token)
	if local.Code != http.StatusCreated || !bytes.Contains(local.Body.Bytes(), []byte(localPath)) {
		t.Fatalf("local: %d %s", local.Code, local.Body)
	}
	cloned := request(handler, http.MethodPost, "/api/v1/projects/from-git",
		[]byte(`{"name":"SSH","url":"git@example.com:owner/store.git"}`), token)
	if cloned.Code != http.StatusCreated || !bytes.Contains(cloned.Body.Bytes(), []byte(clonedPath)) {
		t.Fatalf("clone: %d %s", cloned.Code, cloned.Body)
	}
}

func TestProjectCreationImportsContextManifest(t *testing.T) {
	database, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	clonedPath := t.TempDir()
	if err := os.MkdirAll(filepath.Join(clonedPath, ".openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	manifest := "name: sorface.openspec\ncontext:\n  repositories:\n    - git@example.com:team/code.git\n"
	if err := os.WriteFile(filepath.Join(clonedPath, ".openspec", "context.yaml"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := fakeStoreManager{clonePath: clonedPath}
	importer := fakeContextImporter{summary: project.ContextImportSummary{Imported: 1, Failures: []project.ContextImportFailure{}}}
	projectService := project.NewService(database, manager).WithContextImporter(importer)
	server := httpapi.New(httpapi.Options{Address: "127.0.0.1:0", Projects: projectService, Static: http.NotFoundHandler()})
	handler := server.Handler()

	response := request(handler, http.MethodPost, "/api/v1/projects/from-git",
		[]byte(`{"url":"git@example.com:owner/store.git"}`), csrfToken(t, handler))
	if response.Code != http.StatusCreated {
		t.Fatalf("manifest clone: %d %s", response.Code, response.Body)
	}
	var created project.Project
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Name != "sorface.openspec" || created.ContextImport == nil || created.ContextImport.Imported != 1 {
		t.Fatalf("unexpected manifest response: %#v", created)
	}
}

func TestProjectCreationMapsContextManifestErrors(t *testing.T) {
	tests := []struct {
		name         string
		manifest     string
		importer     fakeContextImporter
		expectedCode string
	}{
		{
			name: "invalid manifest", manifest: "name: [invalid\n",
			expectedCode: "INVALID_CONTEXT_MANIFEST",
		},
		{
			name:         "invalid repository url",
			manifest:     "name: demo\ncontext:\n  repositories: [invalid]\n",
			importer:     fakeContextImporter{validateErr: project.ErrInvalidContextRepositoryURL},
			expectedCode: "INVALID_CONTEXT_REPOSITORY_URL",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			database, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			clonedPath := t.TempDir()
			if err := os.MkdirAll(filepath.Join(clonedPath, ".openspec"), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(clonedPath, ".openspec", "context.yaml"), []byte(test.manifest), 0o600); err != nil {
				t.Fatal(err)
			}
			service := project.NewService(database, fakeStoreManager{clonePath: clonedPath}).WithContextImporter(test.importer)
			handler := httpapi.New(httpapi.Options{Projects: service, Static: http.NotFoundHandler()}).Handler()
			response := request(handler, http.MethodPost, "/api/v1/projects/from-git",
				[]byte(`{"url":"git@example.com:owner/store.git"}`), csrfToken(t, handler))
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), test.expectedCode) {
				t.Fatalf("unexpected response: %d %s", response.Code, response.Body)
			}
		})
	}
}

func TestProjectCreationMapsStoreErrors(t *testing.T) {
	database, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	manager := fakeStoreManager{validateErr: project.ErrInvalidStorePath, cloneErr: project.ErrGitAuthFailed}
	server := httpapi.New(httpapi.Options{
		Address: "127.0.0.1:0", Projects: project.NewService(database, manager), Static: http.NotFoundHandler(),
	})
	handler := server.Handler()
	token := csrfToken(t, handler)

	local := request(handler, http.MethodPost, "/api/v1/projects",
		[]byte(`{"name":"Local","storePath":"git@example.com:owner/store.git"}`), token)
	if local.Code != http.StatusBadRequest || !bytes.Contains(local.Body.Bytes(), []byte("INVALID_STORE_PATH")) {
		t.Fatalf("local: %d %s", local.Code, local.Body)
	}
	cloned := request(handler, http.MethodPost, "/api/v1/projects/from-git",
		[]byte(`{"name":"SSH","url":"git@example.com:owner/store.git"}`), token)
	if cloned.Code != http.StatusConflict || !bytes.Contains(cloned.Body.Bytes(), []byte("GIT_AUTH_FAILED")) {
		t.Fatalf("clone: %d %s", cloned.Code, cloned.Body)
	}
}

func TestGitStatusContract(t *testing.T) {
	root := createGitStore(t)
	database, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	item, err := database.Create(context.Background(), project.CreateInput{Name: "Git", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	validator := storegit.NewService()
	projectService := project.NewService(database, validator)
	server := httpapi.New(httpapi.Options{
		Address: "127.0.0.1:0", Projects: projectService,
		GitStatus: gitstatus.NewService(projectService, validator), Static: http.NotFoundHandler(),
	})
	response := request(server.Handler(), http.MethodGet, "/api/v1/projects/"+item.ID+"/git/status", nil, "")
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"openspec/spec.md"`)) ||
		!bytes.Contains(response.Body.Bytes(), []byte(`"diffTruncated":false`)) {
		t.Fatalf("status: %d %s", response.Code, response.Body)
	}
}

func TestOpenSpecReadAPIContracts(t *testing.T) {
	database, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	storeRoot := t.TempDir()
	changeRoot := filepath.Join(storeRoot, "openspec", "changes", "add-auth")
	if err := os.MkdirAll(changeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(changeRoot, "proposal.md"), []byte("# Proposal\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	item, err := database.Create(context.Background(), project.CreateInput{Name: "OpenSpec", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	projectService := project.NewService(database)
	adapter := fakeOpenSpecAdapter{
		capability: openspecworkflow.Capability{Available: true, Supported: true, Version: "1.7.0"},
		list: openspecworkflow.ListResult{Changes: []openspecworkflow.ChangeSummary{{
			Name: "add-auth", CompletedTasks: 1, TotalTasks: 2, Status: "in-progress",
		}}},
		status: openspecworkflow.Status{
			ChangeName: "add-auth", SchemaName: "spec-driven",
			Artifacts: []openspecworkflow.Artifact{{ID: "proposal", Status: "ready"}},
		},
		validation: openspecworkflow.Validation{Valid: false, Diagnostics: []openspecworkflow.Diagnostic{{
			Level: "ERROR", Path: "proposal.md", Message: "missing Why",
		}}},
	}
	server := httpapi.New(httpapi.Options{
		Address:  "127.0.0.1:0",
		Projects: projectService,
		OpenSpec: openspecworkflow.NewService(projectService, adapter),
		Static:   http.NotFoundHandler(),
	})
	handler := server.Handler()
	overview := request(handler, http.MethodGet, "/api/v1/projects/"+item.ID+"/openspec/changes", nil, "")
	if overview.Code != http.StatusOK || !bytes.Contains(overview.Body.Bytes(), []byte(`"add-auth"`)) ||
		!bytes.Contains(overview.Body.Bytes(), []byte(`"supported":true`)) {
		t.Fatalf("overview: %d %s", overview.Code, overview.Body)
	}
	details := request(handler, http.MethodGet, "/api/v1/projects/"+item.ID+"/openspec/changes/add-auth", nil, "")
	if details.Code != http.StatusOK || !bytes.Contains(details.Body.Bytes(), []byte(`"fingerprint"`)) ||
		!bytes.Contains(details.Body.Bytes(), []byte(`"prepare_artifact"`)) ||
		!bytes.Contains(details.Body.Bytes(), []byte(`"totalFiles":1`)) {
		t.Fatalf("details: %d %s", details.Code, details.Body)
	}
	validation := request(
		handler, http.MethodPost, "/api/v1/projects/"+item.ID+"/openspec/validate",
		[]byte(`{"change":"add-auth"}`), csrfToken(t, handler),
	)
	if validation.Code != http.StatusOK || !bytes.Contains(validation.Body.Bytes(), []byte(`"valid":false`)) ||
		!bytes.Contains(validation.Body.Bytes(), []byte(`"proposal.md"`)) {
		t.Fatalf("validation: %d %s", validation.Code, validation.Body)
	}
	var detailsValue openspecworkflow.ChangeDetails
	if err := json.Unmarshal(details.Body.Bytes(), &detailsValue); err != nil {
		t.Fatal(err)
	}
	wrongConfirmation := request(
		handler, http.MethodDelete, "/api/v1/projects/"+item.ID+"/openspec/changes/add-auth",
		[]byte(`{"confirmation":"wrong","statusFingerprint":"`+detailsValue.Fingerprint+`"}`),
		csrfToken(t, handler),
	)
	if wrongConfirmation.Code != http.StatusBadRequest ||
		!bytes.Contains(wrongConfirmation.Body.Bytes(), []byte(`OPENSPEC_DELETE_CONFIRMATION_MISMATCH`)) {
		t.Fatalf("wrong confirmation: %d %s", wrongConfirmation.Code, wrongConfirmation.Body)
	}
	deleted := request(
		handler, http.MethodDelete, "/api/v1/projects/"+item.ID+"/openspec/changes/add-auth",
		[]byte(`{"confirmation":"add-auth","statusFingerprint":"`+detailsValue.Fingerprint+`"}`),
		csrfToken(t, handler),
	)
	if deleted.Code != http.StatusOK || !bytes.Contains(deleted.Body.Bytes(), []byte(`"deleted":true`)) {
		t.Fatalf("delete: %d %s", deleted.Code, deleted.Body)
	}
	if _, err := os.Stat(changeRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("change still exists: %v", err)
	}
}

func TestOpenSpecActionAPIStartsAndReturnsReview(t *testing.T) {
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec", "changes", "add-auth"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storeRoot, "openspec", "config.yaml"), []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nmkdir -p openspec/changes/add-auth\nprintf '## Why\\nGenerated\\n' > openspec/changes/add-auth/proposal.md\nprintf '%s\\n' '{\"message\":\"ready\"}'\n"
	if err := os.WriteFile(filepath.Join(bin, "codex"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	database, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectItem, err := database.Create(context.Background(), project.CreateInput{Name: "OpenSpec", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	projectService := project.NewService(database)
	adapter := fakeOpenSpecAdapter{
		capability: openspecworkflow.Capability{Available: true, Supported: true, Version: "1.7.0"},
		list: openspecworkflow.ListResult{Changes: []openspecworkflow.ChangeSummary{{
			Name: "add-auth", Status: "in-progress",
		}}},
		status: openspecworkflow.Status{
			ChangeName: "add-auth", SchemaName: "spec-driven",
			Artifacts: []openspecworkflow.Artifact{{ID: "proposal", Status: "ready"}},
		},
		validation: openspecworkflow.Validation{Valid: true, Diagnostics: []openspecworkflow.Diagnostic{}},
	}
	workflow := openspecworkflow.NewService(projectService, adapter)
	actions := openspecworkflow.NewActionService(database, workflow, adapter, processrunner.NewSupervisor(), filepath.Join(root, "data"))
	handler := httpapi.New(httpapi.Options{
		Address: "127.0.0.1:0", Projects: projectService, OpenSpec: workflow,
		OpenSpecActions: actions, OpenSpecDrafts: openspecworkflow.NewDraftService(database, filepath.Join(root, "data")),
		Static: http.NotFoundHandler(),
	}).Handler()
	detailsResponse := request(handler, http.MethodGet,
		"/api/v1/projects/"+projectItem.ID+"/openspec/changes/add-auth", nil, "")
	if detailsResponse.Code != http.StatusOK {
		t.Fatalf("details: %d %s", detailsResponse.Code, detailsResponse.Body)
	}
	var details openspecworkflow.ChangeDetails
	if err := json.Unmarshal(detailsResponse.Body.Bytes(), &details); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(openspecworkflow.CreateActionInput{
		Kind: openspecworkflow.ActionPrepare, Change: "add-auth", Artifact: "proposal",
		Goal: "Create proposal", Provider: "codex", StatusFingerprint: details.Fingerprint,
	})
	started := request(handler, http.MethodPost,
		"/api/v1/projects/"+projectItem.ID+"/openspec/actions", body, csrfToken(t, handler))
	if started.Code != http.StatusAccepted {
		t.Fatalf("start: %d %s", started.Code, started.Body)
	}
	var item operation.Operation
	if err := json.Unmarshal(started.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		response := request(handler, http.MethodGet,
			"/api/v1/projects/"+projectItem.ID+"/openspec/operations/"+item.ID, nil, "")
		if response.Code != http.StatusOK {
			t.Fatalf("get: %d %s", response.Code, response.Body)
		}
		if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
		if item.Status.Terminal() {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if item.Status != operation.StatusAwaitingReview ||
		!strings.Contains(item.ResultJSON, `"type":"create"`) {
		t.Fatalf("operation=%#v", item)
	}
	if _, err := os.Stat(filepath.Join(storeRoot, "openspec", "changes", "add-auth", "proposal.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("real Store changed before review")
	}
	accepted := request(handler, http.MethodPost,
		"/api/v1/projects/"+projectItem.ID+"/openspec/operations/"+item.ID+"/accept",
		[]byte(`{}`), csrfToken(t, handler))
	if accepted.Code != http.StatusCreated {
		t.Fatalf("accept: %d %s", accepted.Code, accepted.Body)
	}
	var draft operation.DraftSet
	if err := json.Unmarshal(accepted.Body.Bytes(), &draft); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(storeRoot, "openspec", "changes", "add-auth", "proposal.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("accept changed Store before explicit write")
	}
	written := request(handler, http.MethodPost,
		"/api/v1/projects/"+projectItem.ID+"/openspec/drafts/"+draft.ID+"/write",
		[]byte(`{}`), csrfToken(t, handler))
	if written.Code != http.StatusOK || !bytes.Contains(written.Body.Bytes(), []byte(`"status":"written"`)) {
		t.Fatalf("write: %d %s", written.Code, written.Body)
	}
	content, err := os.ReadFile(filepath.Join(storeRoot, "openspec", "changes", "add-auth", "proposal.md"))
	if err != nil || !strings.Contains(string(content), "Generated") {
		t.Fatalf("written content=%q err=%v", content, err)
	}
}

func TestOpenSpecExploreAPIIsReadOnly(t *testing.T) {
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storeRoot, "openspec", "config.yaml"), []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "codex"), []byte("#!/bin/sh\nprintf '%s\\n' '{\"message\":\"Контекст исследован\"}'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	database, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectItem, err := database.Create(context.Background(), project.CreateInput{Name: "OpenSpec", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	projectService := project.NewService(database)
	adapter := fakeOpenSpecAdapter{
		capability: openspecworkflow.Capability{Available: true, Supported: true, Version: "1.7.0"},
		list:       openspecworkflow.ListResult{Changes: []openspecworkflow.ChangeSummary{}},
	}
	actions := openspecworkflow.NewActionService(
		database,
		openspecworkflow.NewService(projectService, adapter),
		adapter,
		processrunner.NewSupervisor(),
		filepath.Join(root, "data"),
	)
	handler := httpapi.New(httpapi.Options{
		Address: "127.0.0.1:0", Projects: projectService,
		OpenSpec: openspecworkflow.NewService(projectService, adapter), OpenSpecActions: actions,
		Static: http.NotFoundHandler(),
	}).Handler()
	body, _ := json.Marshal(openspecworkflow.CreateActionInput{
		Kind: openspecworkflow.ActionExplore, Goal: "Исследовать задачу", Provider: "codex",
	})
	started := request(handler, http.MethodPost,
		"/api/v1/projects/"+projectItem.ID+"/openspec/actions", body, csrfToken(t, handler))
	if started.Code != http.StatusAccepted {
		t.Fatalf("start explore: %d %s", started.Code, started.Body)
	}
	var item operation.Operation
	if err := json.Unmarshal(started.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		response := request(handler, http.MethodGet,
			"/api/v1/projects/"+projectItem.ID+"/openspec/operations/"+item.ID, nil, "")
		if response.Code != http.StatusOK {
			t.Fatalf("get explore: %d %s", response.Code, response.Body)
		}
		if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
		if item.Status.Terminal() {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if item.Status != operation.StatusAwaitingReview || item.OpenSpecAction != string(openspecworkflow.ActionExplore) ||
		item.OpenSpecChange != "" || !strings.Contains(item.ResultJSON, "Контекст исследован") ||
		!strings.Contains(item.ResultJSON, `"files":[]`) {
		t.Fatalf("explore operation=%#v", item)
	}
	if _, err := os.Stat(filepath.Join(storeRoot, "openspec", "explore.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("explore modified Store: %v", err)
	}
}

func TestRejectsUnknownJSONFields(t *testing.T) {
	handler := newHandler(t)
	response := request(handler, http.MethodPost, "/api/v1/projects", []byte(`{"name":"Test","unknown":true}`), csrfToken(t, handler))
	if response.Code != http.StatusBadRequest || !bytes.Contains(response.Body.Bytes(), []byte("INVALID_REQUEST")) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body)
	}
}

func TestDocumentContracts(t *testing.T) {
	root := t.TempDir()
	documentPath := filepath.Join(root, "openspec", "specs", "example", "spec.md")
	if err := os.MkdirAll(filepath.Dir(documentPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(documentPath, []byte("# Original\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, arguments := range [][]string{
		{"init"},
		{"add", "."},
		{"-c", "user.name=API Test", "-c", "user.email=api@example.com", "commit", "-m", "add specification"},
	} {
		command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", arguments, err, output)
		}
	}

	handler := newHandler(t)
	token := csrfToken(t, handler)
	createBody, err := json.Marshal(project.CreateInput{Name: "Documents", StorePath: root})
	if err != nil {
		t.Fatal(err)
	}
	created := request(handler, http.MethodPost, "/api/v1/projects", createBody, token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body)
	}
	var projectItem project.Project
	if err := json.Unmarshal(created.Body.Bytes(), &projectItem); err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/projects/" + projectItem.ID + "/documents"
	list := request(handler, http.MethodGet, base, nil, "")
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte(`"openspec/specs/example/spec.md"`)) {
		t.Fatalf("list: %d %s", list.Code, list.Body)
	}
	read := request(handler, http.MethodGet, base+"/content?path=openspec%2Fspecs%2Fexample%2Fspec.md", nil, "")
	if read.Code != http.StatusOK {
		t.Fatalf("read: %d %s", read.Code, read.Body)
	}
	var current document.Content
	if err := json.Unmarshal(read.Body.Bytes(), &current); err != nil {
		t.Fatal(err)
	}
	history := request(handler, http.MethodGet, base+"/history?path=openspec%2Fspecs%2Fexample%2Fspec.md", nil, "")
	if history.Code != http.StatusOK || !bytes.Contains(history.Body.Bytes(), []byte(`"subject":"add specification"`)) ||
		!bytes.Contains(history.Body.Bytes(), []byte(`"author":"API Test"`)) {
		t.Fatalf("history: %d %s", history.Code, history.Body)
	}
	writeBody, err := json.Marshal(document.WriteInput{
		Path: current.Path, Content: "# Updated\n", BaseContentHash: current.ContentHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	withoutCSRF := request(handler, http.MethodPut, base+"/content", writeBody, "")
	if withoutCSRF.Code != http.StatusForbidden || !bytes.Contains(withoutCSRF.Body.Bytes(), []byte("CSRF_REJECTED")) {
		t.Fatalf("csrf: %d %s", withoutCSRF.Code, withoutCSRF.Body)
	}
	written := request(handler, http.MethodPut, base+"/content", writeBody, token)
	if written.Code != http.StatusOK || !bytes.Contains(written.Body.Bytes(), []byte("# Updated")) {
		t.Fatalf("write: %d %s", written.Code, written.Body)
	}
	conflict := request(handler, http.MethodPut, base+"/content", writeBody, token)
	if conflict.Code != http.StatusConflict || !bytes.Contains(conflict.Body.Bytes(), []byte("DRAFT_CONFLICT")) {
		t.Fatalf("conflict: %d %s", conflict.Code, conflict.Body)
	}
	unsafe := request(handler, http.MethodGet, base+"/content?path=..%2Fsecret.md", nil, "")
	if unsafe.Code != http.StatusBadRequest || !bytes.Contains(unsafe.Body.Bytes(), []byte("PATH_OUTSIDE_SCOPE")) {
		t.Fatalf("unsafe: %d %s", unsafe.Code, unsafe.Body)
	}
	missing := request(handler, http.MethodGet, "/api/v1/projects/missing/documents", nil, "")
	if missing.Code != http.StatusNotFound || !bytes.Contains(missing.Body.Bytes(), []byte("PROJECT_NOT_FOUND")) {
		t.Fatalf("missing project: %d %s", missing.Code, missing.Body)
	}
}

func TestRepositoryCloneContracts(t *testing.T) {
	handler := newHandler(t)
	token := csrfToken(t, handler)
	created := request(handler, http.MethodPost, "/api/v1/projects", []byte(`{"name":"Platform","storePath":"/tmp/store"}`), token)
	var item project.Project
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	list := request(handler, http.MethodGet, "/api/v1/projects/"+item.ID+"/repositories", nil, "")
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte(`"items":[]`)) {
		t.Fatalf("list: %d %s", list.Code, list.Body)
	}
	invalid := request(handler, http.MethodPost, "/api/v1/projects/"+item.ID+"/repository-clones",
		[]byte(`{"url":"--upload-pack=evil"}`), token)
	if invalid.Code != http.StatusBadRequest || !bytes.Contains(invalid.Body.Bytes(), []byte("INVALID_GIT_URL")) {
		t.Fatalf("invalid: %d %s", invalid.Code, invalid.Body)
	}
	withoutCSRF := request(handler, http.MethodPost, "/api/v1/projects/"+item.ID+"/repository-clones",
		[]byte(`{"url":"https://example.test/code.git"}`), "")
	if withoutCSRF.Code != http.StatusForbidden {
		t.Fatalf("csrf: %d %s", withoutCSRF.Code, withoutCSRF.Body)
	}
}

func TestRepositorySSEReplayAndOwnership(t *testing.T) {
	store, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	projectItem, err := store.Create(context.Background(), project.CreateInput{Name: "One", StorePath: "/store"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.Create(context.Background(), project.CreateInput{Name: "Two", StorePath: "/other"})
	if err != nil {
		t.Fatal(err)
	}
	operationItem, err := store.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindRepositoryClone, Status: operation.StatusFailed,
		InputJSON: "{}", ErrorCode: "GIT_CLONE_FAILED",
	})
	if err != nil {
		t.Fatal(err)
	}
	event, err := store.AddEvent(context.Background(), operation.Event{
		OperationID: operationItem.ID, Type: "failed", Payload: `{"code":"GIT_CLONE_FAILED"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httpapi.New(httpapi.Options{
		Address: "127.0.0.1:0", Projects: project.NewService(store),
		Repositories: repository.NewService(store, processrunner.NewSupervisor()),
		Static:       http.NotFoundHandler(), SSEPollInterval: 2 * time.Millisecond,
		SSEHeartbeatInterval: 5 * time.Millisecond,
	})
	replayRequest := httptest.NewRequest(http.MethodGet,
		"/api/v1/projects/"+projectItem.ID+"/repository-clones/"+operationItem.ID+"/events", nil)
	replay := httptest.NewRecorder()
	server.Handler().ServeHTTP(replay, replayRequest)
	if replay.Code != http.StatusOK || !bytes.Contains(replay.Body.Bytes(), []byte("id: ")) ||
		!bytes.Contains(replay.Body.Bytes(), []byte("event: failed")) {
		t.Fatalf("replay: %d %s", replay.Code, replay.Body)
	}
	resumeRequest := httptest.NewRequest(http.MethodGet,
		"/api/v1/projects/"+projectItem.ID+"/repository-clones/"+operationItem.ID+"/events", nil)
	resumeRequest.Header.Set("Last-Event-ID", fmt.Sprint(event.Sequence))
	resume := httptest.NewRecorder()
	server.Handler().ServeHTTP(resume, resumeRequest)
	if resume.Body.Len() != 0 {
		t.Fatalf("resume replayed old events: %s", resume.Body)
	}
	foreign := request(server.Handler(), http.MethodGet,
		"/api/v1/projects/"+other.ID+"/repository-clones/"+operationItem.ID, nil, "")
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign ownership: %d %s", foreign.Code, foreign.Body)
	}
	active, err := store.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindRepositoryClone,
		Status: operation.StatusQueued, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	streamCtx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	heartbeatRequest := httptest.NewRequest(http.MethodGet,
		"/api/v1/projects/"+projectItem.ID+"/repository-clones/"+active.ID+"/events", nil).WithContext(streamCtx)
	heartbeatResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(heartbeatResponse, heartbeatRequest)
	if !bytes.Contains(heartbeatResponse.Body.Bytes(), []byte(": heartbeat")) {
		t.Fatalf("heartbeat missing: %s", heartbeatResponse.Body)
	}
}

func TestAIContractsAndSSEReplay(t *testing.T) {
	root := t.TempDir()
	storeRoot := filepath.Join(root, "store")
	if err := os.MkdirAll(filepath.Join(storeRoot, "openspec"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storeRoot, "openspec", "config.yaml"), []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	projectItem, err := store.Create(context.Background(), project.CreateInput{Name: "One", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.Create(context.Background(), project.CreateInput{Name: "Two", StorePath: storeRoot})
	if err != nil {
		t.Fatal(err)
	}
	supervisor := processrunner.NewSupervisor()
	server := httpapi.New(httpapi.Options{
		Address: "127.0.0.1:0", Projects: project.NewService(store),
		AIOperations: aiservice.NewService(store, supervisor, filepath.Join(root, "data")),
		Static:       http.NotFoundHandler(), SSEPollInterval: 2 * time.Millisecond,
		SSEHeartbeatInterval: 5 * time.Millisecond,
	})
	handler := server.Handler()
	token := csrfToken(t, handler)
	manifestResponse := request(handler, http.MethodPost,
		"/api/v1/projects/"+projectItem.ID+"/ai/context-manifests", []byte(`{"files":[]}`), token)
	if manifestResponse.Code != http.StatusOK || !bytes.Contains(manifestResponse.Body.Bytes(), []byte("reviewToken")) {
		t.Fatalf("manifest: %d %s", manifestResponse.Code, manifestResponse.Body)
	}
	var manifest struct {
		Token string `json:"reviewToken"`
	}
	if err := json.Unmarshal(manifestResponse.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	unsupported := request(handler, http.MethodPost,
		"/api/v1/projects/"+projectItem.ID+"/ai/operations",
		[]byte(fmt.Sprintf(`{"reviewToken":%q,"prompt":"test","provider":"unknown"}`, manifest.Token)), token)
	if unsupported.Code != http.StatusBadRequest || !bytes.Contains(unsupported.Body.Bytes(), []byte("AI_PROVIDER_UNSUPPORTED")) {
		t.Fatalf("unsupported: %d %s", unsupported.Code, unsupported.Body)
	}
	withoutCSRF := request(handler, http.MethodPost,
		"/api/v1/projects/"+projectItem.ID+"/ai/context-manifests", []byte(`{"files":[]}`), "")
	if withoutCSRF.Code != http.StatusForbidden {
		t.Fatalf("csrf: %d %s", withoutCSRF.Code, withoutCSRF.Body)
	}

	item, err := store.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindAI, Status: operation.StatusFailed,
		InputJSON: "{}", CorrelationID: "correlation-ai", ErrorCode: "AI_PROVIDER_FAILED",
	})
	if err != nil {
		t.Fatal(err)
	}
	event, err := store.AddEvent(context.Background(), operation.Event{
		OperationID: item.ID, Type: "failed", Payload: `{"code":"AI_PROVIDER_FAILED"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	replayRequest := httptest.NewRequest(http.MethodGet,
		"/api/v1/projects/"+projectItem.ID+"/ai/operations/"+item.ID+"/events", nil)
	replayRequest.Header.Set("X-Correlation-ID", "request-correlation")
	replay := httptest.NewRecorder()
	handler.ServeHTTP(replay, replayRequest)
	if !bytes.Contains(replay.Body.Bytes(), []byte(fmt.Sprintf("id: %d", event.Sequence))) ||
		!bytes.Contains(replay.Body.Bytes(), []byte("event: failed")) ||
		replay.Header().Get("X-Correlation-ID") != "request-correlation" {
		t.Fatalf("replay: %d %s headers=%v", replay.Code, replay.Body, replay.Header())
	}
	foreign := request(handler, http.MethodGet,
		"/api/v1/projects/"+other.ID+"/ai/operations/"+item.ID, nil, "")
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("ownership: %d %s", foreign.Code, foreign.Body)
	}
	cancelled := request(handler, http.MethodDelete,
		"/api/v1/projects/"+projectItem.ID+"/ai/operations/"+item.ID, nil, token)
	if cancelled.Code != http.StatusOK {
		t.Fatalf("terminal cancel: %d %s", cancelled.Code, cancelled.Body)
	}
	active, err := store.CreateOperation(context.Background(), operation.Operation{
		ProjectID: projectItem.ID, Kind: operation.KindAI, Status: operation.StatusQueued, InputJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	streamCtx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	heartbeatRequest := httptest.NewRequest(http.MethodGet,
		"/api/v1/projects/"+projectItem.ID+"/ai/operations/"+active.ID+"/events", nil).WithContext(streamCtx)
	heartbeatResponse := httptest.NewRecorder()
	handler.ServeHTTP(heartbeatResponse, heartbeatRequest)
	if !bytes.Contains(heartbeatResponse.Body.Bytes(), []byte(": heartbeat")) {
		t.Fatalf("AI heartbeat missing: %s", heartbeatResponse.Body)
	}
}
