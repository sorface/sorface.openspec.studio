package openspec

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
)

var (
	ErrToolUnavailable    = errors.New("openspec cli unavailable")
	ErrVersionUnsupported = errors.New("openspec cli version unsupported")
	ErrReadOnlyViolation  = errors.New("openspec read-only operation changed files")
	ErrInvalidChange      = errors.New("invalid openspec change")
	ErrCommandFailed      = errors.New("openspec command failed")
)

const (
	commandTimeout = 30 * time.Second
	outputLimit    = 4 << 20
)

type Runner interface {
	Run(context.Context, processrunner.Command) (processrunner.Result, error)
}

type CLI struct {
	executable string
	runner     Runner
}

func NewCLI(executable string, runner Runner) *CLI {
	if runner == nil {
		runner = processrunner.Runner{}
	}
	return &CLI{executable: executable, runner: runner}
}

func (cli *CLI) Capability(ctx context.Context, root string) Capability {
	if cli == nil || !filepath.IsAbs(cli.executable) {
		return Capability{}
	}
	result, err := cli.run(ctx, root, []string{"--version"}, false)
	if err != nil {
		return Capability{Available: true, Path: cli.executable}
	}
	version := strings.TrimSpace(result.Stdout)
	return Capability{
		Available: true,
		Supported: supportedVersion(version),
		Version:   version,
		Path:      cli.executable,
	}
}

func (cli *CLI) List(ctx context.Context, root string) (ListResult, error) {
	var value ListResult
	if err := cli.readJSON(ctx, root, []string{"list", "--json"}, &value); err != nil {
		return ListResult{}, err
	}
	if value.Changes == nil {
		value.Changes = []ChangeSummary{}
	}
	return value, nil
}

func (cli *CLI) Status(ctx context.Context, root, change string) (Status, error) {
	if !validChangeName(change) {
		return Status{}, ErrInvalidChange
	}
	var value Status
	if err := cli.readJSON(ctx, root, []string{"status", "--change", change, "--json"}, &value); err != nil {
		return Status{}, err
	}
	return value, nil
}

func (cli *CLI) Instructions(ctx context.Context, root, change, artifact string) (Instructions, error) {
	if !validChangeName(change) || !validArtifactID(artifact) {
		return Instructions{}, ErrInvalidChange
	}
	var value Instructions
	if err := cli.readJSON(ctx, root, []string{"instructions", artifact, "--change", change, "--json"}, &value); err != nil {
		return Instructions{}, err
	}
	return value, nil
}

func (cli *CLI) Show(ctx context.Context, root, change string) (json.RawMessage, error) {
	if !validChangeName(change) {
		return nil, ErrInvalidChange
	}
	result, err := cli.run(ctx, root, []string{"show", change, "--json"}, true)
	if err != nil {
		return nil, err
	}
	if !json.Valid([]byte(result.Stdout)) {
		return nil, fmt.Errorf("%w: invalid show JSON", ErrCommandFailed)
	}
	return json.RawMessage(result.Stdout), nil
}

func (cli *CLI) NewChange(ctx context.Context, root, change string) error {
	if !validChangeName(change) {
		return ErrInvalidChange
	}
	_, err := cli.run(ctx, root, []string{"new", "change", change, "--json"}, false)
	return err
}

func (cli *CLI) Archive(ctx context.Context, root, change string) error {
	if !validChangeName(change) {
		return ErrInvalidChange
	}
	_, err := cli.run(ctx, root, []string{"archive", change, "--yes", "--json"}, false)
	return err
}

func (cli *CLI) Validate(ctx context.Context, root, change string) (Validation, error) {
	args := []string{"validate"}
	if change != "" {
		if !validChangeName(change) {
			return Validation{}, ErrInvalidChange
		}
		args = append(args, change)
	} else {
		args = append(args, "--all")
	}
	args = append(args, "--strict", "--no-interactive", "--json")
	result, runErr := cli.runAllowExit(ctx, root, args, true)
	if errors.Is(runErr, ErrReadOnlyViolation) {
		return Validation{}, runErr
	}
	var raw validationPayload
	if err := json.Unmarshal([]byte(result.Stdout), &raw); err != nil {
		if runErr != nil {
			return Validation{}, fmt.Errorf("%w: validate output is not JSON", ErrCommandFailed)
		}
		return Validation{}, err
	}
	diagnostics := make([]Diagnostic, 0)
	valid := true
	for _, item := range raw.Items {
		if !item.Valid {
			valid = false
		}
		for _, issue := range item.Issues {
			diagnostics = append(diagnostics, Diagnostic{
				Level: issue.Level, Path: issue.Path, Message: issue.Message,
			})
		}
	}
	if raw.Summary.Totals.Failed > 0 {
		valid = false
	}
	return Validation{Valid: valid, Diagnostics: diagnostics, RawOutput: result.Stdout}, nil
}

