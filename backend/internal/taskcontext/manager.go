package taskcontext

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

var (
	ErrInvalidBranch        = errors.New("invalid task branch")
	ErrWorkspaceNotFound    = errors.New("task workspace not found")
	ErrWorkspaceConflict    = errors.New("task workspace conflict")
	ErrWorkspaceUnavailable = errors.New("task workspace unavailable")
	ErrRemoteBranchNotFound = errors.New("task remote branch not found")
	ErrSyncUpstream         = errors.New("task workspace upstream is unavailable")
	ErrSyncConflict         = errors.New("task workspace remote changes conflict")
	ErrSyncFailed           = errors.New("task workspace sync failed")
)

type Workspace struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"-"`
	Branch    string    `json:"branch"`
	Path      string    `json:"-"`
	Managed   bool      `json:"managed"`
	Active    bool      `json:"active"`
	Dirty     bool      `json:"dirty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Overview struct {
	Items             []Workspace `json:"items"`
	AvailableBranches []string    `json:"availableBranches"`
	RemoteBranches    []string    `json:"remoteBranches"`
	Active            *Workspace  `json:"active,omitempty"`
}

type OpenInput struct {
	Branch       string `json:"branch,omitempty"`
	RemoteBranch string `json:"remoteBranch,omitempty"`
}

type SyncResult struct {
	Task         string `json:"task"`
	Updated      bool   `json:"updated"`
	PreviousHead string `json:"previousHead"`
	Head         string `json:"head"`
}

type Store interface {
	GetBaseProject(context.Context, string) (project.Project, error)
	CreateTaskWorkspace(context.Context, Workspace) (Workspace, error)
	ListTaskWorkspaces(context.Context, string) ([]Workspace, error)
	GetTaskWorkspaceByBranch(context.Context, string, string) (Workspace, error)
	SetActiveTaskWorkspace(context.Context, string, string) error
}

type Manager struct {
	store       Store
	runner      processrunner.Runner
	gitPath     string
	managedRoot string
}

func NewManager(store Store, managedRoot string) *Manager {
	gitPath, _ := exec.LookPath("git")
	return &Manager{store: store, gitPath: gitPath, managedRoot: managedRoot}
}

func (manager *Manager) List(ctx context.Context, projectID string) (Overview, error) {
	base, err := manager.store.GetBaseProject(ctx, projectID)
	if err != nil {
		return Overview{}, err
	}
	if _, err := manager.ensureBaseWorkspace(ctx, base); err != nil {
		return Overview{}, err
	}
	items, err := manager.store.ListTaskWorkspaces(ctx, projectID)
	if err != nil {
		return Overview{}, err
	}
	for index := range items {
		items[index].Dirty = manager.isDirty(ctx, items[index].Path)
	}
	branches, err := manager.localBranches(ctx, base.BaseStorePath)
	if err != nil {
		return Overview{}, err
	}
	remoteBranches, err := manager.remoteBranches(ctx, base.BaseStorePath)
	if err != nil {
		return Overview{}, err
	}
	result := Overview{Items: items, AvailableBranches: branches, RemoteBranches: remoteBranches}
	for index := range result.Items {
		if result.Items[index].Active {
			active := result.Items[index]
			result.Active = &active
			break
		}
	}
	return result, nil
}

func (manager *Manager) Open(ctx context.Context, projectID string, input OpenInput) (Overview, error) {
	base, err := manager.store.GetBaseProject(ctx, projectID)
	if err != nil {
		return Overview{}, err
	}
	branch, remoteBranch, err := manager.resolveOpenBranch(ctx, base.BaseStorePath, input)
	if err != nil {
		return Overview{}, err
	}
	if _, err := manager.ensureBaseWorkspace(ctx, base); err != nil {
		return Overview{}, err
	}
	workspace, err := manager.store.GetTaskWorkspaceByBranch(ctx, projectID, branch)
	if err == nil {
		if validateErr := manager.validateWorkspace(ctx, base.BaseStorePath, workspace); validateErr != nil {
			return Overview{}, validateErr
		}
		if err := manager.store.SetActiveTaskWorkspace(ctx, projectID, workspace.ID); err != nil {
			return Overview{}, err
		}
		return manager.List(ctx, projectID)
	}
	if !errors.Is(err, ErrWorkspaceNotFound) {
		return Overview{}, err
	}

	id := randomID()
	target := filepath.Join(manager.managedRoot, projectID, id)
	parent := filepath.Dir(target)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return Overview{}, ErrWorkspaceUnavailable
	}
	localRefExists := manager.refExists(ctx, base.BaseStorePath, "refs/heads/"+branch)
	arguments := []string{"worktree", "add", "--", target, branch}
	if remoteBranch != "" && !localRefExists {
		arguments = []string{"worktree", "add", "-b", branch, "--track", "--", target, remoteBranch}
	} else if !localRefExists {
		remoteRef := "refs/remotes/origin/" + branch
		if manager.refExists(ctx, base.BaseStorePath, remoteRef) {
			arguments = []string{"worktree", "add", "-b", branch, "--track", "--", target, "origin/" + branch}
		} else {
			arguments = []string{"worktree", "add", "-b", branch, "--", target, "HEAD"}
		}
	}
	result, runErr := manager.run(ctx, base.BaseStorePath, 90*time.Second, arguments...)
	if runErr != nil {
		if strings.Contains(strings.ToLower(result.Stderr), "already checked out") {
			return Overview{}, ErrWorkspaceConflict
		}
		return Overview{}, ErrWorkspaceUnavailable
	}
	created := Workspace{ID: id, ProjectID: projectID, Branch: branch, Path: target, Managed: true}
	if err := manager.validateWorkspace(ctx, base.BaseStorePath, created); err != nil {
		_, _ = manager.run(context.Background(), base.BaseStorePath, 30*time.Second, "worktree", "remove", "--force", "--", target)
		return Overview{}, err
	}
	created, err = manager.store.CreateTaskWorkspace(ctx, created)
	if err != nil {
		_, _ = manager.run(context.Background(), base.BaseStorePath, 30*time.Second, "worktree", "remove", "--force", "--", target)
		return Overview{}, err
	}
	if err := manager.store.SetActiveTaskWorkspace(ctx, projectID, created.ID); err != nil {
		return Overview{}, err
	}
	return manager.List(ctx, projectID)
}

