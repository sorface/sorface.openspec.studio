package taskcontext

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
	ErrPublicationEmpty  = errors.New("task publication is empty")
	ErrPublicationStale  = errors.New("task publication is stale")
	ErrPublicationScope  = errors.New("task publication scope is invalid")
	ErrPublicationRemote = errors.New("task publication remote is unavailable")
	ErrPublicationFailed = errors.New("task publication failed")
)

const (
	publicationTTL     = 10 * time.Minute
	maxPublicationDiff = 2 << 20
	maxAgentDiff       = 192 << 10
)

var publicationSubject = regexp.MustCompile(`^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: .{1,200}$`)

type MessageRequest struct {
	Task     string
	Paths    []string
	Diff     string
	Provider string
	Model    string
}

type CommitMessage struct {
	Subject string `json:"subject"`
	Body    string `json:"body,omitempty"`
}

type MessageGenerator interface {
	Generate(context.Context, MessageRequest) (CommitMessage, error)
}

type PublicationStore interface {
	Get(context.Context, string) (project.Project, error)
}

type TaskPusher interface {
	StartTaskPush(context.Context, string, string, string, string) (operation.Operation, error)
}

type PublicationPreview struct {
	Token         string    `json:"token"`
	Task          string    `json:"task"`
	Paths         []string  `json:"paths"`
	ExcludedCount int       `json:"excludedCount"`
	Message       string    `json:"message"`
	Body          string    `json:"body,omitempty"`
	GeneratedBy   string    `json:"generatedBy"`
	DiffTruncated bool      `json:"diffTruncated"`
	ExpiresAt     time.Time `json:"expiresAt"`
	Fingerprint   string    `json:"-"`
	Head          string    `json:"-"`
	WorkspaceID   string    `json:"-"`
	StorePath     string    `json:"-"`
}

type ConfirmPublicationInput struct {
	Token         string `json:"token"`
	Message       string `json:"message,omitempty"`
	Body          string `json:"body,omitempty"`
	CorrelationID string `json:"-"`
}

type PublicationResult struct {
	Task      string              `json:"task"`
	CommitSHA string              `json:"commitSha"`
	Operation operation.Operation `json:"operation"`
}

type publicationCandidate struct {
	Task          string
	Head          string
	StorePath     string
	WorkspaceID   string
	Paths         []string
	Diff          string
	Fingerprint   string
	ExcludedCount int
}

type PublicationService struct {
	store     PublicationStore
	pusher    TaskPusher
	generator MessageGenerator
	runner    processrunner.Runner
	gitPath   string
	dataDir   string
	mu        sync.Mutex
	previews  map[string]PublicationPreview
}

func NewPublicationService(store PublicationStore, pusher TaskPusher, generator MessageGenerator, dataDir string) *PublicationService {
	gitPath, _ := exec.LookPath("git")
	return &PublicationService{
		store: store, pusher: pusher, generator: generator, gitPath: gitPath,
		dataDir: dataDir, previews: make(map[string]PublicationPreview),
	}
}

func (service *PublicationService) Preview(ctx context.Context, projectID string) (PublicationPreview, error) {
	projectItem, err := service.store.Get(ctx, projectID)
	if err != nil {
		return PublicationPreview{}, err
	}
	candidate, err := service.candidate(ctx, projectItem)
	if err != nil {
		return PublicationPreview{}, err
	}
	message := fallbackMessage(candidate.Task)
	generatedBy := "fallback"
	body := ""
	diffForAgent := candidate.Diff
	truncated := false
	if len(diffForAgent) > maxAgentDiff {
		diffForAgent = diffForAgent[:maxAgentDiff]
		truncated = true
	}
	if service.generator != nil && projectItem.DefaultProvider != nil && strings.TrimSpace(*projectItem.DefaultProvider) != "" {
		model := ""
		if projectItem.DefaultModel != nil {
			model = strings.TrimSpace(*projectItem.DefaultModel)
		}
		generated, generateErr := service.generator.Generate(ctx, MessageRequest{
			Task: candidate.Task, Paths: candidate.Paths, Diff: diffForAgent,
			Provider: strings.TrimSpace(*projectItem.DefaultProvider), Model: model,
		})
		if generateErr == nil && validCommitMessage(generated.Subject, generated.Body, candidate.Task) {
			message, body, generatedBy = strings.TrimSpace(generated.Subject), strings.TrimSpace(generated.Body), "agent"
		}
	}
	preview := PublicationPreview{
		Token: randomToken(), Task: candidate.Task, Paths: candidate.Paths,
		ExcludedCount: candidate.ExcludedCount, Message: message, Body: body,
		GeneratedBy: generatedBy, DiffTruncated: truncated,
		ExpiresAt: time.Now().UTC().Add(publicationTTL), Fingerprint: candidate.Fingerprint,
		Head: candidate.Head, WorkspaceID: candidate.WorkspaceID, StorePath: candidate.StorePath,
	}
	service.mu.Lock()
	service.cleanupExpiredLocked(time.Now().UTC())
	service.previews[preview.Token] = preview
	service.mu.Unlock()
	return preview, nil
}

