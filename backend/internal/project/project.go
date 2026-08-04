package project

import (
	"context"
	"errors"
	"strings"
	"time"
)

var (
	ErrNotFound                    = errors.New("project not found")
	ErrInvalidName                 = errors.New("project name is required")
	ErrInvalidStorePath            = errors.New("invalid store path")
	ErrInvalidStore                = errors.New("invalid store")
	ErrInvalidGitURL               = errors.New("invalid git url")
	ErrTargetNotEmpty              = errors.New("clone target is not empty")
	ErrGitUnavailable              = errors.New("git is unavailable")
	ErrGitAuthFailed               = errors.New("git authentication failed")
	ErrSSHHostKeyFailed            = errors.New("ssh host key verification failed")
	ErrGitCloneFailed              = errors.New("git clone failed")
	ErrInvalidContextManifest      = errors.New("invalid context manifest")
	ErrInvalidContextRepositoryURL = errors.New("invalid context repository url")
)

type Project struct {
	ID               string                `json:"id"`
	Name             string                `json:"name"`
	StorePath        string                `json:"storePath"`
	BaseStorePath    string                `json:"-"`
	ActiveWorktreeID *string               `json:"activeWorktreeId"`
	ActiveTask       string                `json:"activeTask,omitempty"`
	DefaultProvider  *string               `json:"defaultAiProvider"`
	DefaultModel     *string               `json:"defaultModel"`
	ContextImport    *ContextImportSummary `json:"contextImport,omitempty"`
	CreatedAt        time.Time             `json:"createdAt"`
	UpdatedAt        time.Time             `json:"updatedAt"`
}

type CreateInput struct {
	Name      string `json:"name"`
	StorePath string `json:"storePath"`
}

type CreateFromGitInput struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type UpdateInput struct {
	Name            *string `json:"name"`
	DefaultProvider *string `json:"defaultAiProvider"`
	DefaultModel    *string `json:"defaultModel"`
}

type ContextImportFailure struct {
	URL     string `json:"url"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ContextImportSummary struct {
	ManifestFound bool                   `json:"manifestFound"`
	Requested     int                    `json:"requested"`
	Imported      int                    `json:"imported"`
	Failures      []ContextImportFailure `json:"failures"`
}

type Repository interface {
	List(context.Context) ([]Project, error)
	Get(context.Context, string) (Project, error)
	Create(context.Context, CreateInput) (Project, error)
	Update(context.Context, string, UpdateInput) (Project, error)
	Delete(context.Context, string) error
}

type Service struct {
	repository      Repository
	stores          StoreManager
	contextImporter ContextImporter
}

type StoreManager interface {
	Validate(context.Context, string) (string, error)
	Clone(context.Context, string) (string, error)
}

type ContextImporter interface {
	ValidateContextRepositories([]string) ([]string, error)
	ImportContext(context.Context, Project, []string) ContextImportSummary
}

func NewService(repository Repository, managers ...StoreManager) *Service {
	var stores StoreManager
	if len(managers) > 0 {
		stores = managers[0]
	}
	return &Service{repository: repository, stores: stores}
}

func (service *Service) WithContextImporter(importer ContextImporter) *Service {
	service.contextImporter = importer
	return service
}

func (service *Service) List(ctx context.Context) ([]Project, error) {
	return service.repository.List(ctx)
}

func (service *Service) Get(ctx context.Context, id string) (Project, error) {
	return service.repository.Get(ctx, id)
}

func (service *Service) Create(ctx context.Context, input CreateInput) (Project, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.StorePath = strings.TrimSpace(input.StorePath)
	if input.Name == "" {
		return Project{}, ErrInvalidName
	}
	if service.stores != nil {
		path, err := service.stores.Validate(ctx, input.StorePath)
		if err != nil {
			return Project{}, err
		}
		input.StorePath = path
	}
	return service.repository.Create(ctx, input)
}

func (service *Service) CreateFromGit(ctx context.Context, input CreateFromGitInput) (Project, error) {
	input.Name = strings.TrimSpace(input.Name)
	if service.stores == nil {
		return Project{}, ErrGitUnavailable
	}
	path, err := service.stores.Clone(ctx, strings.TrimSpace(input.URL))
	if err != nil {
		return Project{}, err
	}
	manifest, manifestFound, err := ReadContextManifest(path)
	if err != nil {
		return Project{}, err
	}
	if manifestFound {
		input.Name = manifest.Name
	}
	if input.Name == "" {
		return Project{}, ErrInvalidName
	}

	var repositories []string
	if manifestFound && len(manifest.Repositories) > 0 {
		if service.contextImporter == nil {
			return Project{}, ErrGitUnavailable
		}
		repositories, err = service.contextImporter.ValidateContextRepositories(manifest.Repositories)
		if err != nil {
			return Project{}, err
		}
	}

	created, err := service.repository.Create(ctx, CreateInput{Name: input.Name, StorePath: path})
	if err != nil {
		return Project{}, err
	}
	if manifestFound {
		summary := ContextImportSummary{
			ManifestFound: true,
			Requested:     len(repositories),
			Failures:      []ContextImportFailure{},
		}
		if len(repositories) > 0 {
			imported := service.contextImporter.ImportContext(ctx, created, repositories)
			summary.Imported = imported.Imported
			summary.Failures = imported.Failures
		}
		created.ContextImport = &summary
	}
	return created, nil
}

func (service *Service) Update(ctx context.Context, id string, input UpdateInput) (Project, error) {
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return Project{}, ErrInvalidName
		}
		input.Name = &name
	}
	return service.repository.Update(ctx, id, input)
}

func (service *Service) Delete(ctx context.Context, id string) error {
	return service.repository.Delete(ctx, id)
}