func (manager *Manager) Sync(ctx context.Context, projectID string) (SyncResult, error) {
	base, err := manager.store.GetBaseProject(ctx, projectID)
	if err != nil {
		return SyncResult{}, err
	}
	overview, err := manager.List(ctx, projectID)
	if err != nil {
		return SyncResult{}, err
	}
	if overview.Active == nil {
		return SyncResult{}, ErrWorkspaceUnavailable
	}
	active := *overview.Active
	if err := manager.validateWorkspace(ctx, base.BaseStorePath, active); err != nil {
		return SyncResult{}, err
	}
	previousHead, err := manager.output(ctx, active.Path, 15*time.Second, "rev-parse", "HEAD")
	if err != nil {
		return SyncResult{}, ErrWorkspaceUnavailable
	}
	result, pullErr := manager.run(ctx, active.Path, 2*time.Minute, "pull", "--ff-only", "--no-rebase")
	if pullErr != nil {
		message := strings.ToLower(result.Stdout + "\n" + result.Stderr)
		switch {
		case strings.Contains(message, "no tracking information"),
			strings.Contains(message, "has no upstream branch"),
			strings.Contains(message, "upstream branch") && strings.Contains(message, "does not exist"):
			return SyncResult{}, ErrSyncUpstream
		case strings.Contains(message, "would be overwritten"),
			strings.Contains(message, "local changes"),
			strings.Contains(message, "not possible to fast-forward"),
			strings.Contains(message, "cannot fast-forward"):
			return SyncResult{}, ErrSyncConflict
		default:
			return SyncResult{}, ErrSyncFailed
		}
	}
	head, err := manager.output(ctx, active.Path, 15*time.Second, "rev-parse", "HEAD")
	if err != nil {
		return SyncResult{}, ErrWorkspaceUnavailable
	}
	return SyncResult{
		Task: active.Branch, Updated: head != previousHead,
		PreviousHead: previousHead, Head: head,
	}, nil
}

func (manager *Manager) ensureBaseWorkspace(ctx context.Context, item project.Project) (Workspace, error) {
	basePath := item.BaseStorePath
	if basePath == "" {
		basePath = item.StorePath
	}
	branch, err := manager.output(ctx, basePath, 15*time.Second, "branch", "--show-current")
	if err != nil || strings.TrimSpace(branch) == "" {
		return Workspace{}, ErrWorkspaceUnavailable
	}
	branch = strings.TrimSpace(branch)
	workspace, err := manager.store.GetTaskWorkspaceByBranch(ctx, item.ID, branch)
	if err == nil {
		return workspace, manager.validateWorkspace(ctx, basePath, workspace)
	}
	if !errors.Is(err, ErrWorkspaceNotFound) {
		return Workspace{}, err
	}
	workspace, err = manager.store.CreateTaskWorkspace(ctx, Workspace{
		ProjectID: item.ID, Branch: branch, Path: basePath, Managed: false,
	})
	if err != nil {
		return Workspace{}, err
	}
	if item.ActiveWorktreeID == nil {
		if err := manager.store.SetActiveTaskWorkspace(ctx, item.ID, workspace.ID); err != nil {
			return Workspace{}, err
		}
	}
	return workspace, nil
}

