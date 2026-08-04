package ai

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

var (
	ErrProviderUnavailable = errors.New("ai provider unavailable")
	ErrProviderUnsupported = errors.New("ai provider unsupported")
	ErrOperationConflict   = errors.New("ai operation conflict")
	ErrContextStale        = errors.New("ai context stale")
	ErrInvalidContext      = errors.New("invalid ai context")
	ErrScopeViolation      = errors.New("ai scope violation")
)

const (
	maxFiles     = 100
	maxFileBytes = 1 << 20
	maxTotal     = 4 << 20
)

type Store interface {
	Get(context.Context, string) (project.Project, error)
	CreateOperation(context.Context, operation.Operation) (operation.Operation, error)
	GetOperation(context.Context, string) (operation.Operation, error)
	UpdateOperation(context.Context, operation.Operation) (operation.Operation, error)
	HasActiveOperation(context.Context, string, operation.Kind) (bool, error)
	AddEvent(context.Context, operation.Event) (operation.Event, error)
	ListEvents(context.Context, string, int64) ([]operation.Event, error)
	ListRepositories(context.Context, string) ([]operation.RepositoryLink, error)
	SaveContext(context.Context, string, []operation.ContextEntry) error
	SaveAudit(context.Context, operation.Audit) error
}

type ContextIntent struct {
	Source string `json:"source"`
	Path   string `json:"path"`
}

type ManifestRequest struct {
	Files []ContextIntent `json:"files"`
}

type Manifest struct {
	Token     string                   `json:"reviewToken"`
	Entries   []operation.ContextEntry `json:"entries"`
	ExpiresAt time.Time                `json:"expiresAt"`
	Limits    map[string]int64         `json:"limits"`
}

type CreateInput struct {
	ReviewToken     string `json:"reviewToken"`
	Prompt          string `json:"prompt"`
	Provider        string `json:"provider"`
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
	CorrelationID   string `json:"-"`
}

type ProviderCapability struct {
	Name           string   `json:"name"`
	Available      bool     `json:"available"`
	Supported      bool     `json:"supported"`
	NonInteractive bool     `json:"nonInteractive"`
	Models         []string `json:"models"`
	Path           string   `json:"path,omitempty"`
}

type Provider interface {
	Capability(context.Context) ProviderCapability
	Arguments(model, working string) ([]string, error)
}

func ProbeProvider(ctx context.Context, name string) ProviderCapability {
	name = strings.ToLower(strings.TrimSpace(name))
	path, err := exec.LookPath(name)
	if err != nil {
		return ProviderCapability{Name: name}
	}
	capability := ProviderCapability{Name: name, Available: true, Path: path}
	switch name {
	case "codex":
		capability.Supported, capability.NonInteractive = true, true
	case "gigacode":
		probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		output, err := exec.CommandContext(probeCtx, path, "--help").CombinedOutput()
		help := string(output)
		capability.Supported = err == nil &&
			strings.Contains(help, "--non-interactive") &&
			strings.Contains(help, "--json") &&
			strings.Contains(help, "--cwd")
		capability.NonInteractive = capability.Supported
	}
	return capability
}

type reviewedManifest struct {
	projectID string
	entries   []resolvedEntry
	expiresAt time.Time
}

type resolvedEntry struct {
	operation.ContextEntry
	absolute string
	content  []byte
}

type Service struct {
	store      Store
	runner     processrunner.Runner
	supervisor *processrunner.Supervisor
	dataDir    string
	mu         sync.Mutex
	manifests  map[string]reviewedManifest
	timeout    time.Duration
}

func NewService(store Store, supervisor *processrunner.Supervisor, dataDir string) *Service {
	return &Service{store: store, supervisor: supervisor, dataDir: dataDir, manifests: make(map[string]reviewedManifest), timeout: 10 * time.Minute}
}

func (service *Service) BuildManifest(ctx context.Context, projectID string, request ManifestRequest) (Manifest, error) {
	projectItem, err := service.store.Get(ctx, projectID)
	if err != nil {
		return Manifest{}, err
	}
	repositories, err := service.store.ListRepositories(ctx, projectID)
	if err != nil {
		return Manifest{}, err
	}
	roots := map[string]string{"store": projectItem.StorePath}
	for _, repository := range repositories {
		roots[repository.ID] = repository.Path
	}
	intents := request.Files
	if len(intents) == 0 {
		intents = []ContextIntent{{Source: "store", Path: "openspec/config.yaml"}}
	}
	entries, err := resolveEntries(roots, intents)
	if err != nil {
		return Manifest{}, err
	}
	token := randomToken()
	expires := time.Now().UTC().Add(10 * time.Minute)
	service.mu.Lock()
	service.manifests[token] = reviewedManifest{projectID: projectID, entries: entries, expiresAt: expires}
	service.mu.Unlock()
	public := make([]operation.ContextEntry, len(entries))
	for index := range entries {
		public[index] = entries[index].ContextEntry
	}
	return Manifest{
		Token: token, Entries: public, ExpiresAt: expires,
		Limits: map[string]int64{"maxFiles": maxFiles, "maxFileBytes": maxFileBytes, "maxTotalBytes": maxTotal},
	}, nil
}

