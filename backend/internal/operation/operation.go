package operation

import (
	"errors"
	"time"
)

type Kind string
type Status string

const (
	KindRepositoryClone Kind = "repository_clone"
	KindAI              Kind = "ai"

	StatusQueued         Status = "queued"
	StatusRunning        Status = "running"
	StatusValidating     Status = "validating"
	StatusCompleted      Status = "completed"
	StatusAwaitingReview Status = "awaiting_review"
	StatusCancelled      Status = "cancelled"
	StatusFailed         Status = "failed"
)

var ErrInvalidTransition = errors.New("invalid operation status transition")

type Operation struct {
	ID            string    `json:"id"`
	ProjectID     string    `json:"projectId"`
	Kind          Kind      `json:"kind"`
	Status        Status    `json:"status"`
	Provider      string    `json:"provider,omitempty"`
	Model         string    `json:"model,omitempty"`
	Prompt        string    `json:"prompt,omitempty"`
	InputJSON     string    `json:"-"`
	ResultJSON    string    `json:"result,omitempty"`
	ErrorCode     string    `json:"errorCode,omitempty"`
	ErrorMessage  string    `json:"errorMessage,omitempty"`
	CorrelationID string    `json:"correlationId,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type Event struct {
	Sequence    int64     `json:"sequence"`
	OperationID string    `json:"operationId"`
	Type        string    `json:"type"`
	Payload     string    `json:"payload"`
	CreatedAt   time.Time `json:"createdAt"`
}

type RepositoryLink struct {
	ID            string    `json:"id"`
	ProjectID     string    `json:"projectId"`
	Name          string    `json:"name"`
	Path          string    `json:"path"`
	RemoteURL     string    `json:"remoteUrl"`
	Fingerprint   string    `json:"fingerprint"`
	Branch        string    `json:"branch,omitempty"`
	CommitSHA     string    `json:"commitSha"`
	Dirty         bool      `json:"dirty"`
	Available     bool      `json:"available"`
	ReadOnlyForAI bool      `json:"readOnlyForAi"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type ContextEntry struct {
	OperationID string `json:"operationId,omitempty"`
	Source      string `json:"source"`
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	Checksum    string `json:"checksum"`
	Reason      string `json:"reason"`
	Included    bool   `json:"included"`
}

type Audit struct {
	OperationID string    `json:"operationId"`
	Executable  string    `json:"executable"`
	Arguments   string    `json:"arguments"`
	ExitCode    int       `json:"exitCode"`
	StopReason  string    `json:"stopReason,omitempty"`
	StdoutBytes int64     `json:"stdoutBytes"`
	StderrBytes int64     `json:"stderrBytes"`
	DurationMS  int64     `json:"durationMs"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (status Status) Terminal() bool {
	return status == StatusCompleted || status == StatusAwaitingReview ||
		status == StatusCancelled || status == StatusFailed
}

func CanTransition(from, to Status) bool {
	if from == to {
		return true
	}
	switch from {
	case StatusQueued:
		return to == StatusRunning || to == StatusCancelled || to == StatusFailed
	case StatusRunning:
		return to == StatusValidating || to == StatusCancelled || to == StatusFailed
	case StatusValidating:
		return to == StatusCompleted || to == StatusAwaitingReview ||
			to == StatusCancelled || to == StatusFailed
	default:
		return false
	}
}