func (service *PublicationService) Confirm(ctx context.Context, projectID string, input ConfirmPublicationInput) (PublicationResult, error) {
	service.mu.Lock()
	preview, ok := service.previews[strings.TrimSpace(input.Token)]
	if ok && time.Now().UTC().After(preview.ExpiresAt) {
		delete(service.previews, preview.Token)
		ok = false
	}
	service.mu.Unlock()
	if !ok {
		return PublicationResult{}, ErrPublicationStale
	}
	projectItem, err := service.store.Get(ctx, projectID)
	if err != nil {
		return PublicationResult{}, err
	}
	activePath, pathErr := filepath.EvalSymlinks(projectItem.StorePath)
	if projectItem.ActiveWorktreeID == nil || *projectItem.ActiveWorktreeID != preview.WorkspaceID ||
		pathErr != nil || activePath != preview.StorePath || projectItem.ActiveTask != preview.Task {
		return PublicationResult{}, ErrPublicationStale
	}
	candidate, err := service.candidate(ctx, projectItem)
	if err != nil {
		return PublicationResult{}, err
	}
	if candidate.Head != preview.Head || candidate.Fingerprint != preview.Fingerprint || !equalPaths(candidate.Paths, preview.Paths) {
		return PublicationResult{}, ErrPublicationStale
	}
	message := strings.TrimSpace(input.Message)
	body := strings.TrimSpace(input.Body)
	if message == "" {
		message, body = preview.Message, preview.Body
	}
	if !validCommitMessage(message, body, preview.Task) {
		return PublicationResult{}, ErrPublicationFailed
	}
	remotes, err := service.output(ctx, preview.StorePath, 15*time.Second, nil, "remote")
	if err != nil || strings.TrimSpace(remotes) == "" {
		return PublicationResult{}, ErrPublicationRemote
	}
	if _, err := service.run(ctx, preview.StorePath, 30*time.Second, nil,
		append([]string{"add", "-A", "--"}, preview.Paths...)...,
	); err != nil {
		return PublicationResult{}, ErrPublicationFailed
	}
	arguments := []string{"commit", "-m", message}
	if body != "" {
		arguments = append(arguments, "-m", body)
	}
	arguments = append(arguments, "--")
	arguments = append(arguments, preview.Paths...)
	if _, err := service.run(ctx, preview.StorePath, 2*time.Minute, nil, arguments...); err != nil {
		return PublicationResult{}, ErrPublicationFailed
	}
	commitSHA, err := service.output(ctx, preview.StorePath, 15*time.Second, nil, "rev-parse", "HEAD")
	if err != nil || commitSHA == preview.Head {
		return PublicationResult{}, ErrPublicationFailed
	}
	operationItem, err := service.pusher.StartTaskPush(
		ctx, projectID, preview.StorePath, preview.Task, input.CorrelationID,
	)
	if err != nil {
		return PublicationResult{}, err
	}
	service.mu.Lock()
	delete(service.previews, preview.Token)
	service.mu.Unlock()
	return PublicationResult{Task: preview.Task, CommitSHA: commitSHA, Operation: operationItem}, nil
}

