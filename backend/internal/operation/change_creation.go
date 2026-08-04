package operation

import (
	"errors"
	"time"
)

var ErrChangeCreationDraftNotFound = errors.New("openspec change creation draft not found")

type CreationStage string

const (
	CreationStageIntent     CreationStage = "intent"
	CreationStageClarifying CreationStage = "clarifying"
	CreationStageProposal   CreationStage = "proposal"
	CreationStageNaming     CreationStage = "naming"
	CreationStageCreating   CreationStage = "creating"
)

type ExplorationQuestion struct {
	ID      string   `json:"id"`
	Prompt  string   `json:"prompt"`
	Why     string   `json:"why,omitempty"`
	Kind    string   `json:"kind"`
	Options []string `json:"options,omitempty"`
}

type ExplorationResult struct {
	State          string                `json:"state"`
	Summary        string                `json:"summary"`
	Questions      []ExplorationQuestion `json:"questions"`
	Assumptions    []string              `json:"assumptions"`
	Proposal       string                `json:"proposal,omitempty"`
	SuggestedNames []string              `json:"suggestedNames"`
}

type ChangeCreationDraft struct {
	ProjectID          string                `json:"projectId"`
	Version            int                   `json:"version"`
	Stage              CreationStage         `json:"stage"`
	Intent             string                `json:"intent"`
	Summary            string                `json:"summary,omitempty"`
	Questions          []ExplorationQuestion `json:"questions"`
	Answers            map[string][]string   `json:"answers"`
	Assumptions        []string              `json:"assumptions"`
	Proposal           string                `json:"proposal,omitempty"`
	SuggestedNames     []string              `json:"suggestedNames"`
	ProposalAccepted   bool                  `json:"proposalAccepted"`
	ChangeName         string                `json:"changeName,omitempty"`
	ContextFingerprint string                `json:"contextFingerprint,omitempty"`
	Feedback           string                `json:"feedback,omitempty"`
	CreatedAt          time.Time             `json:"createdAt"`
	UpdatedAt          time.Time             `json:"updatedAt"`
}
