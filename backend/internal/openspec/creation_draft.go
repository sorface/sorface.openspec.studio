package openspec

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

const (
	CreationDraftVersion   = 1
	maxCreationDraftBytes  = 256 << 10
	maxCreationIntentBytes = 32 << 10
	maxCreationProposal    = 128 << 10
	maxCreationQuestions   = 5
)

var (
	ErrCreationDraftNotFound = operation.ErrChangeCreationDraftNotFound
	ErrInvalidCreationDraft  = errors.New("invalid openspec change creation draft")
)

type CreationStage = operation.CreationStage
type ExplorationQuestion = operation.ExplorationQuestion
type ExplorationResult = operation.ExplorationResult
type ChangeCreationDraft = operation.ChangeCreationDraft

const (
	CreationStageIntent     = operation.CreationStageIntent
	CreationStageClarifying = operation.CreationStageClarifying
	CreationStageProposal   = operation.CreationStageProposal
	CreationStageNaming     = operation.CreationStageNaming
	CreationStageCreating   = operation.CreationStageCreating
)

type CreationDraftStore interface {
	Get(context.Context, string) (project.Project, error)
	GetChangeCreationDraft(context.Context, string) (ChangeCreationDraft, error)
	UpsertChangeCreationDraft(context.Context, ChangeCreationDraft) (ChangeCreationDraft, error)
	DeleteChangeCreationDraft(context.Context, string) error
}

type CreationDraftService struct {
	store CreationDraftStore
}

func NewCreationDraftService(store CreationDraftStore) *CreationDraftService {
	return &CreationDraftService{store: store}
}

func (service *CreationDraftService) Get(ctx context.Context, projectID string) (ChangeCreationDraft, error) {
	if _, err := service.store.Get(ctx, projectID); err != nil {
		return ChangeCreationDraft{}, err
	}
	return service.store.GetChangeCreationDraft(ctx, projectID)
}

func (service *CreationDraftService) Save(
	ctx context.Context,
	projectID string,
	item ChangeCreationDraft,
) (ChangeCreationDraft, error) {
	if _, err := service.store.Get(ctx, projectID); err != nil {
		return ChangeCreationDraft{}, err
	}
	item.ProjectID = projectID
	if item.Version == 0 {
		item.Version = CreationDraftVersion
	}
	if item.Stage == "" {
		item.Stage = CreationStageIntent
	}
	if item.Questions == nil {
		item.Questions = []ExplorationQuestion{}
	}
	if item.Answers == nil {
		item.Answers = map[string][]string{}
	}
	if item.Assumptions == nil {
		item.Assumptions = []string{}
	}
	if item.SuggestedNames == nil {
		item.SuggestedNames = []string{}
	}
	if err := validateChangeCreationDraft(item); err != nil {
		return ChangeCreationDraft{}, err
	}
	return service.store.UpsertChangeCreationDraft(ctx, item)
}

func (service *CreationDraftService) Delete(ctx context.Context, projectID string) error {
	if _, err := service.store.Get(ctx, projectID); err != nil {
		return err
	}
	err := service.store.DeleteChangeCreationDraft(ctx, projectID)
	if errors.Is(err, ErrCreationDraftNotFound) {
		return nil
	}
	return err
}

func validateChangeCreationDraft(item ChangeCreationDraft) error {
	if item.Version != CreationDraftVersion || len(item.Intent) > maxCreationIntentBytes ||
		len(item.Proposal) > maxCreationProposal || len(item.Feedback) > maxCreationIntentBytes {
		return ErrInvalidCreationDraft
	}
	switch item.Stage {
	case CreationStageIntent, CreationStageClarifying, CreationStageProposal,
		CreationStageNaming, CreationStageCreating:
	default:
		return ErrInvalidCreationDraft
	}
	if len(item.Questions) > maxCreationQuestions || len(item.Assumptions) > 20 ||
		len(item.SuggestedNames) > 5 {
		return ErrInvalidCreationDraft
	}
	questionIDs := map[string]bool{}
	for _, question := range item.Questions {
		if err := validateExplorationQuestion(question); err != nil || questionIDs[question.ID] {
			return ErrInvalidCreationDraft
		}
		questionIDs[question.ID] = true
	}
	for id, values := range item.Answers {
		if !questionIDs[id] || len(values) > 8 {
			return ErrInvalidCreationDraft
		}
		for _, value := range values {
			if strings.TrimSpace(value) == "" || len(value) > 8<<10 {
				return ErrInvalidCreationDraft
			}
		}
	}
	for _, name := range item.SuggestedNames {
		if !validChangeName(name) {
			return ErrInvalidCreationDraft
		}
	}
	if item.ChangeName != "" && !validChangeName(item.ChangeName) {
		return ErrInvalidCreationDraft
	}
	if item.ProposalAccepted && strings.TrimSpace(item.Proposal) == "" {
		return ErrInvalidCreationDraft
	}
	if (item.Stage == CreationStageNaming || item.Stage == CreationStageCreating) &&
		(!item.ProposalAccepted || strings.TrimSpace(item.Proposal) == "") {
		return ErrInvalidCreationDraft
	}
	payload, err := json.Marshal(item)
	if err != nil || len(payload) > maxCreationDraftBytes {
		return ErrInvalidCreationDraft
	}
	return nil
}

func validateExplorationQuestion(question ExplorationQuestion) error {
	if strings.TrimSpace(question.ID) == "" || len(question.ID) > 80 ||
		strings.TrimSpace(question.Prompt) == "" || len(question.Prompt) > 2<<10 ||
		len(question.Why) > 2<<10 || len(question.Options) > 8 {
		return ErrInvalidCreationDraft
	}
	switch question.Kind {
	case "text":
		if len(question.Options) != 0 {
			return ErrInvalidCreationDraft
		}
	case "single_choice", "multi_choice":
		if len(question.Options) < 2 {
			return ErrInvalidCreationDraft
		}
	default:
		return ErrInvalidCreationDraft
	}
	for _, option := range question.Options {
		if strings.TrimSpace(option) == "" || len(option) > 500 {
			return ErrInvalidCreationDraft
		}
	}
	return nil
}
