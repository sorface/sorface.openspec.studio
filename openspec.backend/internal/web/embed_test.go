package web_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/web"
)

func TestSPAUsesIndexFallback(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/projects/example", nil)
	response := httptest.NewRecorder()
	web.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "OpenSpec Studio") {
		t.Fatalf("unexpected body: %s", response.Body.String())
	}
}
