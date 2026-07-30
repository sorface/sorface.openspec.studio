package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	aiservice "github.com/sorface/openspec-studio/backend/internal/ai"
	"github.com/sorface/openspec-studio/backend/internal/httpapi"
	"github.com/sorface/openspec-studio/backend/internal/operation"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/repository"
	"github.com/sorface/openspec-studio/backend/internal/storage"
	"github.com/sorface/openspec-studio/backend/internal/tools"
)

func newHandler(t *testing.T) http.Handler {
	t.Helper()
	store, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	server := httpapi.New(httpapi.Options{
		Address:      "127.0.0.1:0",
		Projects:     project.NewService(store),
		Repositories: repository.NewService(store, processrunner.NewSupervisor()),
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

func TestRejectsUnknownJSONFields(t *testing.T) {
	handler := newHandler(t)
	response := request(handler, http.MethodPost, "/api/v1/projects", []byte(`{"name":"Test","unknown":true}`), csrfToken(t, handler))
	if response.Code != http.StatusBadRequest || !bytes.Contains(response.Body.Bytes(), []byte("INVALID_REQUEST")) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body)
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
		[]byte(`{"url":"--upload-pack=evil","targetPath":"/tmp/clone"}`), token)
	if invalid.Code != http.StatusBadRequest || !bytes.Contains(invalid.Body.Bytes(), []byte("INVALID_GIT_URL")) {
		t.Fatalf("invalid: %d %s", invalid.Code, invalid.Body)
	}
	withoutCSRF := request(handler, http.MethodPost, "/api/v1/projects/"+item.ID+"/repository-clones",
		[]byte(`{"url":"https://example.test/code.git","targetPath":"/tmp/clone"}`), "")
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
