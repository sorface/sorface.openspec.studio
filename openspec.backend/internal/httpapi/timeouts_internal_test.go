package httpapi

import (
	"testing"

	aiservice "github.com/sorface/openspec-studio/backend/internal/ai"
)

func TestHTTPWriteTimeoutExceedsCommitMessageDeadline(t *testing.T) {
	if httpWriteTimeout <= aiservice.CommitMessageTimeout {
		t.Fatalf("HTTP write timeout %s must exceed commit-message timeout %s", httpWriteTimeout, aiservice.CommitMessageTimeout)
	}
}
