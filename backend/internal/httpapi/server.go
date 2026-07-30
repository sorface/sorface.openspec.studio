package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	aiservice "github.com/sorface/openspec-studio/backend/internal/ai"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/repository"
	"github.com/sorface/openspec-studio/backend/internal/tools"
)

type Server struct {
	address              string
	csrfToken            string
	projects             *project.Service
	static               http.Handler
	logger               *slog.Logger
	capabilities         func(context.Context) tools.Capabilities
	repositories         *repository.Service
	aiOperations         *aiservice.Service
	ssePollInterval      time.Duration
	sseHeartbeatInterval time.Duration
}

type Options struct {
	Address              string
	Projects             *project.Service
	Static               http.Handler
	Logger               *slog.Logger
	Capabilities         func(context.Context) tools.Capabilities
	Repositories         *repository.Service
	AIOperations         *aiservice.Service
	SSEPollInterval      time.Duration
	SSEHeartbeatInterval time.Duration
}

func New(options Options) *Server {
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.Capabilities == nil {
		options.Capabilities = tools.Detect
	}
	pollInterval := options.SSEPollInterval
	if pollInterval <= 0 {
		pollInterval = 250 * time.Millisecond
	}
	heartbeatInterval := options.SSEHeartbeatInterval
	if heartbeatInterval <= 0 {
		heartbeatInterval = 15 * time.Second
	}
	return &Server{
		address:              options.Address,
		csrfToken:            randomToken(),
		projects:             options.Projects,
		static:               options.Static,
		logger:               options.Logger,
		capabilities:         options.Capabilities,
		repositories:         options.Repositories,
		aiOperations:         options.AIOperations,
		ssePollInterval:      pollInterval,
		sseHeartbeatInterval: heartbeatInterval,
	}
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/system/health", server.health)
	mux.HandleFunc("GET /api/v1/system/session", server.session)
	mux.HandleFunc("GET /api/v1/system/capabilities", server.systemCapabilities)
	mux.HandleFunc("GET /api/v1/projects", server.listProjects)
	mux.HandleFunc("POST /api/v1/projects", server.createProject)
	mux.HandleFunc("GET /api/v1/projects/{projectId}", server.getProject)
	mux.HandleFunc("PATCH /api/v1/projects/{projectId}", server.updateProject)
	mux.HandleFunc("DELETE /api/v1/projects/{projectId}", server.deleteProject)
	if server.repositories != nil {
		mux.HandleFunc("GET /api/v1/projects/{projectId}/repositories", server.listRepositories)
		mux.HandleFunc("POST /api/v1/projects/{projectId}/repository-clones", server.createRepositoryClone)
		mux.HandleFunc("GET /api/v1/projects/{projectId}/repository-clones/{operationId}", server.getRepositoryClone)
		mux.HandleFunc("DELETE /api/v1/projects/{projectId}/repository-clones/{operationId}", server.cancelRepositoryClone)
		mux.HandleFunc("GET /api/v1/projects/{projectId}/repository-clones/{operationId}/events", server.repositoryCloneEvents)
	}
	if server.aiOperations != nil {
		mux.HandleFunc("POST /api/v1/projects/{projectId}/ai/context-manifests", server.createAIContextManifest)
		mux.HandleFunc("POST /api/v1/projects/{projectId}/ai/operations", server.createAIOperation)
		mux.HandleFunc("GET /api/v1/projects/{projectId}/ai/operations/{operationId}", server.getAIOperation)
		mux.HandleFunc("DELETE /api/v1/projects/{projectId}/ai/operations/{operationId}", server.cancelAIOperation)
		mux.HandleFunc("GET /api/v1/projects/{projectId}/ai/operations/{operationId}/events", server.aiOperationEvents)
	}
	mux.Handle("/", server.static)
	return server.withRecovery(server.withSecurity(server.withCorrelationID(mux)))
}

func (server *Server) createAIContextManifest(response http.ResponseWriter, request *http.Request) {
	var input aiservice.ManifestRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		server.writeError(response, request, http.StatusBadRequest, "INVALID_REQUEST", "Некорректный JSON", nil)
		return
	}
	manifest, err := server.aiOperations.BuildManifest(request.Context(), request.PathValue("projectId"), input)
	if err != nil {
		server.handleAIError(response, request, err)
		return
	}
	writeJSON(response, http.StatusOK, manifest)
}