func (manager *Manager) validateWorkspace(ctx context.Context, basePath string, workspace Workspace) error {
	info, err := os.Lstat(workspace.Path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return ErrWorkspaceUnavailable
	}
	root, err := manager.output(ctx, workspace.Path, 15*time.Second, "rev-parse", "--show-toplevel")
	if err != nil {
		return ErrWorkspaceUnavailable
	}
	canonical, err := filepath.EvalSymlinks(workspace.Path)
	if err != nil || strings.TrimSpace(root) != canonical {
		return ErrWorkspaceUnavailable
	}
	actualBranch, err := manager.output(ctx, workspace.Path, 15*time.Second, "branch", "--show-current")
	if err != nil || strings.TrimSpace(actualBranch) != workspace.Branch {
		return ErrWorkspaceConflict
	}
	baseCommon, err := manager.commonDir(ctx, basePath)
	if err != nil {
		return ErrWorkspaceUnavailable
	}
	workspaceCommon, err := manager.commonDir(ctx, workspace.Path)
	if err != nil || baseCommon != workspaceCommon {
		return ErrWorkspaceConflict
	}
	return nil
}

func (manager *Manager) commonDir(ctx context.Context, path string) (string, error) {
	value, err := manager.output(ctx, path, 15*time.Second, "rev-parse", "--git-common-dir")
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(value) {
		value = filepath.Join(path, value)
	}
	return filepath.EvalSymlinks(filepath.Clean(value))
}

func (manager *Manager) validateBranch(ctx context.Context, path, branch string) (string, error) {
	branch = strings.TrimSpace(branch)
	if branch == "" || strings.HasPrefix(branch, "-") || strings.ContainsAny(branch, "\x00\r\n") {
		return "", ErrInvalidBranch
	}
	if _, err := manager.run(ctx, path, 15*time.Second, "check-ref-format", "--branch", branch); err != nil {
		return "", ErrInvalidBranch
	}
	return branch, nil
}

func (manager *Manager) resolveOpenBranch(ctx context.Context, path string, input OpenInput) (string, string, error) {
	branch := strings.TrimSpace(input.Branch)
	remoteBranch := strings.TrimSpace(input.RemoteBranch)
	if (branch == "") == (remoteBranch == "") {
		return "", "", ErrInvalidBranch
	}
	if remoteBranch == "" {
		validated, err := manager.validateBranch(ctx, path, branch)
		return validated, "", err
	}
	if !strings.HasPrefix(remoteBranch, "origin/") || remoteBranch == "origin/HEAD" {
		return "", "", ErrInvalidBranch
	}
	localBranch, err := manager.validateBranch(ctx, path, strings.TrimPrefix(remoteBranch, "origin/"))
	if err != nil {
		return "", "", err
	}
	if !manager.refExists(ctx, path, "refs/remotes/"+remoteBranch) {
		return "", "", ErrRemoteBranchNotFound
	}
	return localBranch, remoteBranch, nil
}

func (manager *Manager) localBranches(ctx context.Context, path string) ([]string, error) {
	value, err := manager.output(ctx, path, 15*time.Second, "for-each-ref", "--format=%(refname:short)", "refs/heads")
	if err != nil {
		return nil, ErrWorkspaceUnavailable
	}
	branches := strings.Fields(value)
	sort.Strings(branches)
	return branches, nil
}

func (manager *Manager) remoteBranches(ctx context.Context, path string) ([]string, error) {
	value, err := manager.output(ctx, path, 15*time.Second, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
	if err != nil {
		return nil, ErrWorkspaceUnavailable
	}
	branches := make([]string, 0)
	for _, branch := range strings.Fields(value) {
		if strings.HasPrefix(branch, "origin/") && branch != "origin/HEAD" {
			branches = append(branches, branch)
		}
	}
	sort.Strings(branches)
	return branches, nil
}

func (manager *Manager) refExists(ctx context.Context, path, ref string) bool {
	_, err := manager.run(ctx, path, 15*time.Second, "show-ref", "--verify", "--quiet", ref)
	return err == nil
}

func (manager *Manager) isDirty(ctx context.Context, path string) bool {
	value, err := manager.output(ctx, path, 15*time.Second, "status", "--porcelain=v1", "--untracked-files=normal")
	return err == nil && strings.TrimSpace(value) != ""
}

func (manager *Manager) output(ctx context.Context, path string, timeout time.Duration, arguments ...string) (string, error) {
	result, err := manager.run(ctx, path, timeout, arguments...)
	return strings.TrimSpace(result.Stdout), err
}

func (manager *Manager) run(ctx context.Context, path string, timeout time.Duration, arguments ...string) (processrunner.Result, error) {
	if manager.gitPath == "" {
		return processrunner.Result{}, project.ErrGitUnavailable
	}
	return manager.runner.Run(ctx, processrunner.Command{
		Executable: manager.gitPath, Arguments: arguments, Directory: path,
		Timeout: timeout, MaxOutputBytes: 128 << 10,
		Environment: map[string]string{"GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"},
	})
}

func randomID() string {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		panic("crypto/rand unavailable")
	}
	return hex.EncodeToString(value)
}
