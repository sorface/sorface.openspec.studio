package openspec

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
)

type runnerFunc func(context.Context, processrunner.Command) (processrunner.Result, error)

func (function runnerFunc) Run(ctx context.Context, command processrunner.Command) (processrunner.Result, error) {
	return function(ctx, command)
}

func TestCapabilityAcceptsSupportedAndRejectsUnknownMajor(t *testing.T) {
	root := t.TempDir()
	executable := filepath.Join(t.TempDir(), "openspec")
	for _, testCase := range []struct {
		version   string
		supported bool
	}{
		{version: "1.7.0", supported: true},
		{version: "v1.9.2", supported: true},
		{version: "2.0.0", supported: false},
		{version: "unknown", supported: false},
	} {
		cli := NewCLI(executable, runnerFunc(func(_ context.Context, command processrunner.Command) (processrunner.Result, error) {
			if !reflect.DeepEqual(command.Arguments, []string{"--version"}) {
				t.Fatalf("unexpected arguments: %v", command.Arguments)
			}
			return processrunner.Result{Stdout: testCase.version}, nil
		}))
		capability := cli.Capability(context.Background(), root)
		if !capability.Available || capability.Supported != testCase.supported || capability.Version != testCase.version {
			t.Fatalf("version=%q capability=%#v", testCase.version, capability)
		}
	}
}

func TestListStatusInstructionsAndValidateJSONFixtures(t *testing.T) {
	root := t.TempDir()
	executable := filepath.Join(t.TempDir(), "openspec")
	fixtures := map[string]string{
		"list --json":                                        `{"changes":[{"name":"add-auth","completedTasks":1,"totalTasks":2,"lastModified":"2026-07-30T00:00:00Z","status":"in-progress"}]}`,
		"status --change add-auth --json":                    `{"changeName":"add-auth","schemaName":"spec-driven","isComplete":false,"applyRequires":["tasks"],"artifacts":[{"id":"proposal","outputPath":"proposal.md","status":"done","requires":[]},{"id":"design","outputPath":"design.md","status":"ready","requires":["proposal"]}]}`,
		"instructions design --change add-auth --json":       `{"artifactId":"design","changeDir":"` + filepath.ToSlash(filepath.Join(root, "openspec/changes/add-auth")) + `","instruction":"Create design","context":"project","rules":["safe"],"template":"## Context","resolvedOutputPath":"` + filepath.ToSlash(filepath.Join(root, "openspec/changes/add-auth/design.md")) + `","dependencies":[{"id":"proposal","done":true,"path":"proposal.md"}]}`,
		"validate add-auth --strict --no-interactive --json": `{"items":[{"id":"add-auth","valid":false,"issues":[{"level":"ERROR","path":"design.md","message":"missing section"}]}],"summary":{"totals":{"failed":1}}}`,
	}
	cli := NewCLI(executable, runnerFunc(func(_ context.Context, command processrunner.Command) (processrunner.Result, error) {
		output, ok := fixtures[strings.Join(command.Arguments, " ")]
		if !ok {
			t.Fatalf("unexpected command: %v", command.Arguments)
		}
		return processrunner.Result{Stdout: output}, nil
	}))
	list, err := cli.List(context.Background(), root)
	if err != nil || len(list.Changes) != 1 || list.Changes[0].Name != "add-auth" {
		t.Fatalf("list=%#v err=%v", list, err)
	}
	status, err := cli.Status(context.Background(), root, "add-auth")
	if err != nil || status.SchemaName != "spec-driven" || len(status.Artifacts) != 2 {
		t.Fatalf("status=%#v err=%v", status, err)
	}
	instructions, err := cli.Instructions(context.Background(), root, "add-auth", "design")
	if err != nil || instructions.ArtifactID != "design" || len(instructions.Dependencies) != 1 ||
		instructions.ChangeDir != filepath.Join(root, "openspec", "changes", "add-auth") {
		t.Fatalf("instructions=%#v err=%v", instructions, err)
	}
	validation, err := cli.Validate(context.Background(), root, "add-auth")
	if err != nil || validation.Valid || len(validation.Diagnostics) != 1 ||
		validation.Diagnostics[0].Path != "design.md" {
		t.Fatalf("validation=%#v err=%v", validation, err)
	}
}

func TestValidateParsesDiagnosticsFromExpectedNonZeroExit(t *testing.T) {
	root := t.TempDir()
	executable := filepath.Join(t.TempDir(), "openspec")
	cli := NewCLI(executable, runnerFunc(func(context.Context, processrunner.Command) (processrunner.Result, error) {
		return processrunner.Result{
			ExitCode: 1,
			Stdout:   `{"items":[{"id":"add-auth","valid":false,"issues":[{"level":"ERROR","path":"tasks.md","message":"invalid task"}]}],"summary":{"totals":{"failed":1}}}`,
		}, &exec.ExitError{}
	}))
	validation, err := cli.Validate(context.Background(), root, "add-auth")
	if err != nil || validation.Valid || len(validation.Diagnostics) != 1 ||
		validation.Diagnostics[0].Message != "invalid task" {
		t.Fatalf("validation=%#v err=%v", validation, err)
	}
}

func TestReadOnlyCommandsUseFixedArgumentsAndDetectMutation(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "openspec", "config.yaml")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("schema: spec-driven\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(t.TempDir(), "openspec")
	cli := NewCLI(executable, runnerFunc(func(_ context.Context, command processrunner.Command) (processrunner.Result, error) {
		if command.Executable != executable || command.Directory != root ||
			!reflect.DeepEqual(command.Arguments, []string{"list", "--json"}) {
			t.Fatalf("unsafe command: %#v", command)
		}
		if err := os.WriteFile(path, []byte("schema: changed\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		return processrunner.Result{Stdout: `{"changes":[]}`}, nil
	}))
	if _, err := cli.List(context.Background(), root); !errors.Is(err, ErrReadOnlyViolation) {
		t.Fatalf("expected read-only violation, got %v", err)
	}
}

func TestRejectsUnsafeChangeAndArtifactNames(t *testing.T) {
	cli := NewCLI(filepath.Join(t.TempDir(), "openspec"), runnerFunc(func(context.Context, processrunner.Command) (processrunner.Result, error) {
		t.Fatal("runner must not be called")
		return processrunner.Result{}, nil
	}))
	for _, value := range []string{"../other", "Uppercase", "-change", "change--name"} {
		if _, err := cli.Status(context.Background(), t.TempDir(), value); !errors.Is(err, ErrInvalidChange) {
			t.Fatalf("change=%q err=%v", value, err)
		}
	}
	if _, err := cli.Instructions(context.Background(), t.TempDir(), "safe-change", "../tasks"); !errors.Is(err, ErrInvalidChange) {
		t.Fatalf("unsafe artifact accepted: %v", err)
	}
}
