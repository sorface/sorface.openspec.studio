package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

var (
	ErrInvalidGitURL     = errors.New("invalid git url")
	ErrTargetNotEmpty    = errors.New("clone target is not empty")
	ErrPathOutsideScope  = errors.New("path outside scope")
	ErrOperationConflict = errors.New("operation conflict")
)

type Store interface {
	Get(context.Context, string) (project.Project, error)
	CreateOperation(context.Context, operation.Operation) (operation.Operation, error)
	GetOperation(context.Context, string) (operation.Operation, error)
	UpdateOperation(context.Context, operation.Operation) (operation.Operation, error)
	HasActiveOperation(context.Context, string, operation.Kind) (bool, error)
	AddEvent(context.Context, operation.Event) (operation.Event, error)
	ListEvents(context.Context, string, int64) ([]operation.Event, error)
	CreateRepository(context.Context, operation.RepositoryLink) (operation.RepositoryLink, error)
	ListRepositories(context.Context, string) ([]operation.RepositoryLink, error)
}

type CloneInput struct {
	URL           string `json:"url"`
	CorrelationID string `json:"-"`
}

type cloneMetadata struct {
	URL        string `json:"url"`
	TargetPath string `json:"targetPath"`
	Created    bool   `json:"created"`
}

type Service struct {
	store       Store
	runner      processrunner.Runner
	supervisor  *processrunner.Supervisor
	gitPath     string
	managedRoot string
}

func NewService(store Store, supervisor *processrunner.Supervisor, managedRoots ...string) *Service {
	gitPath, _ := exec.LookPath("git")
	managedRoot := DefaultManagedRoot("projects")
	if len(managedRoots) > 0 {
		managedRoot = managedRoots[0]
	}
	return &Service{store: store, supervisor: supervisor, gitPath: gitPath, managedRoot: managedRoot}
}

func (service *Service) List(ctx context.Context, projectID string) ([]operation.RepositoryLink, error) {
	if _, err := service.store.Get(ctx, projectID); err != nil {
		return nil, err
	}
	items, err := service.store.ListRepositories(ctx, projectID)
	if err != nil {
		return nil, err
	}
	for index := range items {
		info, statErr := os.Stat(items[index].Path)
		items[index].Available = statErr == nil && info.IsDir()
	}
	return items, nil
}

func (service *Service) ValidateContextRepositories(values []string) ([]string, error) {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		remote, err := ValidateGitURL(value)
		if err != nil {
			return nil, project.ErrInvalidContextRepositoryURL
		}
		if _, duplicate := seen[remote]; duplicate {
			continue
		}
		seen[remote] = struct{}{}
		normalized = append(normalized, remote)
	}
	return normalized, nil
}

func (service *Service) ImportContext(
	ctx context.Context,
	projectItem project.Project,
	remotes []string,
) project.ContextImportSummary {
	summary := project.ContextImportSummary{Failures: []project.ContextImportFailure{}}
	for _, remote := range remotes {
		if ctx.Err() != nil {
			summary.Failures = append(summary.Failures, project.ContextImportFailure{
				URL: remote, Code: "CONTEXT_IMPORT_CANCELLED", Message: "Импорт контекста отменён",
			})
			continue
		}
		code, message := service.importContextRepository(ctx, projectItem, remote)
		if code != "" {
			summary.Failures = append(summary.Failures, project.ContextImportFailure{
				URL: remote, Code: code, Message: message,
			})
			continue
		}
		summary.Imported++
	}
	return summary
}

