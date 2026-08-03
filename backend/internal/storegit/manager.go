package storegit

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/gitstatus"
	"github.com/sorface/openspec-studio/backend/internal/operation"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

var (
	ErrInvalidPath       = errors.New("invalid store path")
	ErrInvalidSelection  = errors.New("invalid git selection")
	ErrInvalidMessage    = errors.New("invalid conventional commit message")
	ErrIndexChanged      = errors.New("git index changed")
	ErrHeadChanged       = errors.New("git head changed")
	ErrWorktreeDirty     = errors.New("git worktree is dirty")
	ErrInvalidBranch     = errors.New("invalid git branch")
	ErrBranchExists      = errors.New("git branch exists")
	ErrBranchNotFound    = errors.New("git branch not found")
	ErrRemoteNotFound    = errors.New("git remote not found")
	ErrDetachedHead      = errors.New("git detached head")
	ErrOperationConflict = errors.New("store git operation conflict")
	ErrGitAuthFailed     = errors.New("git authentication failed")
	ErrNonFastForward    = errors.New("git non-fast-forward")
	ErrGitTimeout        = errors.New("git operation timeout")
	ErrGitOperation      = errors.New("git operation failed")
)

var conventionalSubject = regexp.MustCompile(`^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: .{1,200}$`)

type ManagerStore interface {
	Get(context.Context, string) (project.Project, error)
	CreateOperation(context.Context, operation.Operation) (operation.Operation, error)
	GetOperation(context.Context, string) (operation.Operation, error)
	UpdateOperation(context.Context, operation.Operation) (operation.Operation, error)
	HasActiveOperation(context.Context, string, operation.Kind) (bool, error)
	AddEvent(context.Context, operation.Event) (operation.Event, error)
	ListEvents(context.Context, string, int64) ([]operation.Event, error)
}

type StoreValidator interface {
	Validate(context.Context, string) (string, error)
}

type StatusReader interface {
	Get(context.Context, string) (gitstatus.Status, error)
}

type Manager struct {
	store      ManagerStore
	validator  StoreValidator
	status     StatusReader
	supervisor *processrunner.Supervisor
	runner     processrunner.Runner
	gitPath    string
}

type PathsInput struct {
	Paths []string `json:"paths"`
}

type CommitInput struct {
	Paths        []string `json:"paths"`
	Message      string   `json:"message"`
	ExpectedHead string   `json:"expectedHead"`
}

type CreateBranchInput struct {
	Name string `json:"name"`
}

type SwitchBranchInput struct {
	Branch       string `json:"branch,omitempty"`
	RemoteBranch string `json:"remoteBranch,omitempty"`
	LocalBranch  string `json:"localBranch,omitempty"`
}

type FetchInput struct {
	Remote        string `json:"remote"`
	CorrelationID string `json:"-"`
}

type PushInput struct {
	Remote        string `json:"remote,omitempty"`
	TargetBranch  string `json:"targetBranch,omitempty"`
	CorrelationID string `json:"-"`
}

type gitOperationMetadata struct {
	Action       string `json:"action"`
	Remote       string `json:"remote,omitempty"`
	Branch       string `json:"branch,omitempty"`
	TargetBranch string `json:"targetBranch,omitempty"`
}

func NewManager(store ManagerStore, supervisor *processrunner.Supervisor, validator StoreValidator, status StatusReader) *Manager {
	gitPath, _ := exec.LookPath("git")
	return &Manager{store: store, supervisor: supervisor, validator: validator, status: status, gitPath: gitPath}
}

func (manager *Manager) Status(ctx context.Context, projectID string) (gitstatus.Status, error) {
	return manager.status.Get(ctx, projectID)
}

func (manager *Manager) Stage(ctx context.Context, projectID string, input PathsInput) (gitstatus.Status, error) {
	path, err := manager.storePath(ctx, projectID)
	if err != nil {
		return gitstatus.Status{}, err
	}
	paths, err := validateRelativePaths(path, input.Paths)
	if err != nil {
		return gitstatus.Status{}, err
	}
	arguments := append([]string{"add", "-A", "--"}, paths...)
	if _, err := manager.run(ctx, path, 30*time.Second, arguments...); err != nil {
		return gitstatus.Status{}, ErrGitOperation
	}
	return manager.status.Get(ctx, projectID)
}

