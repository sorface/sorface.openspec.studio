package openspec

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/project"
)

type creationDraftMemoryStore struct {
	project project.Project
	draft   ChangeCreationDraft
}

func (store *creationDraftMemoryStore) Get(context.Context, string) (project.Project, error) {
	if store.project.ID == "" {
		return project.Project{}, project.ErrNotFound
	}
	return store.project, nil
}

func (store *creationDraftMemoryStore) GetChangeCreationDraft(context.Context, string) (ChangeCreationDraft, error) {
	if store.draft.ProjectID == "" {
		return ChangeCreationDraft{}, ErrCreationDraftNotFound
	}
	return store.draft, nil
}

func (store *creationDraftMemoryStore) UpsertChangeCreationDraft(
	_ context.Context,
	item ChangeCreationDraft,
) (ChangeCreationDraft, error) {
	if item.CreatedAt.IsZero() {
		item.CreatedAt = time.Now().UTC()
	}
	item.UpdatedAt = time.Now().UTC()
	store.draft = item
	return item, nil
}

func (store *creationDraftMemoryStore) DeleteChangeCreationDraft(context.Context, string) error {
	if store.draft.ProjectID == "" {
		return ErrCreationDraftNotFound
	}
	store.draft = ChangeCreationDraft{}
	return nil
}

func TestCreationDraftServiceValidatesAndNormalizes(t *testing.T) {
	store := &creationDraftMemoryStore{project: project.Project{ID: "project-1"}}
	service := NewCreationDraftService(store)
	item, err := service.Save(context.Background(), "project-1", ChangeCreationDraft{
		Intent: "# Замысел",
		Questions: []ExplorationQuestion{{
			ID: "audience", Prompt: "Для кого доступен сценарий?", Why: "Меняет права", Kind: "single_choice",
			Options: []string{"Все", "Администраторы"},
		}},
		Answers: map[string][]string{"audience": {"Администраторы"}},
	})
	if err != nil || item.Version != CreationDraftVersion || item.Stage != CreationStageIntent ||
		item.ProjectID != "project-1" {
		t.Fatalf("item=%#v err=%v", item, err)
	}

	item.Stage = CreationStageNaming
	if _, err := service.Save(context.Background(), "project-1", item); !errors.Is(err, ErrInvalidCreationDraft) {
		t.Fatalf("expected naming without accepted proposal to fail, got %v", err)
	}
	item.Stage = CreationStageIntent
	item.Intent = strings.Repeat("x", maxCreationIntentBytes+1)
	if _, err := service.Save(context.Background(), "project-1", item); !errors.Is(err, ErrInvalidCreationDraft) {
		t.Fatalf("expected oversized intent to fail, got %v", err)
	}
}