func (server *Server) createAIOperation(response http.ResponseWriter, request *http.Request) {
	var input aiservice.CreateInput
	if err := decodeJSON(request.Body, &input); err != nil {
		server.writeError(response, request, http.StatusBadRequest, "INVALID_REQUEST", "Некорректный JSON", nil)
		return
	}
	input.CorrelationID = correlationID(request)
	item, err := server.aiOperations.Start(request.Context(), request.PathValue("projectId"), input)
	if err != nil {
		server.handleAIError(response, request, err)
		return
	}
	writeJSON(response, http.StatusAccepted, item)
}

func (server *Server) getAIOperation(response http.ResponseWriter, request *http.Request) {
	item, err := server.aiOperations.Get(request.Context(), request.PathValue("projectId"), request.PathValue("operationId"))
	if err != nil {
		server.handleAIError(response, request, err)
		return
	}
	writeJSON(response, http.StatusOK, item)
}

func (server *Server) cancelAIOperation(response http.ResponseWriter, request *http.Request) {
	item, err := server.aiOperations.Cancel(request.Context(), request.PathValue("projectId"), request.PathValue("operationId"))
	if err != nil {
		server.handleAIError(response, request, err)
		return
	}
	writeJSON(response, http.StatusOK, item)
}

func (server *Server) aiOperationEvents(response http.ResponseWriter, request *http.Request) {
	after, _ := strconv.ParseInt(request.Header.Get("Last-Event-ID"), 10, 64)
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	flusher, ok := response.(http.Flusher)
	if !ok {
		return
	}
	ticker := time.NewTicker(server.ssePollInterval)
	heartbeat := time.NewTicker(server.sseHeartbeatInterval)
	defer ticker.Stop()
	defer heartbeat.Stop()
	for {
		events, err := server.aiOperations.Events(request.Context(), request.PathValue("projectId"), request.PathValue("operationId"), after)
		if err != nil {
			return
		}
		for _, event := range events {
			fmt.Fprintf(response, "id: %d\nevent: %s\ndata: %s\n\n", event.Sequence, event.Type, event.Payload)
			after = event.Sequence
			flusher.Flush()
		}
		item, err := server.aiOperations.Get(request.Context(), request.PathValue("projectId"), request.PathValue("operationId"))
		if err != nil || item.Status.Terminal() {
			return
		}
		select {
		case <-request.Context().Done():
			return
		case <-ticker.C:
		case <-heartbeat.C:
			fmt.Fprint(response, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

func (server *Server) handleAIError(response http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, project.ErrNotFound):
		server.writeError(response, request, http.StatusNotFound, "PROJECT_NOT_FOUND", "Проект или операция не найдены", nil)
	case errors.Is(err, aiservice.ErrProviderUnavailable):
		server.writeError(response, request, http.StatusConflict, "AI_PROVIDER_UNAVAILABLE", "Agent CLI недоступен", nil)
	case errors.Is(err, aiservice.ErrProviderUnsupported):
		server.writeError(response, request, http.StatusBadRequest, "AI_PROVIDER_UNSUPPORTED", "Agent CLI не поддерживает безопасный режим", nil)
	case errors.Is(err, aiservice.ErrOperationConflict):
		server.writeError(response, request, http.StatusConflict, "AI_OPERATION_CONFLICT", "AI-операция уже выполняется", nil)
	case errors.Is(err, aiservice.ErrContextStale):
		server.writeError(response, request, http.StatusConflict, "AI_CONTEXT_STALE", "Контекст изменился, проверьте его повторно", nil)
	case errors.Is(err, aiservice.ErrInvalidContext):
		server.writeError(response, request, http.StatusBadRequest, "INVALID_AI_CONTEXT", "Контекст не разрешён", nil)
	default:
		server.writeError(response, request, http.StatusInternalServerError, "INTERNAL_ERROR", "AI-операция не выполнена", nil)
	}
}

func (server *Server) listRepositories(response http.ResponseWriter, request *http.Request) {
	items, err := server.repositories.List(request.Context(), request.PathValue("projectId"))
	if err != nil {
		server.handleRepositoryError(response, request, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": items})
}

func (server *Server) createRepositoryClone(response http.ResponseWriter, request *http.Request) {
	var input repository.CloneInput
	if err := decodeJSON(request.Body, &input); err != nil {
		server.writeError(response, request, http.StatusBadRequest, "INVALID_REQUEST", "Некорректный JSON", nil)
		return
	}
	input.CorrelationID = correlationID(request)
	item, err := server.repositories.StartClone(request.Context(), request.PathValue("projectId"), input)
	if err != nil {
		server.handleRepositoryError(response, request, err)
		return
	}
	writeJSON(response, http.StatusAccepted, item)
}

func (server *Server) getRepositoryClone(response http.ResponseWriter, request *http.Request) {
	item, err := server.repositories.Get(request.Context(), request.PathValue("projectId"), request.PathValue("operationId"))
	if err != nil {
		server.handleRepositoryError(response, request, err)
		return
	}
	writeJSON(response, http.StatusOK, item)
}

func (server *Server) cancelRepositoryClone(response http.ResponseWriter, request *http.Request) {
	item, err := server.repositories.Cancel(request.Context(), request.PathValue("projectId"), request.PathValue("operationId"))
	if err != nil {
		server.handleRepositoryError(response, request, err)
		return
	}
	writeJSON(response, http.StatusOK, item)
}

func (server *Server) repositoryCloneEvents(response http.ResponseWriter, request *http.Request) {
	after, _ := strconv.ParseInt(request.Header.Get("Last-Event-ID"), 10, 64)
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := response.(http.Flusher)
	if !ok {
		server.writeError(response, request, http.StatusInternalServerError, "SSE_UNAVAILABLE", "SSE недоступен", nil)
		return
	}
	ticker := time.NewTicker(server.ssePollInterval)
	heartbeat := time.NewTicker(server.sseHeartbeatInterval)
	defer ticker.Stop()
	defer heartbeat.Stop()
	for {
		events, err := server.repositories.Events(request.Context(), request.PathValue("projectId"), request.PathValue("operationId"), after)
		if err != nil {
			return
		}
		for _, event := range events {
			fmt.Fprintf(response, "id: %d\nevent: %s\ndata: %s\n\n", event.Sequence, event.Type, event.Payload)
			after = event.Sequence
			flusher.Flush()
		}
		item, err := server.repositories.Get(request.Context(), request.PathValue("projectId"), request.PathValue("operationId"))
		if err != nil || item.Status.Terminal() {
			return
		}
		select {
		case <-request.Context().Done():
			return
		case <-ticker.C:
		case <-heartbeat.C:
			fmt.Fprint(response, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

func (server *Server) handleRepositoryError(response http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, project.ErrNotFound):
		server.writeError(response, request, http.StatusNotFound, "PROJECT_NOT_FOUND", "Проект или операция не найдены", nil)
	case errors.Is(err, repository.ErrInvalidGitURL):
		server.writeError(response, request, http.StatusBadRequest, "INVALID_GIT_URL", "Некорректный Git URL", nil)
	case errors.Is(err, repository.ErrTargetNotEmpty):
		server.writeError(response, request, http.StatusConflict, "CLONE_TARGET_NOT_EMPTY", "Целевой каталог не пуст", nil)
	case errors.Is(err, repository.ErrPathOutsideScope):
		server.writeError(response, request, http.StatusBadRequest, "PATH_OUTSIDE_SCOPE", "Целевой путь не разрешён", nil)
	case errors.Is(err, repository.ErrOperationConflict):
		server.writeError(response, request, http.StatusConflict, "REPOSITORY_CLONE_CONFLICT", "Клонирование уже выполняется", nil)
	default:
		server.writeError(response, request, http.StatusInternalServerError, "INTERNAL_ERROR", "Операция с репозиторием не выполнена", nil)
	}
}

func (server *Server) Listen(ctx context.Context) (string, error) {
	listener, err := net.Listen("tcp", server.address)
	if err != nil {
		return "", err
	}

	httpServer := &http.Server{
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serverURL := "http://" + listener.Addr().String()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	go func() {
		if serveErr := httpServer.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			server.logger.Error("local server stopped", "error", serveErr)
		}
	}()
	return serverURL, nil
}

func (server *Server) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"status":  "ready",
		"service": "openspec-studio",
	})
}

func (server *Server) session(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{"csrfToken": server.csrfToken})
}

func (server *Server) systemCapabilities(response http.ResponseWriter, request *http.Request) {
	writeJSON(response, http.StatusOK, server.capabilities(request.Context()))
}

func (server *Server) listProjects(response http.ResponseWriter, request *http.Request) {
	items, err := server.projects.List(request.Context())
	if err != nil {
		server.writeError(response, request, http.StatusInternalServerError, "INTERNAL_ERROR", "Не удалось получить проекты", nil)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": items})
}

func (server *Server) createProject(response http.ResponseWriter, request *http.Request) {
	var input project.CreateInput
	if err := decodeJSON(request.Body, &input); err != nil {
		server.writeError(response, request, http.StatusBadRequest, "INVALID_REQUEST", "Некорректный JSON", nil)
		return
	}
	item, err := server.projects.Create(request.Context(), input)
	if errors.Is(err, project.ErrInvalidName) {
		server.writeError(response, request, http.StatusBadRequest, "INVALID_PROJECT_NAME", "Название проекта обязательно", nil)
		return
	}
	if err != nil {
		server.writeError(response, request, http.StatusInternalServerError, "INTERNAL_ERROR", "Не удалось создать проект", nil)
		return
	}
	writeJSON(response, http.StatusCreated, item)
}

func (server *Server) getProject(response http.ResponseWriter, request *http.Request) {
	item, err := server.projects.Get(request.Context(), request.PathValue("projectId"))
	if !server.handleProjectError(response, request, err) {
		return
	}
	writeJSON(response, http.StatusOK, item)
}

func (server *Server) updateProject(response http.ResponseWriter, request *http.Request) {
	var input project.UpdateInput
	if err := decodeJSON(request.Body, &input); err != nil {
		server.writeError(response, request, http.StatusBadRequest, "INVALID_REQUEST", "Некорректный JSON", nil)
		return
	}
	item, err := server.projects.Update(request.Context(), request.PathValue("projectId"), input)
	if !server.handleProjectError(response, request, err) {
		return
	}
	writeJSON(response, http.StatusOK, item)
}

func (server *Server) deleteProject(response http.ResponseWriter, request *http.Request) {
	err := server.projects.Delete(request.Context(), request.PathValue("projectId"))
	if !server.handleProjectError(response, request, err) {
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (server *Server) handleProjectError(response http.ResponseWriter, request *http.Request, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, project.ErrNotFound):
		server.writeError(response, request, http.StatusNotFound, "PROJECT_NOT_FOUND", "Проект не найден", nil)
	case errors.Is(err, project.ErrInvalidName):
		server.writeError(response, request, http.StatusBadRequest, "INVALID_PROJECT_NAME", "Название проекта обязательно", nil)
	default:
		server.writeError(response, request, http.StatusInternalServerError, "INTERNAL_ERROR", "Операция с проектом не выполнена", nil)
	}
	return false
}

func (server *Server) withSecurity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if origin := request.Header.Get("Origin"); origin != "" && !isLocalOrigin(origin) {
			server.writeError(response, request, http.StatusForbidden, "ORIGIN_REJECTED", "Origin не разрешён", nil)
			return
		}
		if request.Method != http.MethodGet && request.Method != http.MethodHead && request.Method != http.MethodOptions {
			if request.Header.Get("X-CSRF-Token") != server.csrfToken {
				server.writeError(response, request, http.StatusForbidden, "CSRF_REJECTED", "CSRF token недействителен", nil)
				return
			}
		}
		next.ServeHTTP(response, request)
	})
}