func (service *Service) Start(ctx context.Context, projectID string, input CreateInput) (operation.Operation, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return operation.Operation{}, ErrInvalidContext
	}
	if input.ReasoningEffort != "" && input.ReasoningEffort != "low" {
		return operation.Operation{}, ErrInvalidContext
	}
	service.mu.Lock()
	manifest, ok := service.manifests[input.ReviewToken]
	if ok {
		delete(service.manifests, input.ReviewToken)
	}
	service.mu.Unlock()
	if !ok || manifest.projectID != projectID || time.Now().After(manifest.expiresAt) {
		return operation.Operation{}, ErrContextStale
	}
	included := 0
	for index := range manifest.entries {
		if !manifest.entries[index].Included {
			continue
		}
		included++
		content, err := os.ReadFile(manifest.entries[index].absolute)
		if err != nil || checksum(content) != manifest.entries[index].Checksum {
			return operation.Operation{}, ErrContextStale
		}
		manifest.entries[index].content = content
	}
	if included == 0 {
		return operation.Operation{}, ErrInvalidContext
	}
	if _, err := providerPath(input.Provider); err != nil {
		return operation.Operation{}, err
	}
	active, err := service.store.HasActiveOperation(ctx, projectID, operation.KindAI)
	if err != nil {
		return operation.Operation{}, err
	}
	if active {
		return operation.Operation{}, ErrOperationConflict
	}
	operationInput, _ := json.Marshal(map[string]string{
		"reasoningEffort": input.ReasoningEffort,
	})
	item, err := service.store.CreateOperation(ctx, operation.Operation{
		ProjectID: projectID, Kind: operation.KindAI, Status: operation.StatusQueued,
		Provider: strings.ToLower(input.Provider), Model: input.Model, Prompt: input.Prompt,
		InputJSON: string(operationInput), CorrelationID: input.CorrelationID,
	})
	if err != nil {
		return operation.Operation{}, err
	}
	public := make([]operation.ContextEntry, len(manifest.entries))
	for index := range manifest.entries {
		public[index] = manifest.entries[index].ContextEntry
		public[index].OperationID = item.ID
	}
	if err := service.store.SaveContext(ctx, item.ID, public); err != nil {
		return operation.Operation{}, err
	}
	_, _ = service.store.AddEvent(ctx, operation.Event{OperationID: item.ID, Type: "queued", Payload: `{}`})
	go service.run(item, manifest.entries)
	return item, nil
}

func (service *Service) Get(ctx context.Context, projectID, id string) (operation.Operation, error) {
	item, err := service.store.GetOperation(ctx, id)
	if err != nil {
		return item, err
	}
	if item.ProjectID != projectID || item.Kind != operation.KindAI {
		return operation.Operation{}, project.ErrNotFound
	}
	return item, nil
}

func (service *Service) Events(ctx context.Context, projectID, id string, after int64) ([]operation.Event, error) {
	if _, err := service.Get(ctx, projectID, id); err != nil {
		return nil, err
	}
	return service.store.ListEvents(ctx, id, after)
}

func (service *Service) Cancel(ctx context.Context, projectID, id string) (operation.Operation, error) {
	item, err := service.Get(ctx, projectID, id)
	if err != nil || item.Status.Terminal() {
		return item, err
	}
	service.supervisor.Cancel(id)
	item.Status = operation.StatusCancelled
	item, err = service.store.UpdateOperation(ctx, item)
	if err == nil {
		_, _ = service.store.AddEvent(ctx, operation.Event{OperationID: id, Type: "cancelled", Payload: `{}`})
	}
	return item, err
}

