package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/taskcontext"
)

func TestCommitMessageGeneratorParsesStructuredResponse(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	bin := t.TempDir()
	writeExecutable(t, filepath.Join(bin, "codex"), "#!/bin/sh\nprintf '%s\\n' '{\"message\":\"{\\\"subject\\\":\\\"BILL-1842: уточнить правила биллинга\\\",\\\"body\\\":\\\"- Обновлена спецификация\\\"}\"}'\n")
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	generator := NewCommitMessageGenerator(t.TempDir())
	message, err := generator.Generate(context.Background(), taskcontext.MessageRequest{
		Task: "BILL-1842", Paths: []string{"openspec/spec.md"}, Diff: "diff --git a/openspec/spec.md b/openspec/spec.md",
		Provider: "codex",
	})
	if err != nil || message.Subject != "BILL-1842: уточнить правила биллинга" || message.Body != "- Обновлена спецификация" {
		t.Fatalf("message = %#v, %v", message, err)
	}
}

func TestCommitMessageGeneratorUnavailableAndTimeout(t *testing.T) {
	generator := NewCommitMessageGenerator(t.TempDir())
	if _, err := generator.Generate(context.Background(), taskcontext.MessageRequest{
		Task: "BILL-1842", Paths: []string{"openspec/spec.md"}, Diff: "diff", Provider: "missing",
	}); !errors.Is(err, ErrProviderUnsupported) {
		t.Fatalf("unsupported provider error = %v", err)
	}
	if runtime.GOOS == "windows" {
		return
	}
	bin := t.TempDir()
	writeExecutable(t, filepath.Join(bin, "codex"), "#!/bin/sh\nsleep 1\n")
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	generator.timeout = 20 * time.Millisecond
	if _, err := generator.Generate(context.Background(), taskcontext.MessageRequest{
		Task: "BILL-1842", Paths: []string{"openspec/spec.md"}, Diff: "diff", Provider: "codex",
	}); err == nil {
		t.Fatal("expected timeout")
	}
}

func writeExecutable(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o700); err != nil {
		t.Fatal(err)
	}
}