func (manager *Manager) Unstage(ctx context.Context, projectID string, input PathsInput) (gitstatus.Status, error) {
	path, err := manager.storePath(ctx, projectID)
	if err != nil {
		return gitstatus.Status{}, err
	}
	paths, err := validateRelativePaths(path, input.Paths)
	if err != nil {
		return gitstatus.Status{}, err
	}
	arguments := append([]string{"reset", "-q", "HEAD", "--"}, paths...)
	if _, err := manager.run(ctx, path, 30*time.Second, arguments...); err != nil {
		return gitstatus.Status{}, ErrGitOperation
	}
	return manager.status.Get(ctx, projectID)
}

func (manager *Manager) Commit(ctx context.Context, projectID string, input CommitInput) (gitstatus.Status, error) {
	path, err := manager.storePath(ctx, projectID)
	if err != nil {
		return gitstatus.Status{}, err
	}
	paths, err := validateRelativePaths(path, input.Paths)
	if err != nil {
		return gitstatus.Status{}, err
	}
	message := strings.TrimSpace(input.Message)
	subject := strings.SplitN(message, "\n", 2)[0]
	if len(message) > 16<<10 || !conventionalSubject.MatchString(subject) {
		return gitstatus.Status{}, ErrInvalidMessage
	}
	currentHead, runErr := manager.output(ctx, path, 10*time.Second, "rev-parse", "HEAD")
	if runErr != nil || strings.TrimSpace(input.ExpectedHead) == "" || strings.TrimSpace(currentHead) != strings.TrimSpace(input.ExpectedHead) {
		return gitstatus.Status{}, ErrHeadChanged
	}
	staged, runErr := manager.output(ctx, path, 10*time.Second, "diff", "--cached", "--name-only", "-z", "--")
	if runErr != nil {
		return gitstatus.Status{}, ErrGitOperation
	}
	actual := splitNUL(staged)
	sort.Strings(actual)
	sort.Strings(paths)
	if len(actual) == 0 || !equalStrings(actual, paths) {
		return gitstatus.Status{}, ErrIndexChanged
	}
	result, runErr := manager.run(ctx, path, 2*time.Minute, "commit", "-m", message)
	if runErr != nil {
		_ = result
		return gitstatus.Status{}, ErrGitOperation
	}
	return manager.status.Get(ctx, projectID)
}

func (manager *Manager) CreateBranch(ctx context.Context, projectID string, input CreateBranchInput) (gitstatus.Status, error) {
	path, err := manager.storePath(ctx, projectID)
	if err != nil {
		return gitstatus.Status{}, err
	}
	if err := manager.requireClean(ctx, projectID); err != nil {
		return gitstatus.Status{}, err
	}
	name, err := manager.validateBranch(ctx, path, input.Name)
	if err != nil {
		return gitstatus.Status{}, err
	}
	if _, verifyErr := manager.run(ctx, path, 10*time.Second, "show-ref", "--verify", "--quiet", "refs/heads/"+name); verifyErr == nil {
		return gitstatus.Status{}, ErrBranchExists
	}
	if _, err := manager.run(ctx, path, 30*time.Second, "switch", "-c", name); err != nil {
		return gitstatus.Status{}, ErrGitOperation
	}
	return manager.status.Get(ctx, projectID)
}

func (manager *Manager) SwitchBranch(ctx context.Context, projectID string, input SwitchBranchInput) (gitstatus.Status, error) {
	path, err := manager.storePath(ctx, projectID)
	if err != nil {
		return gitstatus.Status{}, err
	}
	if err := manager.requireClean(ctx, projectID); err != nil {
		return gitstatus.Status{}, err
	}
	if strings.TrimSpace(input.RemoteBranch) == "" {
		branch, err := manager.validateBranch(ctx, path, input.Branch)
		if err != nil {
			return gitstatus.Status{}, err
		}
		if _, err := manager.run(ctx, path, 10*time.Second, "show-ref", "--verify", "--quiet", "refs/heads/"+branch); err != nil {
			return gitstatus.Status{}, ErrBranchNotFound
		}
		if _, err := manager.run(ctx, path, 30*time.Second, "switch", branch); err != nil {
			return gitstatus.Status{}, ErrGitOperation
		}
		return manager.status.Get(ctx, projectID)
	}
	remote := strings.TrimSpace(input.RemoteBranch)
	if strings.HasPrefix(remote, "-") || strings.ContainsAny(remote, "\x00\r\n") || !strings.Contains(remote, "/") {
		return gitstatus.Status{}, ErrBranchNotFound
	}
	local, err := manager.validateBranch(ctx, path, input.LocalBranch)
	if err != nil {
		return gitstatus.Status{}, err
	}
	if _, err := manager.run(ctx, path, 10*time.Second, "show-ref", "--verify", "--quiet", "refs/remotes/"+remote); err != nil {
		return gitstatus.Status{}, ErrBranchNotFound
	}
	if _, err := manager.run(ctx, path, 10*time.Second, "show-ref", "--verify", "--quiet", "refs/heads/"+local); err == nil {
		return gitstatus.Status{}, ErrBranchExists
	}
	if _, err := manager.run(ctx, path, 30*time.Second, "switch", "-c", local, "--track", remote); err != nil {
		return gitstatus.Status{}, ErrGitOperation
	}
	return manager.status.Get(ctx, projectID)
}

