package gitstatus

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"

	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

const maxDiffBytes = 512 << 10

type ProjectStore interface {
	Get(context.Context, string) (project.Project, error)
}

type StoreValidator interface {
	Validate(context.Context, string) (string, error)
}

type Change struct {
	Path     string `json:"path"`
	Index    string `json:"index"`
	Worktree string `json:"worktree"`
}

type Status struct {
	Branch        string   `json:"branch"`
	Head          string   `json:"head"`
	Changes       []Change `json:"changes"`
	Diff          string   `json:"diff"`
	DiffTruncated bool     `json:"diffTruncated"`
}

type Service struct {
	projects  ProjectStore
	validator StoreValidator
	runner    processrunner.Runner
	gitPath   string
}

func NewService(projects ProjectStore, validator StoreValidator) *Service {
	gitPath, _ := exec.LookPath("git")
	return &Service{projects: projects, validator: validator, gitPath: gitPath}
}

func (service *Service) Get(ctx context.Context, projectID string) (Status, error) {
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return Status{}, err
	}
	path, err := service.validator.Validate(ctx, item.StorePath)
	if err != nil {
		return Status{}, err
	}
	if service.gitPath == "" {
		return Status{}, project.ErrGitUnavailable
	}
	head, err := service.run(ctx, path, 64<<10, "rev-parse", "HEAD")
	if err != nil {
		return Status{}, project.ErrInvalidStore
	}
	branch, _ := service.run(ctx, path, 64<<10, "branch", "--show-current")
	rawStatus, err := service.run(ctx, path, 256<<10, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return Status{}, project.ErrInvalidStore
	}
	unstaged, unstagedTruncated, err := service.diff(ctx, path, "diff", "--no-ext-diff", "--no-color", "--")
	if err != nil {
		return Status{}, err
	}
	staged, stagedTruncated, err := service.diff(ctx, path, "diff", "--cached", "--no-ext-diff", "--no-color", "--")
	if err != nil {
		return Status{}, err
	}
	diff := ""
	if staged != "" {
		diff += "# Staged\n" + staged
	}
	if unstaged != "" {
		if diff != "" {
			diff += "\n"
		}
		diff += "# Unstaged\n" + unstaged
	}
	return Status{
		Branch:        strings.TrimSpace(branch),
		Head:          strings.TrimSpace(head),
		Changes:       parseStatus(rawStatus),
		Diff:          diff,
		DiffTruncated: stagedTruncated || unstagedTruncated,
	}, nil
}

func (service *Service) diff(ctx context.Context, directory string, arguments ...string) (string, bool, error) {
	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable:     service.gitPath,
		Arguments:      arguments,
		Directory:      directory,
		Timeout:        30 * time.Second,
		MaxOutputBytes: maxDiffBytes,
	})
	if errors.Is(err, processrunner.ErrOutputLimit) {
		return result.Stdout, true, nil
	}
	return result.Stdout, false, err
}

func (service *Service) run(ctx context.Context, directory string, limit int64, arguments ...string) (string, error) {
	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable:     service.gitPath,
		Arguments:      arguments,
		Directory:      directory,
		Timeout:        30 * time.Second,
		MaxOutputBytes: limit,
	})
	return result.Stdout, err
}

func parseStatus(value string) []Change {
	records := strings.Split(value, "\x00")
	changes := make([]Change, 0, len(records))
	for index := 0; index < len(records); index++ {
		record := records[index]
		if len(record) < 4 {
			continue
		}
		path := record[3:]
		if (record[0] == 'R' || record[0] == 'C' || record[1] == 'R' || record[1] == 'C') && index+1 < len(records) {
			index++
			if records[index] != "" {
				path = records[index]
			}
		}
		changes = append(changes, Change{
			Path: path, Index: string(record[0]), Worktree: string(record[1]),
		})
	}
	return changes
}
