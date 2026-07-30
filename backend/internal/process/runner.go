package process

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalidCommand = errors.New("invalid process command")
	ErrOutputLimit    = errors.New("process output limit exceeded")
)

type Command struct {
	Executable     string
	Arguments      []string
	Redact         map[int]bool
	Directory      string
	Stdin          string
	Environment    map[string]string
	Timeout        time.Duration
	MaxOutputBytes int64
	OnStdout       func([]byte)
	OnStderr       func([]byte)
}

type Result struct {
	Stdout     string
	Stderr     string
	ExitCode   int
	Duration   time.Duration
	StopReason string
	Arguments  []string
}

type Runner struct{}

func (Runner) Run(parent context.Context, command Command) (Result, error) {
	if err := validate(command); err != nil {
		return Result{}, err
	}
	timeout := command.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, command.Executable, command.Arguments...)
	cmd.Dir = command.Directory
	cmd.Stdin = strings.NewReader(command.Stdin)
	cmd.Env = environment(command.Environment)
	configureProcess(cmd)
	cmd.Cancel = func() error { return cancelProcess(cmd) }
	cmd.WaitDelay = 2 * time.Second

	limit := command.MaxOutputBytes
	if limit <= 0 {
		limit = 1 << 20
	}
	stdout := &limitedBuffer{limit: limit, callback: command.OnStdout}
	stderr := &limitedBuffer{limit: limit, callback: command.OnStderr}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	started := time.Now()
	err := cmd.Start()
	if err != nil {
		return Result{}, err
	}
	waitErr := cmd.Wait()
	result := Result{
		Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: 0,
		Duration: time.Since(started), Arguments: redact(command.Arguments, command.Redact),
	}
	if ctx.Err() != nil {
		result.StopReason = "cancelled"
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			result.StopReason = "timeout"
		}
		terminateProcess(cmd)
		return result, ctx.Err()
	}
	if stdout.exceeded || stderr.exceeded {
		result.StopReason = "output_limit"
		return result, ErrOutputLimit
	}
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			result.ExitCode = exitErr.ExitCode()
		}
		return result, waitErr
	}
	return result, nil
}

func validate(command Command) error {
	if !filepath.IsAbs(command.Executable) || !filepath.IsAbs(command.Directory) {
		return fmt.Errorf("%w: executable and cwd must be absolute", ErrInvalidCommand)
	}
	info, err := os.Stat(command.Directory)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("%w: cwd is unavailable", ErrInvalidCommand)
	}
	if strings.ContainsRune(command.Executable, '\x00') {
		return ErrInvalidCommand
	}
	return nil
}

func environment(values map[string]string) []string {
	result := make([]string, 0, len(values)+2)
	for _, key := range []string{"PATH", "HOME"} {
		if value := os.Getenv(key); value != "" {
			result = append(result, key+"="+value)
		}
	}
	for key, value := range values {
		if key == "PATH" || key == "HOME" || key == "LANG" || key == "LC_ALL" ||
			strings.HasPrefix(key, "CODEX_") || strings.HasPrefix(key, "GIT_") {
			result = append(result, key+"="+value)
		}
	}
	return result
}

func redact(arguments []string, sensitive map[int]bool) []string {
	result := append([]string(nil), arguments...)
	for index := range result {
		if sensitive[index] {
			result[index] = "[REDACTED]"
		}
	}
	return result
}

type limitedBuffer struct {
	mu       sync.Mutex
	buffer   bytes.Buffer
	limit    int64
	written  int64
	exceeded bool
	callback func([]byte)
}

func (buffer *limitedBuffer) Write(value []byte) (int, error) {
	buffer.mu.Lock()
	original := len(value)
	remaining := buffer.limit - buffer.written
	if remaining <= 0 {
		buffer.exceeded = true
		buffer.mu.Unlock()
		return original, nil
	}
	if int64(len(value)) > remaining {
		value = value[:remaining]
		buffer.exceeded = true
	}
	n, err := buffer.buffer.Write(value)
	buffer.written += int64(n)
	callback := buffer.callback
	chunk := append([]byte(nil), value...)
	buffer.mu.Unlock()
	if callback != nil && len(chunk) > 0 {
		callback(chunk)
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return n, err
	}
	return original, nil
}

func (buffer *limitedBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.buffer.String()
}

type Supervisor struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewSupervisor() *Supervisor {
	return &Supervisor{cancels: make(map[string]context.CancelFunc)}
}

func (supervisor *Supervisor) Context(parent context.Context, id string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	supervisor.mu.Lock()
	if previous := supervisor.cancels[id]; previous != nil {
		previous()
	}
	supervisor.cancels[id] = cancel
	supervisor.mu.Unlock()
	return ctx, func() {
		cancel()
		supervisor.mu.Lock()
		delete(supervisor.cancels, id)
		supervisor.mu.Unlock()
	}
}

func (supervisor *Supervisor) Cancel(id string) bool {
	supervisor.mu.Lock()
	cancel := supervisor.cancels[id]
	supervisor.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

func (supervisor *Supervisor) Close() {
	supervisor.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(supervisor.cancels))
	for _, cancel := range supervisor.cancels {
		cancels = append(cancels, cancel)
	}
	supervisor.cancels = make(map[string]context.CancelFunc)
	supervisor.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}