func (service *Service) run(item operation.Operation, entries []resolvedEntry) {
	ctx, done := service.supervisor.Context(context.Background(), item.ID)
	defer done()
	var operationInput struct {
		ReasoningEffort string `json:"reasoningEffort"`
	}
	_ = json.Unmarshal([]byte(item.InputJSON), &operationInput)
	projectItem, err := service.store.Get(ctx, item.ProjectID)
	if err != nil {
		service.finish(item, operation.StatusFailed, "PROJECT_NOT_FOUND", err.Error(), "")
		return
	}
	baseline, working, cleanup, err := createWorkspace(service.dataDir, item.ID, projectItem.StorePath, entries)
	if err != nil {
		service.finish(item, operation.StatusFailed, "AI_WORKSPACE_FAILED", err.Error(), "")
		return
	}
	defer cleanup()
	item.Status = operation.StatusRunning
	item, _ = service.store.UpdateOperation(ctx, item)
	_, _ = service.store.AddEvent(ctx, operation.Event{OperationID: item.ID, Type: "running", Payload: `{}`})

	executable, err := providerPath(item.Provider)
	if err != nil {
		service.finish(item, operation.StatusFailed, "AI_PROVIDER_UNAVAILABLE", err.Error(), "")
		return
	}
	args, err := providerArguments(item.Provider, item.Model, working, operationInput.ReasoningEffort, false)
	if err != nil {
		service.finish(item, operation.StatusFailed, "AI_PROVIDER_UNSUPPORTED", err.Error(), "")
		return
	}
	envelope := promptEnvelope(item.Prompt, entries)
	result, runErr := service.runner.Run(ctx, processrunner.Command{
		Executable: executable, Arguments: args, Directory: working, Stdin: envelope,
		Timeout: service.timeout, MaxOutputBytes: 1 << 20,
	})
	_ = service.store.SaveAudit(context.Background(), operation.Audit{
		OperationID: item.ID, Executable: filepath.Base(executable),
		Arguments: strings.Join(result.Arguments, " "), ExitCode: result.ExitCode,
		StopReason: result.StopReason, StdoutBytes: int64(len(result.Stdout)),
		StderrBytes: int64(len(result.Stderr)), DurationMS: result.Duration.Milliseconds(),
	})
	if runErr != nil {
		code := "AI_PROVIDER_FAILED"
		if errors.Is(runErr, processrunner.ErrOutputLimit) {
			code = "AI_OUTPUT_LIMIT_EXCEEDED"
		} else if result.StopReason == "timeout" {
			service.finish(item, operation.StatusFailed, "AI_TIMEOUT", "Agent CLI превысил timeout", "")
			return
		} else if ctx.Err() != nil || result.StopReason == "cancelled" {
			service.finish(item, operation.StatusCancelled, "", "", "")
			return
		}
		service.finish(item, operation.StatusFailed, code, safeDiagnostic(result.Stderr), "")
		return
	}
	for _, event := range normalizeProviderEvents(result.Stdout) {
		event.OperationID = item.ID
		_, _ = service.store.AddEvent(context.Background(), event)
	}
	item.Status = operation.StatusValidating
	item, _ = service.store.UpdateOperation(context.Background(), item)
	_, _ = service.store.AddEvent(context.Background(), operation.Event{OperationID: item.ID, Type: "validating", Payload: `{}`})
	if err := verifySources(entries); err != nil {
		service.finish(item, operation.StatusFailed, "AI_SCOPE_VIOLATION", err.Error(), "")
		return
	}
	diff, err := auditWorkspace(baseline, working)
	if err != nil {
		service.finish(item, operation.StatusFailed, "AI_SCOPE_VIOLATION", err.Error(), "")
		return
	}
	final := finalResponse(result.Stdout)
	payload, _ := json.Marshal(map[string]any{"finalResponse": final, "files": diff})
	service.finish(item, operation.StatusAwaitingReview, "", "", string(payload))
}

func (service *Service) finish(item operation.Operation, status operation.Status, code, message, result string) {
	current, err := service.store.GetOperation(context.Background(), item.ID)
	if err != nil || current.Status.Terminal() {
		return
	}
	current.Status, current.ErrorCode, current.ErrorMessage, current.ResultJSON = status, code, message, result
	if _, err := service.store.UpdateOperation(context.Background(), current); err == nil {
		payload, _ := json.Marshal(map[string]string{"code": code, "message": message})
		_, _ = service.store.AddEvent(context.Background(), operation.Event{OperationID: item.ID, Type: string(status), Payload: string(payload)})
	}
}