func (service *Service) importContextRepository(
	ctx context.Context,
	projectItem project.Project,
	remote string,
) (string, string) {
	if service.gitPath == "" {
		return "GIT_UNAVAILABLE", "Git недоступен"
	}
	target, err := CreateManagedTarget(service.projectRepositoriesRoot(projectItem), remote)
	if err != nil {
		return "INVALID_CONTEXT_TARGET", "Не удалось подготовить каталог репозитория"
	}
	removeTarget := true
	defer func() {
		if removeTarget {
			_ = os.RemoveAll(target)
		}
	}()

	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable:     service.gitPath,
		Arguments:      []string{"clone", "--progress", "--", remote, target},
		Directory:      filepath.Dir(target),
		Environment:    gitCloneEnvironment(),
		Timeout:        30 * time.Minute,
		MaxOutputBytes: 1 << 20,
	})
	if err != nil {
		if ctx.Err() != nil {
			return "CONTEXT_IMPORT_CANCELLED", "Импорт контекста отменён"
		}
		return safeCloneError(result.Stderr)
	}

	link, err := service.inspect(projectItem, remote, target)
	if err != nil {
		return "INVALID_REPOSITORY", "Клонированный каталог не является отдельным Git worktree"
	}
	link.ProjectID = projectItem.ID
	if _, err := service.store.CreateRepository(ctx, link); err != nil {
		return "PERSISTENCE_ERROR", "Не удалось сохранить репозиторий"
	}
	removeTarget = false
	return "", ""
}

func (service *Service) StartClone(ctx context.Context, projectID string, input CloneInput) (operation.Operation, error) {
	projectItem, err := service.store.Get(ctx, projectID)
	if err != nil {
		return operation.Operation{}, err
	}
	normalizedURL, err := ValidateGitURL(input.URL)
	if err != nil {
		return operation.Operation{}, err
	}
	target, err := CreateManagedTarget(service.projectRepositoriesRoot(projectItem), normalizedURL)
	if err != nil {
		return operation.Operation{}, err
	}
	created := true
	active, err := service.store.HasActiveOperation(ctx, projectID, operation.KindRepositoryClone)
	if err != nil {
		return operation.Operation{}, err
	}
	if active {
		_ = os.RemoveAll(target)
		return operation.Operation{}, ErrOperationConflict
	}
	meta, _ := json.Marshal(cloneMetadata{URL: normalizedURL, TargetPath: target, Created: created})
	item, err := service.store.CreateOperation(ctx, operation.Operation{
		ProjectID: projectID, Kind: operation.KindRepositoryClone, Status: operation.StatusQueued,
		InputJSON: string(meta), CorrelationID: input.CorrelationID,
	})
	if err != nil {
		_ = os.RemoveAll(target)
		return operation.Operation{}, err
	}
	_, _ = service.store.AddEvent(ctx, operation.Event{OperationID: item.ID, Type: "queued", Payload: `{}`})
	go service.runClone(item, projectItem, normalizedURL, target, created)
	return item, nil
}

func (service *Service) projectRepositoriesRoot(item project.Project) string {
	projectsRoot, err := filepath.Abs(filepath.Clean(service.managedRoot))
	if err != nil {
		return ""
	}
	if err := os.MkdirAll(projectsRoot, 0o700); err != nil {
		return ""
	}
	if canonicalRoot, evalErr := filepath.EvalSymlinks(projectsRoot); evalErr == nil {
		projectsRoot = canonicalRoot
	}
	storePath, err := filepath.Abs(filepath.Clean(item.StorePath))
	if err == nil && filepath.Base(storePath) == "store" {
		projectRoot := filepath.Dir(storePath)
		if filepath.Dir(projectRoot) == projectsRoot {
			return filepath.Join(projectRoot, "repositories")
		}
	}
	return filepath.Join(projectsRoot, item.ID, "repositories")
}

func (service *Service) Cancel(ctx context.Context, projectID, operationID string) (operation.Operation, error) {
	item, err := service.Get(ctx, projectID, operationID)
	if err != nil {
		return operation.Operation{}, err
	}
	if item.Status.Terminal() {
		return item, nil
	}
	service.supervisor.Cancel(item.ID)
	item.Status = operation.StatusCancelled
	item.ErrorCode = ""
	item.ErrorMessage = ""
	updated, err := service.store.UpdateOperation(ctx, item)
	if err == nil {
		_, _ = service.store.AddEvent(ctx, operation.Event{OperationID: item.ID, Type: "cancelled", Payload: `{}`})
	}
	return updated, err
}

