package storegit

import (
	"errors"
	"testing"
)

func TestSafeNetworkErrorClassification(t *testing.T) {
	tests := []struct {
		stderr string
		stop   string
		want   error
		code   string
	}{
		{"Permission denied (publickey)", "", ErrGitAuthFailed, "GIT_AUTH_FAILED"},
		{"rejected (non-fast-forward)", "", ErrNonFastForward, "GIT_NON_FAST_FORWARD"},
		{"secret remote details", "timeout", ErrGitTimeout, "GIT_TIMEOUT"},
		{"unexpected secret remote details", "", ErrGitOperation, "GIT_OPERATION_FAILED"},
	}
	for _, test := range tests {
		got := classifyOperationError(test.stderr, test.stop)
		if !errors.Is(got, test.want) || errorCode(got) != test.code {
			t.Fatalf("classification %q/%q = %v (%s)", test.stderr, test.stop, got, errorCode(got))
		}
		if safeErrorMessage(got) == "" || safeErrorMessage(got) == test.stderr {
			t.Fatalf("unsafe message for %s", test.code)
		}
	}
}
