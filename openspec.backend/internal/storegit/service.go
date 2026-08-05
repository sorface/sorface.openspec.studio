package storegit

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/repository"
)

type Service struct {
	runner      processrunner.Runner
	gitPath     string
	managedRoot string
}

func NewService(managedRoots ...string) *Service {
	gitPath, _ := exec.LookPath("git")
	managedRoot := repository.DefaultManagedRoot("projects")
	if len(managedRoots) > 0 {
		managedRoot = managedRoots[0]
	}
	return &Service{gitPath: gitPath, managedRoot: managedRoot}
}

func (service *Service) Validate(ctx context.Context, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !filepath.IsAbs(value) {
		return "", project.ErrInvalidStorePath
	}
	if _, err := repository.ValidateGitURL(value); err == nil {
		return "", project.ErrInvalidStorePath
	}
	info, err := os.Lstat(value)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", project.ErrInvalidStorePath
	}
	canonical, err := filepath.EvalSymlinks(filepath.Clean(value))
	if err != nil {
		return "", project.ErrInvalidStorePath
	}
	if service.gitPath == "" {
		return "", project.ErrGitUnavailable
	}
	root, err := service.git(ctx, canonical, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", project.ErrInvalidStore
	}
	root, err = filepath.EvalSymlinks(strings.TrimSpace(root))
	if err != nil || root != canonical {
		return "", project.ErrInvalidStore
	}
	return canonical, nil
}

func (service *Service) Clone(ctx context.Context, remote string) (string, error) {
	normalizedURL, err := repository.ValidateGitURL(remote)
	if err != nil {
		return "", project.ErrInvalidGitURL
	}
	projectRoot, err := repository.CreateManagedTarget(service.managedRoot, normalizedURL)
	if err != nil {
		return "", project.ErrInvalidStorePath
	}
	target := filepath.Join(projectRoot, "store")
	if err := os.Mkdir(target, 0o700); err != nil {
		_ = os.RemoveAll(projectRoot)
		return "", project.ErrInvalidStorePath
	}
	created := true
	if service.gitPath == "" {
		_ = os.RemoveAll(projectRoot)
		return "", project.ErrGitUnavailable
	}
	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable: service.gitPath,
		Arguments:  []string{"clone", "--progress", "--", normalizedURL, target},
		Directory:  filepath.Dir(target),
		Environment: map[string]string{
			"GIT_TERMINAL_PROMPT": "0",
			"SSH_AUTH_SOCK":       strings.TrimSpace(os.Getenv("SSH_AUTH_SOCK")),
		},
		Timeout:        30 * time.Minute,
		MaxOutputBytes: 1 << 20,
	})
	if err != nil {
		if created {
			_ = os.RemoveAll(projectRoot)
		}
		return "", classifyCloneError(result.Stderr)
	}
	canonical, err := service.Validate(ctx, target)
	if err != nil {
		if created {
			_ = os.RemoveAll(projectRoot)
		}
		return "", err
	}
	return canonical, nil
}

func (service *Service) git(ctx context.Context, directory string, arguments ...string) (string, error) {
	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable:     service.gitPath,
		Arguments:      arguments,
		Directory:      directory,
		Timeout:        15 * time.Second,
		MaxOutputBytes: 64 << 10,
	})
	return result.Stdout, err
}

func classifyCloneError(stderr string) error {
	lower := strings.ToLower(stderr)
	switch {
	case strings.Contains(lower, "host key verification failed"),
		strings.Contains(lower, "remote host identification has changed"):
		return project.ErrSSHHostKeyFailed
	case strings.Contains(lower, "authentication failed"),
		strings.Contains(lower, "permission denied"),
		strings.Contains(lower, "publickey"),
		strings.Contains(lower, "could not read from remote repository"):
		return project.ErrGitAuthFailed
	default:
		return project.ErrGitCloneFailed
	}
}
