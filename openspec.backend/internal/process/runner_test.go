package process

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestRunnerAndOutputLimit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	runner := Runner{}
	result, err := runner.Run(context.Background(), Command{
		Executable: "/bin/sh", Arguments: []string{"-c", "printf hello"},
		Directory: t.TempDir(), MaxOutputBytes: 64,
	})
	if err != nil || result.Stdout != "hello" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	_, err = runner.Run(context.Background(), Command{
		Executable: "/bin/sh", Arguments: []string{"-c", "printf 123456"},
		Directory: t.TempDir(), MaxOutputBytes: 3,
	})
	if !errors.Is(err, ErrOutputLimit) {
		t.Fatalf("expected output limit, got %v", err)
	}
}

func TestRunnerCanTruncateSuccessfulStderr(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	result, err := (Runner{}).Run(context.Background(), Command{
		Executable: "/bin/sh", Arguments: []string{"-c", "printf ok; printf 123456 >&2"},
		Directory: t.TempDir(), MaxOutputBytes: 3, AllowStderrTruncation: true,
	})
	if err != nil || result.Stdout != "ok" || result.Stderr != "123" || result.StopReason != "stderr_truncated" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestRunnerCanDisableTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	result, err := (Runner{}).Run(context.Background(), Command{
		Executable: "/bin/sh", Arguments: []string{"-c", "sleep 0.08; printf done"},
		Directory: t.TempDir(), Timeout: 10 * time.Millisecond, DisableTimeout: true,
	})
	if err != nil || result.Stdout != "done" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestCommandPolicyAndRedaction(t *testing.T) {
	runner := Runner{}
	_, err := runner.Run(context.Background(), Command{
		Executable: "relative", Directory: t.TempDir(),
	})
	if !errors.Is(err, ErrInvalidCommand) {
		t.Fatalf("expected invalid command, got %v", err)
	}
	if got := redact([]string{"--token", "secret"}, map[int]bool{1: true}); got[1] != "[REDACTED]" {
		t.Fatal("argument was not redacted")
	}
	_ = os.Setenv("UNSAFE_TEST_SECRET", "secret")
	items := environment(map[string]string{
		"SSH_AUTH_SOCK":  "/tmp/test-agent.sock",
		"SSH_AGENT_PID":  "123",
		"SSH_ASKPASS":    "/tmp/steal",
		"ANOTHER_SECRET": "hidden",
	})
	foundAgentSocket := false
	for _, item := range items {
		if item == "UNSAFE_TEST_SECRET=secret" {
			t.Fatal("unsafe environment inherited")
		}
		foundAgentSocket = foundAgentSocket || item == "SSH_AUTH_SOCK=/tmp/test-agent.sock"
		if item == "SSH_AGENT_PID=123" || item == "SSH_ASKPASS=/tmp/steal" || item == "ANOTHER_SECRET=hidden" {
			t.Fatalf("unsafe explicit environment accepted: %s", item)
		}
	}
	if !foundAgentSocket {
		t.Fatal("explicit SSH_AUTH_SOCK was not passed")
	}
}

func TestSupervisorCancellation(t *testing.T) {
	supervisor := NewSupervisor()
	ctx, done := supervisor.Context(context.Background(), "one")
	defer done()
	if !supervisor.Cancel("one") {
		t.Fatal("operation not found")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("context was not cancelled")
	}
	supervisor.Close()
	_ = filepath.Separator
}