func (manager *Manager) StartFetch(ctx context.Context, projectID string, input FetchInput) (operation.Operation, error) {
	status, err := manager.status.Get(ctx, projectID)
	if err != nil {
		return operation.Operation{}, err
	}
	remote := strings.TrimSpace(input.Remote)
	if !contains(status.Remotes, remote) {
		return operation.Operation{}, ErrRemoteNotFound
	}
	return manager.startOperation(ctx, projectID, input.CorrelationID, gitOperationMetadata{Action: "fetch", Remote: remote})
}

func (manager *Manager) StartPush(ctx context.Context, projectID string, input PushInput) (operation.Operation, error) {
	status, err := manager.status.Get(ctx, projectID)
	if err != nil {
		return operation.Operation{}, err
	}
	if status.Detached || status.Branch == "" {
		return operation.Operation{}, ErrDetachedHead
	}
	meta := gitOperationMetadata{Action: "push", Branch: status.Branch}
	if status.Upstream == "" {
		remote := strings.TrimSpace(input.Remote)
		if !contains(status.Remotes, remote) {
			return operation.Operation{}, ErrRemoteNotFound
		}
		path, pathErr := manager.storePath(ctx, projectID)
		if pathErr != nil {
			return operation.Operation{}, pathErr
		}
		target, branchErr := manager.validateBranch(ctx, path, input.TargetBranch)
		if branchErr != nil {
			return operation.Operation{}, branchErr
		}
		meta.Remote, meta.TargetBranch = remote, target
	}
	return manager.startOperation(ctx, projectID, input.CorrelationID, meta)
}

func (manager *Manager) Get(ctx context.Context, projectID, id string) (operation.Operation, error) {
	item, err := manager.store.GetOperation(ctx, id)
	if err != nil {
		return item, err
	}
	if item.ProjectID != projectID || item.Kind != operation.KindStoreGit {
		return operation.Operation{}, project.ErrNotFound
	}
	return hydrateGitOperation(item), nil
}

func (manager *Manager) Cancel(ctx context.Context, projectID, id string) (operation.Operation, error) {
	item, err := manager.Get(ctx, projectID, id)
	if err != nil || item.Status.Terminal() {
		return item, err
	}
	manager.supervisor.Cancel(id)
	item.Status, item.ErrorCode, item.ErrorMessage = operation.StatusCancelled, "", ""
	updated, err := manager.store.UpdateOperation(ctx, item)
	if err == nil {
		_, _ = manager.store.AddEvent(ctx, operation.Event{OperationID: id, Type: "cancelled", Payload: `{}`})
	}
	return hydrateGitOperation(updated), err
}

func (manager *Manager) Events(ctx context.Context, projectID, id string, after int64) ([]operation.Event, error) {
	if _, err := manager.Get(ctx, projectID, id); err != nil {
		return nil, err
	}
	return manager.store.ListEvents(ctx, id, after)
}

