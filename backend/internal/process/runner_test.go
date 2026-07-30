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
	for _, item := range environment(nil) {
		if item == "UNSAFE_TEST_SECRET=secret" {
			t.Fatal("unsafe environment inherited")
		}
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