func resolveEntries(roots map[string]string, intents []ContextIntent) ([]resolvedEntry, error) {
	if len(intents) > maxFiles {
		return nil, ErrInvalidContext
	}
	var total int64
	result := make([]resolvedEntry, 0, len(intents))
	for _, intent := range intents {
		root, ok := roots[intent.Source]
		excluded := func(reason string) {
			result = append(result, resolvedEntry{ContextEntry: operation.ContextEntry{
				Source: intent.Source, Path: filepath.ToSlash(intent.Path), Reason: reason, Included: false,
			}})
		}
		if !ok || filepath.IsAbs(intent.Path) || hasTraversal(intent.Path) {
			excluded("PATH_OUTSIDE_SCOPE")
			continue
		}
		if denied(intent.Path) {
			excluded("DENYLIST")
			continue
		}
		root, err := filepath.EvalSymlinks(root)
		if err != nil {
			excluded("ROOT_UNAVAILABLE")
			continue
		}
		candidate := filepath.Join(root, filepath.Clean(intent.Path))
		resolved, err := filepath.EvalSymlinks(candidate)
		if err != nil || (resolved != root && !strings.HasPrefix(resolved, root+string(filepath.Separator))) {
			excluded("PATH_OUTSIDE_SCOPE")
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil || !info.Mode().IsRegular() {
			excluded("FILE_UNAVAILABLE")
			continue
		}
		if info.Size() > maxFileBytes {
			excluded("FILE_TOO_LARGE")
			continue
		}
		content, err := os.ReadFile(resolved)
		if err != nil {
			excluded("FILE_UNAVAILABLE")
			continue
		}
		if isBinary(content) {
			excluded("BINARY_FILE")
			continue
		}
		total += info.Size()
		if total > maxTotal {
			excluded("TOTAL_LIMIT_EXCEEDED")
			continue
		}
		result = append(result, resolvedEntry{
			ContextEntry: operation.ContextEntry{
				Source: intent.Source, Path: filepath.ToSlash(intent.Path), Size: info.Size(),
				Checksum: checksum(content), Reason: "selected", Included: true,
			},
			absolute: resolved, content: content,
		})
	}
	return result, nil
}

func createWorkspace(dataDir, id, storeRoot string, entries []resolvedEntry) (string, string, func(), error) {
	root := filepath.Join(dataDir, "operations", id)
	baseline, working := filepath.Join(root, "baseline"), filepath.Join(root, "working")
	if err := os.MkdirAll(baseline, 0o700); err != nil {
		return "", "", func() {}, err
	}
	if err := os.MkdirAll(working, 0o700); err != nil {
		_ = os.RemoveAll(root)
		return "", "", func() {}, err
	}
	for _, entry := range entries {
		if !entry.Included || entry.Source != "store" {
			continue
		}
		for _, destination := range []string{filepath.Join(baseline, entry.Path), filepath.Join(working, entry.Path)} {
			if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
				_ = os.RemoveAll(root)
				return "", "", func() {}, err
			}
			if err := os.WriteFile(destination, entry.content, 0o600); err != nil {
				_ = os.RemoveAll(root)
				return "", "", func() {}, err
			}
		}
	}
	_ = storeRoot // The real Store is intentionally never passed to the provider.
	return baseline, working, func() { _ = os.RemoveAll(root) }, nil
}

type fileDiff struct {
	Path   string `json:"path"`
	Before string `json:"before"`
	After  string `json:"after"`
}

func auditWorkspace(baseline, working string) ([]fileDiff, error) {
	paths := map[string]bool{}
	for _, root := range []string{baseline, working} {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return ErrScopeViolation
			}
			if entry.IsDir() {
				return nil
			}
			if !entry.Type().IsRegular() {
				return ErrScopeViolation
			}
			relative, _ := filepath.Rel(root, path)
			if denied(relative) {
				return ErrScopeViolation
			}
			paths[relative] = true
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	names := make([]string, 0, len(paths))
	for path := range paths {
		names = append(names, path)
	}
	sort.Strings(names)
	result := make([]fileDiff, 0)
	for _, name := range names {
		before, _ := os.ReadFile(filepath.Join(baseline, name))
		after, _ := os.ReadFile(filepath.Join(working, name))
		if isBinary(after) || len(after) > maxFileBytes {
			return nil, ErrScopeViolation
		}
		if string(before) != string(after) {
			result = append(result, fileDiff{Path: filepath.ToSlash(name), Before: string(before), After: string(after)})
		}
	}
	return result, nil
}

func providerPath(provider string) (string, error) {
	switch strings.ToLower(provider) {
	case "codex":
		path, err := exec.LookPath("codex")
		if err != nil {
			return "", ErrProviderUnavailable
		}
		return path, nil
	case "gigacode":
		path, err := exec.LookPath("gigacode")
		if err != nil {
			return "", ErrProviderUnavailable
		}
		return path, nil
	default:
		return "", ErrProviderUnsupported
	}
}