func (service *PublicationService) candidate(ctx context.Context, item project.Project) (publicationCandidate, error) {
	if service.gitPath == "" {
		return publicationCandidate{}, project.ErrGitUnavailable
	}
	if item.ActiveWorktreeID == nil || strings.TrimSpace(item.ActiveTask) == "" {
		return publicationCandidate{}, ErrWorkspaceUnavailable
	}
	storePath, err := filepath.EvalSymlinks(item.StorePath)
	if err != nil || !filepath.IsAbs(storePath) {
		return publicationCandidate{}, ErrWorkspaceUnavailable
	}
	task, err := service.output(ctx, storePath, 15*time.Second, nil, "branch", "--show-current")
	if err != nil || task != item.ActiveTask {
		return publicationCandidate{}, ErrWorkspaceConflict
	}
	head, err := service.output(ctx, storePath, 15*time.Second, nil, "rev-parse", "HEAD")
	if err != nil {
		return publicationCandidate{}, ErrWorkspaceUnavailable
	}
	tempRoot, err := os.MkdirTemp(service.dataDir, "publication-*")
	if err != nil {
		return publicationCandidate{}, ErrPublicationFailed
	}
	defer os.RemoveAll(tempRoot)
	indexPath := filepath.Join(tempRoot, "index")
	environment := map[string]string{"GIT_INDEX_FILE": indexPath, "GIT_TERMINAL_PROMPT": "0"}
	if _, err := service.run(ctx, storePath, 30*time.Second, environment, "read-tree", "HEAD"); err != nil {
		return publicationCandidate{}, ErrPublicationFailed
	}
	if _, err := service.run(ctx, storePath, 30*time.Second, environment, "add", "-A", "--", "openspec"); err != nil {
		return publicationCandidate{}, ErrPublicationFailed
	}
	rawPaths, err := service.output(ctx, storePath, 30*time.Second, environment,
		"diff", "--cached", "--no-renames", "--name-only", "-z", "--", "openspec")
	if err != nil {
		return publicationCandidate{}, ErrPublicationFailed
	}
	paths := splitNUL(rawPaths)
	sort.Strings(paths)
	if len(paths) == 0 {
		return publicationCandidate{}, ErrPublicationEmpty
	}
	for _, path := range paths {
		if !validPublicationPath(storePath, path) {
			return publicationCandidate{}, ErrPublicationScope
		}
	}
	diff, err := service.outputLimit(ctx, storePath, 45*time.Second, environment, maxPublicationDiff,
		"diff", "--cached", "--no-renames", "--no-ext-diff", "--unified=3", "--", "openspec")
	if err != nil {
		return publicationCandidate{}, ErrPublicationFailed
	}
	fullStatus, _ := service.outputLimit(ctx, storePath, 15*time.Second, nil, 256<<10,
		"status", "--porcelain=v1", "--untracked-files=all")
	excluded := countExcludedStatus(fullStatus)
	fingerprint := publicationFingerprint(task, head, paths, diff)
	return publicationCandidate{
		Task: task, Head: head, StorePath: storePath, WorkspaceID: *item.ActiveWorktreeID,
		Paths: paths, Diff: diff, Fingerprint: fingerprint, ExcludedCount: excluded,
	}, nil
}

func (service *PublicationService) output(ctx context.Context, path string, timeout time.Duration, environment map[string]string, arguments ...string) (string, error) {
	return service.outputLimit(ctx, path, timeout, environment, 256<<10, arguments...)
}

func (service *PublicationService) outputLimit(ctx context.Context, path string, timeout time.Duration, environment map[string]string, limit int64, arguments ...string) (string, error) {
	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable: service.gitPath, Arguments: arguments, Directory: path,
		Environment: environment, Timeout: timeout, MaxOutputBytes: limit,
	})
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(result.Stdout), nil
}

func (service *PublicationService) run(ctx context.Context, path string, timeout time.Duration, environment map[string]string, arguments ...string) (processrunner.Result, error) {
	return service.runner.Run(ctx, processrunner.Command{
		Executable: service.gitPath, Arguments: arguments, Directory: path,
		Environment: environment, Timeout: timeout, MaxOutputBytes: maxPublicationDiff,
	})
}

func (service *PublicationService) cleanupExpiredLocked(now time.Time) {
	for token, preview := range service.previews {
		if now.After(preview.ExpiresAt) {
			delete(service.previews, token)
		}
	}
}

func validPublicationPath(root, value string) bool {
	value = filepath.ToSlash(filepath.Clean(value))
	if value == "openspec" || !strings.HasPrefix(value, "openspec/") || filepath.IsAbs(value) || strings.Contains(value, "../") {
		return false
	}
	lower := strings.ToLower(value)
	if strings.HasSuffix(lower, ".pem") || strings.HasSuffix(lower, ".key") || strings.Contains(lower, "/.env") {
		return false
	}
	target := filepath.Join(root, filepath.FromSlash(value))
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return true
	}
	return err == nil && info.Mode().IsRegular()
}

func validCommitMessage(subject, body, task string) bool {
	subject, body = strings.TrimSpace(subject), strings.TrimSpace(body)
	return publicationSubject.MatchString(subject) && strings.Contains(subject, task) && len(subject) <= 240 && len(body) <= 16<<10
}

func fallbackMessage(task string) string {
	return "docs(openspec): publish " + task
}

func publicationFingerprint(task, head string, paths []string, diff string) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte(task + "\x00" + head + "\x00"))
	for _, path := range paths {
		_, _ = hash.Write([]byte(path + "\x00"))
	}
	_, _ = hash.Write([]byte(diff))
	return hex.EncodeToString(hash.Sum(nil))
}

func splitNUL(value string) []string {
	result := make([]string, 0)
	for _, part := range strings.Split(value, "\x00") {
		if part = strings.TrimSpace(part); part != "" {
			result = append(result, filepath.ToSlash(part))
		}
	}
	return result
}

func countExcludedStatus(value string) int {
	count := 0
	for _, line := range strings.Split(value, "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 4 {
			continue
		}
		path := strings.TrimSpace(line[2:])
		if !strings.HasPrefix(filepath.ToSlash(path), "openspec/") {
			count++
		}
	}
	return count
}

func equalPaths(left, right []string) bool {
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

func randomToken() string {
	value := make([]byte, 24)
	if _, err := rand.Read(value); err != nil {
		panic("crypto/rand unavailable")
	}
	return hex.EncodeToString(value)
}
