package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/httpapi"
	"github.com/sorface/openspec-studio/backend/internal/project"
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
		Address:  "127.0.0.1:0",
		Projects: project.NewService(store),
		Static:   http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) { response.WriteHeader(http.StatusOK) }),
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