func providerArguments(provider, model, working, reasoningEffort string, inline bool) ([]string, error) {
	provider = strings.ToLower(provider)
	var args []string
	switch provider {
	case "codex":
		sandbox := "workspace-write"
		if inline {
			sandbox = "read-only"
		}
		args = []string{"exec", "--json", "--ephemeral", "--sandbox", sandbox, "--skip-git-repo-check", "--cd", working}
		if inline {
			args = append(args, "--ignore-rules")
		}
		if reasoningEffort == "low" {
			args = append(args, "--config", `model_reasoning_effort="low"`)
		}
	case "gigacode":
		capability := ProbeProvider(context.Background(), "gigacode")
		if !capability.Available {
			return nil, ErrProviderUnavailable
		}
		if !capability.Supported {
			return nil, ErrProviderUnsupported
		}
		args = []string{"--non-interactive", "--json", "--cwd", working}
	default:
		return nil, ErrProviderUnsupported
	}
	if model != "" {
		if strings.HasPrefix(model, "-") || !regexp.MustCompile(`^[A-Za-z0-9._:/-]{1,100}$`).MatchString(model) {
			return nil, ErrProviderUnsupported
		}
		args = append(args, "--model", model)
	}
	return append(args, "-"), nil
}

func promptEnvelope(prompt string, entries []resolvedEntry) string {
	var builder strings.Builder
	builder.WriteString("Работай только с файлами из текущего изолированного OpenSpec workspace. Не изменяй context-файлы.\n\n")
	builder.WriteString("ЗАДАЧА:\n" + prompt + "\n\nКОНТЕКСТ:\n")
	for _, entry := range entries {
		if !entry.Included || entry.Source == "store" {
			continue
		}
		fmt.Fprintf(&builder, "\n--- source=%s path=%s sha256=%s ---\n%s\n", entry.Source, entry.Path, entry.Checksum, entry.content)
	}
	return builder.String()
}

func finalResponse(output string) string {
	var last string
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		var event map[string]any
		if json.Unmarshal([]byte(line), &event) == nil {
			if message, ok := event["message"].(string); ok {
				last = message
			}
			if item, ok := event["item"].(map[string]any); ok {
				if text, ok := item["text"].(string); ok {
					last = text
				}
			}
		}
	}
	if last == "" {
		last = "Agent CLI завершил операцию."
	}
	return last
}

func normalizeProviderEvents(output string) []operation.Event {
	events := make([]operation.Event, 0)
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		var raw map[string]any
		if json.Unmarshal([]byte(line), &raw) != nil {
			events = append(events, operation.Event{Type: "provider_diagnostic", Payload: `{"message":"unparsed provider output"}`})
			continue
		}
		eventType, _ := raw["type"].(string)
		if eventType == "" {
			eventType = "provider_event"
		}
		payload, _ := json.Marshal(map[string]any{"providerType": eventType})
		events = append(events, operation.Event{Type: "provider_event", Payload: string(payload)})
	}
	return events
}

func verifySources(entries []resolvedEntry) error {
	for _, entry := range entries {
		if !entry.Included {
			continue
		}
		content, err := os.ReadFile(entry.absolute)
		if err != nil || checksum(content) != entry.Checksum {
			return fmt.Errorf("%w: %s:%s", ErrScopeViolation, entry.Source, entry.Path)
		}
	}
	return nil
}

func denied(path string) bool {
	lower := strings.ToLower(filepath.ToSlash(path))
	base := strings.ToLower(filepath.Base(lower))
	return strings.Contains(lower, "/.git/") || strings.HasPrefix(lower, ".git/") ||
		base == ".env" || strings.HasPrefix(base, ".env.") ||
		strings.HasSuffix(base, ".pem") || strings.HasSuffix(base, ".key") ||
		strings.Contains(base, "secret") || strings.Contains(base, "credential")
}

func hasTraversal(path string) bool {
	for _, part := range strings.Split(filepath.ToSlash(path), "/") {
		if part == ".." {
			return true
		}
	}
	return false
}

func isBinary(content []byte) bool {
	limit := len(content)
	if limit > 8000 {
		limit = 8000
	}
	for _, value := range content[:limit] {
		if value == 0 {
			return true
		}
	}
	return false
}

func checksum(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

func randomToken() string {
	value := make([]byte, 24)
	_, _ = rand.Read(value)
	return hex.EncodeToString(value)
}

func safeDiagnostic(value string) string {
	if strings.TrimSpace(value) == "" {
		return "Agent CLI завершился с ошибкой без диагностического вывода"
	}
	return "Agent CLI завершился с ошибкой"
}