func (service *Service) Get(ctx context.Context, projectID, id string) (operation.Operation, error) {
	item, err := service.store.GetOperation(ctx, id)
	if err != nil {
		return item, err
	}
	if item.ProjectID != projectID || item.Kind != operation.KindRepositoryClone {
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

func (service *Service) runClone(item operation.Operation, projectItem project.Project, remote, target string, created bool) {
	ctx, done := service.supervisor.Context(context.Background(), item.ID)
	defer done()
	item.Status = operation.StatusRunning
	item, _ = service.store.UpdateOperation(ctx, item)
	_, _ = service.store.AddEvent(ctx, operation.Event{OperationID: item.ID, Type: "running", Payload: `{}`})

	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable: service.gitPath, Arguments: []string{"clone", "--progress", "--", remote, target},
		Directory: filepath.Dir(target), Environment: gitCloneEnvironment(),
		Timeout: 30 * time.Minute, MaxOutputBytes: 1 << 20,
		OnStderr: func(chunk []byte) {
			if progress := sanitizeProgress(string(chunk)); progress != "" {
				payload, _ := json.Marshal(map[string]string{"message": progress})
				_, _ = service.store.AddEvent(context.Background(), operation.Event{
					OperationID: item.ID, Type: "progress", Payload: string(payload),
				})
			}
		},
	})
	if err != nil {
		if ctx.Err() != nil {
			if created {
				_ = os.RemoveAll(target)
			}
			service.finish(item, operation.StatusCancelled, "", "")
			return
		}
		if created {
			_ = os.RemoveAll(target)
		}
		code, message := safeCloneError(result.Stderr)
		service.finish(item, operation.StatusFailed, code, message)
		return
	}
	item.Status = operation.StatusValidating
	item, _ = service.store.UpdateOperation(context.Background(), item)
	_, _ = service.store.AddEvent(context.Background(), operation.Event{OperationID: item.ID, Type: "validating", Payload: `{}`})

	link, err := service.inspect(projectItem, remote, target)
	if err != nil {
		if created {
			_ = os.RemoveAll(target)
		}
		service.finish(item, operation.StatusFailed, "INVALID_REPOSITORY", "Клонированный каталог не является отдельным Git worktree")
		return
	}
	link.ProjectID = projectItem.ID
	if _, err := service.store.CreateRepository(context.Background(), link); err != nil {
		if created {
			_ = os.RemoveAll(target)
		}
		service.finish(item, operation.StatusFailed, "PERSISTENCE_ERROR", "Не удалось сохранить репозиторий")
		return
	}
	service.finish(item, operation.StatusCompleted, "", "")
}

func (service *Service) finish(item operation.Operation, status operation.Status, code, message string) {
	current, err := service.store.GetOperation(context.Background(), item.ID)
	if err != nil || current.Status.Terminal() {
		return
	}
	current.Status, current.ErrorCode, current.ErrorMessage = status, code, message
	if _, err := service.store.UpdateOperation(context.Background(), current); err == nil {
		payload, _ := json.Marshal(map[string]string{"code": code, "message": message})
		_, _ = service.store.AddEvent(context.Background(), operation.Event{
			OperationID: item.ID, Type: string(status), Payload: string(payload),
		})
	}
}

func (service *Service) inspect(_ project.Project, remote, target string) (operation.RepositoryLink, error) {
	canonical, err := filepath.EvalSymlinks(target)
	if err != nil {
		return operation.RepositoryLink{}, err
	}
	root, err := gitOutput(service.gitPath, canonical, "rev-parse", "--show-toplevel")
	if err != nil {
		return operation.RepositoryLink{}, err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil || root != canonical {
		return operation.RepositoryLink{}, ErrPathOutsideScope
	}
	sha, _ := gitOutput(service.gitPath, canonical, "rev-parse", "HEAD")
	branch, _ := gitOutput(service.gitPath, target, "branch", "--show-current")
	status, _ := gitOutput(service.gitPath, target, "status", "--porcelain")
	sum := sha256.Sum256([]byte(canonical + "\x00" + remote + "\x00" + sha))
	return operation.RepositoryLink{
		Name: filepath.Base(strings.TrimSuffix(remote, ".git")), Path: canonical,
		RemoteURL: remote, Fingerprint: hex.EncodeToString(sum[:]), Branch: branch,
		CommitSHA: sha, Dirty: status != "", Available: true, ReadOnlyForAI: true,
	}, nil
}

func ValidateGitURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") || strings.ContainsAny(value, "\x00\r\n") {
		return "", ErrInvalidGitURL
	}
	if regexp.MustCompile(`^[^/@:\s]+@[^/:\s]+:[^:\s].+$`).MatchString(value) {
		return value, nil
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "ssh") || parsed.Host == "" {
		return "", ErrInvalidGitURL
	}
	if parsed.User != nil {
		if _, hasPassword := parsed.User.Password(); hasPassword {
			return "", ErrInvalidGitURL
		}
	}
	return value, nil
}