func (manager *Manager) startOperation(ctx context.Context, projectID, correlationID string, meta gitOperationMetadata) (operation.Operation, error) {
	if manager.gitPath == "" {
		return operation.Operation{}, project.ErrGitUnavailable
	}
	active, err := manager.store.HasActiveOperation(ctx, projectID, operation.KindStoreGit)
	if err != nil {
		return operation.Operation{}, err
	}
	if active {
		return operation.Operation{}, ErrOperationConflict
	}
	inputJSON, _ := json.Marshal(meta)
	item, err := manager.store.CreateOperation(ctx, operation.Operation{
		ProjectID: projectID, Kind: operation.KindStoreGit, Status: operation.StatusQueued,
		InputJSON: string(inputJSON), CorrelationID: correlationID,
	})
	if err != nil {
		return operation.Operation{}, err
	}
	_, _ = manager.store.AddEvent(ctx, operation.Event{OperationID: item.ID, Type: "queued", Payload: `{}`})
	go manager.runOperation(item, meta)
	return hydrateGitOperation(item), nil
}

func (manager *Manager) runOperation(item operation.Operation, meta gitOperationMetadata) {
	ctx, done := manager.supervisor.Context(context.Background(), item.ID)
	defer done()
	item.Status = operation.StatusRunning
	item, _ = manager.store.UpdateOperation(ctx, item)
	_, _ = manager.store.AddEvent(ctx, operation.Event{OperationID: item.ID, Type: "running", Payload: `{}`})
	path, err := manager.storePath(ctx, item.ProjectID)
	if err != nil {
		manager.finish(item, operation.StatusFailed, "INVALID_STORE", "Исправьте локальный Store проекта")
		return
	}
	arguments := []string{"fetch", "--", meta.Remote}
	if meta.Action == "push" {
		if meta.Remote == "" {
			arguments = []string{"push"}
		} else {
			arguments = []string{"push", "--set-upstream", meta.Remote, "HEAD:refs/heads/" + meta.TargetBranch}
		}
	}
	result, runErr := manager.runWithEnvironment(ctx, path, 10*time.Minute, arguments...)
	if runErr != nil {
		if ctx.Err() != nil {
			manager.finish(item, operation.StatusCancelled, "", "")
			return
		}
		mapped := classifyOperationError(result.Stderr, result.StopReason)
		manager.finish(item, operation.StatusFailed, errorCode(mapped), safeErrorMessage(mapped))
		return
	}
	item.Status = operation.StatusValidating
	item, _ = manager.store.UpdateOperation(context.Background(), item)
	_, _ = manager.store.AddEvent(context.Background(), operation.Event{OperationID: item.ID, Type: "validating", Payload: `{}`})
	if _, err := manager.status.Get(context.Background(), item.ProjectID); err != nil {
		manager.finish(item, operation.StatusFailed, "GIT_OPERATION_FAILED", "Не удалось обновить Git status")
		return
	}
	manager.finish(item, operation.StatusCompleted, "", "")
}

func (manager *Manager) finish(item operation.Operation, status operation.Status, code, message string) {
	current, err := manager.store.GetOperation(context.Background(), item.ID)
	if err != nil || current.Status.Terminal() {
		return
	}
	current.Status, current.ErrorCode, current.ErrorMessage = status, code, message
	if _, err := manager.store.UpdateOperation(context.Background(), current); err == nil {
		payload, _ := json.Marshal(map[string]string{"code": code, "message": message})
		_, _ = manager.store.AddEvent(context.Background(), operation.Event{OperationID: item.ID, Type: string(status), Payload: string(payload)})
	}
}

func (manager *Manager) storePath(ctx context.Context, projectID string) (string, error) {
	item, err := manager.store.Get(ctx, projectID)
	if err != nil {
		return "", err
	}
	if manager.gitPath == "" {
		return "", project.ErrGitUnavailable
	}
	return manager.validator.Validate(ctx, item.StorePath)
}

func (manager *Manager) requireClean(ctx context.Context, projectID string) error {
	status, err := manager.status.Get(ctx, projectID)
	if err != nil {
		return err
	}
	if len(status.Changes) != 0 {
		return ErrWorktreeDirty
	}
	return nil
}

func (manager *Manager) validateBranch(ctx context.Context, path, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") || strings.ContainsAny(value, "\x00\r\n") {
		return "", ErrInvalidBranch
	}
	if _, err := manager.run(ctx, path, 10*time.Second, "check-ref-format", "--branch", value); err != nil {
		return "", ErrInvalidBranch
	}
	return value, nil
}

func (manager *Manager) output(ctx context.Context, path string, timeout time.Duration, arguments ...string) (string, error) {
	result, err := manager.run(ctx, path, timeout, arguments...)
	return strings.TrimSpace(result.Stdout), err
}

