package project

import (
	"context"
	"errors"
	"strings"
	"time"
)

var (
	ErrNotFound    = errors.New("project not found")
	ErrInvalidName = errors.New("project name is required")
)

type Project struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	StorePath        string    `json:"storePath"`
	ActiveWorktreeID *string   `json:"activeWorktreeId"`
	DefaultProvider  *string   `json:"defaultAiProvider"`
	DefaultModel     *string   `json:"defaultModel"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type CreateInput struct {
	Name      string `json:"name"`
	StorePath string `json:"storePath"`
}

type UpdateInput struct {
	Name            *string `json:"name"`
	DefaultProvider *string `json:"defaultAiProvider"`
	DefaultModel    *string `json:"defaultModel"`
}

type Repository interface {
	List(context.Context) ([]Project, error)
	Get(context.Context, string) (Project, error)
	Create(context.Context, CreateInput) (Project, error)
	Update(context.Context, string, UpdateInput) (Project, error)
	Delete(context.Context, string) error
}

type Service struct {
	repository Repository
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository}
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
	return service.repository.Create(ctx, input)
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
