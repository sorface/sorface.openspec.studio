package operation

import "testing"

func TestTransitions(t *testing.T) {
	valid := [][2]Status{
		{StatusQueued, StatusRunning},
		{StatusRunning, StatusValidating},
		{StatusValidating, StatusCompleted},
		{StatusValidating, StatusAwaitingReview},
		{StatusAwaitingReview, StatusAccepted},
		{StatusAwaitingReview, StatusRejected},
		{StatusRunning, StatusCancelled},
		{StatusQueued, StatusCancelled},
		{StatusQueued, StatusFailed},
		{StatusRunning, StatusFailed},
		{StatusValidating, StatusFailed},
	}
	for _, pair := range valid {
		if !CanTransition(pair[0], pair[1]) {
			t.Fatalf("expected transition %s -> %s", pair[0], pair[1])
		}
	}
	if CanTransition(StatusCompleted, StatusRunning) || CanTransition(StatusQueued, StatusCompleted) {
		t.Fatal("terminal or skipped transition accepted")
	}
	if !StatusFailed.Terminal() || StatusRunning.Terminal() {
		t.Fatal("terminal state classification is incorrect")
	}
	if KindStoreGit != "store_git" {
		t.Fatal("store Git operation kind changed")
	}
}