func (manager *Manager) run(ctx context.Context, path string, timeout time.Duration, arguments ...string) (processrunner.Result, error) {
	return manager.runner.Run(ctx, processrunner.Command{
		Executable: manager.gitPath, Arguments: arguments, Directory: path,
		Timeout: timeout, MaxOutputBytes: 512 << 10,
	})
}

func (manager *Manager) runWithEnvironment(ctx context.Context, path string, timeout time.Duration, arguments ...string) (processrunner.Result, error) {
	environment := map[string]string{"GIT_TERMINAL_PROMPT": "0"}
	if socket := strings.TrimSpace(os.Getenv("SSH_AUTH_SOCK")); socket != "" {
		environment["SSH_AUTH_SOCK"] = socket
	}
	return manager.runner.Run(ctx, processrunner.Command{
		Executable: manager.gitPath, Arguments: arguments, Directory: path, Environment: environment,
		Timeout: timeout, MaxOutputBytes: 1 << 20,
	})
}

func validateRelativePaths(root string, values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, ErrInvalidSelection
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || filepath.IsAbs(value) || strings.ContainsRune(value, '\x00') {
			return nil, ErrInvalidPath
		}
		clean := filepath.Clean(filepath.FromSlash(value))
		if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return nil, ErrInvalidPath
		}
		candidate := filepath.Join(root, clean)
		parent := candidate
		for {
			if _, err := os.Lstat(parent); err == nil {
				break
			}
			next := filepath.Dir(parent)
			if next == parent || !insideRoot(root, next) {
				return nil, ErrInvalidPath
			}
			parent = next
		}
		canonicalParent, err := filepath.EvalSymlinks(parent)
		if err != nil || !insideRoot(root, canonicalParent) {
			return nil, ErrInvalidPath
		}
		normalized := filepath.ToSlash(clean)
		if _, duplicate := seen[normalized]; duplicate {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	sort.Strings(result)
	return result, nil
}

func insideRoot(root, value string) bool {
	return value == root || strings.HasPrefix(value, root+string(filepath.Separator))
}

func splitNUL(value string) []string {
	parts := strings.Split(value, "\x00")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			result = append(result, filepath.ToSlash(part))
		}
	}
	return result
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func hydrateGitOperation(item operation.Operation) operation.Operation {
	var meta gitOperationMetadata
	_ = json.Unmarshal([]byte(item.InputJSON), &meta)
	item.GitAction, item.GitRemote = meta.Action, meta.Remote
	item.GitBranch = meta.Branch
	if item.GitBranch == "" {
		item.GitBranch = meta.TargetBranch
	}
	return item
}

func classifyOperationError(stderr, stopReason string) error {
	if stopReason == "timeout" {
		return ErrGitTimeout
	}
	lower := strings.ToLower(stderr)
	switch {
	case strings.Contains(lower, "authentication failed"), strings.Contains(lower, "permission denied"),
		strings.Contains(lower, "could not read username"), strings.Contains(lower, "publickey"),
		strings.Contains(lower, "could not read from remote repository"):
		return ErrGitAuthFailed
	case strings.Contains(lower, "non-fast-forward"), strings.Contains(lower, "fetch first"), strings.Contains(lower, "rejected"):
		return ErrNonFastForward
	default:
		return ErrGitOperation
	}
}

func errorCode(err error) string {
	switch {
	case errors.Is(err, ErrGitAuthFailed):
		return "GIT_AUTH_FAILED"
	case errors.Is(err, ErrNonFastForward):
		return "GIT_NON_FAST_FORWARD"
	case errors.Is(err, ErrGitTimeout):
		return "GIT_TIMEOUT"
	default:
		return "GIT_OPERATION_FAILED"
	}
}

func safeErrorMessage(err error) string {
	switch {
	case errors.Is(err, ErrGitAuthFailed):
		return "Git-аутентификация завершилась ошибкой. Проверьте системный ssh-agent или credential helper"
	case errors.Is(err, ErrNonFastForward):
		return "Remote содержит новые commits. Разрешите расхождение вне автоматического сценария"
	case errors.Is(err, ErrGitTimeout):
		return "Git-операция превысила допустимое время"
	default:
		return "Git-операция не выполнена"
	}
}