func (server *Server) withCorrelationID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		id := request.Header.Get("X-Correlation-ID")
		if id == "" {
			id = randomToken()
		}
		response.Header().Set("X-Correlation-ID", id)
		next.ServeHTTP(response, request.WithContext(context.WithValue(request.Context(), correlationKey{}, id)))
	})
}

func (server *Server) withRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				server.logger.Error("request panic", "correlationId", correlationID(request), "error", recovered)
				server.writeError(response, request, http.StatusInternalServerError, "INTERNAL_ERROR", "Внутренняя ошибка", nil)
			}
		}()
		next.ServeHTTP(response, request)
	})
}

func (server *Server) writeError(response http.ResponseWriter, request *http.Request, status int, code, message string, details any) {
	writeJSON(response, status, map[string]any{
		"error": map[string]any{
			"code":          code,
			"message":       message,
			"details":       details,
			"correlationId": correlationID(request),
		},
	})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func decodeJSON(body io.ReadCloser, target any) error {
	defer body.Close()
	decoder := json.NewDecoder(io.LimitReader(body, 1<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func isLocalOrigin(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil {
		return false
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	return parsed.Scheme == "http" && (host == "localhost" || (ip != nil && ip.IsLoopback()))
}

type correlationKey struct{}

func correlationID(request *http.Request) string {
	value, _ := request.Context().Value(correlationKey{}).(string)
	return value
}

func randomToken() string {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		panic(fmt.Sprintf("crypto/rand: %v", err))
	}
	return hex.EncodeToString(bytes)
}