func (cli *CLI) readJSON(ctx context.Context, root string, args []string, target any) error {
	result, err := cli.run(ctx, root, args, true)
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(result.Stdout), target); err != nil {
		return fmt.Errorf("%w: decode %s: %v", ErrCommandFailed, args[0], err)
	}
	return nil
}

func (cli *CLI) run(ctx context.Context, root string, args []string, readOnly bool) (processrunner.Result, error) {
	result, err := cli.runAllowExit(ctx, root, args, readOnly)
	if err != nil {
		return result, err
	}
	if result.ExitCode != 0 {
		return result, ErrCommandFailed
	}
	return result, nil
}

func (cli *CLI) runAllowExit(ctx context.Context, root string, args []string, readOnly bool) (processrunner.Result, error) {
	if cli == nil || !filepath.IsAbs(cli.executable) {
		return processrunner.Result{}, ErrToolUnavailable
	}
	if !filepath.IsAbs(root) {
		return processrunner.Result{}, ErrInvalidChange
	}
	var before string
	var err error
	if readOnly {
		before, err = treeFingerprint(root)
		if err != nil {
			return processrunner.Result{}, err
		}
	}
	result, runErr := cli.runner.Run(ctx, processrunner.Command{
		Executable:     cli.executable,
		Arguments:      append([]string(nil), args...),
		Directory:      root,
		Timeout:        commandTimeout,
		MaxOutputBytes: outputLimit,
		Environment: map[string]string{
			"NO_COLOR": "1",
			"CI":       "1",
		},
	})
	if readOnly {
		after, fingerprintErr := treeFingerprint(root)
		if fingerprintErr != nil {
			return result, fingerprintErr
		}
		if before != after {
			return result, ErrReadOnlyViolation
		}
	}
	var exitError *exec.ExitError
	if runErr != nil && !errors.As(runErr, &exitError) {
		return result, fmt.Errorf("%w: %s", ErrCommandFailed, safeCommandDiagnostic(result.Stderr))
	}
	return result, nil
}

type validationPayload struct {
	Items []struct {
		Valid  bool `json:"valid"`
		Issues []struct {
			Level   string `json:"level"`
			Path    string `json:"path"`
			Message string `json:"message"`
		} `json:"issues"`
	} `json:"items"`
	Summary struct {
		Totals struct {
			Failed int `json:"failed"`
		} `json:"totals"`
	} `json:"summary"`
}

func supportedVersion(version string) bool {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	part := strings.SplitN(version, ".", 2)[0]
	major, err := strconv.Atoi(part)
	return err == nil && major == 1
}

func validChangeName(value string) bool {
	if value == "" || len(value) > 120 || value[0] < 'a' || value[0] > 'z' {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return false
		}
	}
	return !strings.Contains(value, "--") && !strings.HasSuffix(value, "-")
}

func validArtifactID(value string) bool {
	if value == "" || len(value) > 80 {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' && char != '_' {
			return false
		}
	}
	return true
}

func treeFingerprint(root string) (string, error) {
	hash := sha256.New()
	count := 0
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if entry.IsDir() {
			if relative == ".git" || strings.HasPrefix(relative, ".git/") ||
				relative == "node_modules" || strings.HasPrefix(relative, "node_modules/") {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			fmt.Fprintf(hash, "L %s %s\n", relative, target)
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		count++
		if count > 20000 {
			return fmt.Errorf("%w: too many files to audit", ErrCommandFailed)
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		fmt.Fprintf(hash, "F %s %d\n", relative, len(content))
		_, _ = hash.Write(content)
		return nil
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func safeCommandDiagnostic(value string) string {
	if strings.TrimSpace(value) == "" {
		return "OpenSpec CLI завершился с ошибкой"
	}
	return "OpenSpec CLI завершился с ошибкой"
}