func DefaultManagedRoot(kind string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".osstudio", kind)
}

func CreateManagedTarget(root, remote string) (string, error) {
	if root == "" || !filepath.IsAbs(root) {
		return "", ErrPathOutsideScope
	}
	root = filepath.Clean(root)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return "", err
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	name := strings.TrimSuffix(strings.TrimRight(remote, "/"), ".git")
	if separator := strings.LastIndexAny(name, "/:"); separator >= 0 {
		name = name[separator+1:]
	}
	name = strings.ToLower(regexp.MustCompile(`[^a-zA-Z0-9._-]+`).ReplaceAllString(name, "-"))
	name = strings.Trim(name, ".-_")
	if name == "" {
		name = "repository"
	}
	target, err := os.MkdirTemp(canonicalRoot, name+"-")
	if err != nil {
		return "", err
	}
	if err := os.Chmod(target, 0o700); err != nil {
		_ = os.RemoveAll(target)
		return "", err
	}
	return target, nil
}

func ValidateTarget(value string, protected []string) (string, bool, error) {
	if value == "" || strings.ContainsRune(value, '\x00') {
		return "", false, ErrPathOutsideScope
	}
	target, err := filepath.Abs(filepath.Clean(value))
	if err != nil {
		return "", false, err
	}
	for _, root := range protected {
		root, _ = filepath.Abs(filepath.Clean(root))
		if target == root || strings.HasPrefix(root, target+string(filepath.Separator)) {
			return "", false, ErrPathOutsideScope
		}
	}
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		parent := filepath.Dir(target)
		if _, err := filepath.EvalSymlinks(parent); err != nil {
			return "", false, ErrPathOutsideScope
		}
		return target, true, nil
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", false, ErrPathOutsideScope
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		return "", false, err
	}
	if len(entries) != 0 {
		return "", false, ErrTargetNotEmpty
	}
	return target, false, nil
}

func gitOutput(executable, directory string, args ...string) (string, error) {
	command := exec.Command(executable, append([]string{"-C", directory}, args...)...)
	output, err := command.Output()
	return strings.TrimSpace(string(output)), err
}

func gitCloneEnvironment() map[string]string {
	environment := map[string]string{"GIT_TERMINAL_PROMPT": "0"}
	if socket := strings.TrimSpace(os.Getenv("SSH_AUTH_SOCK")); socket != "" {
		environment["SSH_AUTH_SOCK"] = socket
	}
	return environment
}

func safeCloneError(value string) (string, string) {
	lower := strings.ToLower(value)
	switch {
	case strings.Contains(lower, "host key verification failed"),
		strings.Contains(lower, "remote host identification has changed"):
		return "SSH_HOST_KEY_FAILED", "Не удалось проверить SSH host key. Проверьте fingerprint и known_hosts"
	case strings.Contains(lower, "authentication failed"),
		strings.Contains(lower, "permission denied"),
		strings.Contains(lower, "could not read username"),
		strings.Contains(lower, "publickey"),
		strings.Contains(lower, "could not read from remote repository"):
		return "GIT_AUTH_FAILED", "Git-аутентификация завершилась ошибкой. Проверьте системный ssh-agent или credential helper"
	case strings.Contains(lower, "repository not found"),
		strings.Contains(lower, "not found"):
		return "GIT_REPOSITORY_NOT_FOUND", "Git-репозиторий не найден"
	default:
		return "GIT_CLONE_FAILED", "Git завершился с ошибкой"
	}
}

var progressPattern = regexp.MustCompile(`(?i)(receiving objects|resolving deltas|counting objects|compressing objects):?\s*(?:\d{1,3}%?)?`)

func sanitizeProgress(value string) string {
	match := progressPattern.FindString(value)
	if match == "" {
		return ""
	}
	match = strings.Join(strings.Fields(match), " ")
	return match
}
