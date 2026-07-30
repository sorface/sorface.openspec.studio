package tools

import (
	"context"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type Tool struct {
	Name           string   `json:"name"`
	Available      bool     `json:"available"`
	Path           string   `json:"path,omitempty"`
	Version        string   `json:"version,omitempty"`
	Supported      *bool    `json:"supported,omitempty"`
	NonInteractive *bool    `json:"nonInteractive,omitempty"`
	Models         []string `json:"models,omitempty"`
}

type Capabilities struct {
	OS    string `json:"os"`
	Arch  string `json:"arch"`
	Tools []Tool `json:"tools"`
}

func Detect(ctx context.Context) Capabilities {
	names := []string{"git", "openspec", "codex", "gigacode"}
	result := Capabilities{OS: runtime.GOOS, Arch: runtime.GOARCH, Tools: make([]Tool, 0, len(names))}
	for _, name := range names {
		result.Tools = append(result.Tools, detectOne(ctx, name))
	}
	return result
}

func detectOne(parent context.Context, name string) Tool {
	path, err := exec.LookPath(name)
	if err != nil {
		return Tool{Name: name}
	}

	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "--version").CombinedOutput()
	version := strings.TrimSpace(string(output))
	if err != nil && version == "" {
		version = "версия недоступна"
	}
	result := Tool{Name: name, Available: true, Path: path, Version: version}
	if name == "codex" {
		supported := true
		result.Supported, result.NonInteractive = &supported, &supported
	}
	if name == "gigacode" {
		helpCtx, helpCancel := context.WithTimeout(parent, 2*time.Second)
		defer helpCancel()
		help, _ := exec.CommandContext(helpCtx, path, "--help").CombinedOutput()
		supported := strings.Contains(string(help), "--non-interactive") &&
			strings.Contains(string(help), "--json") && strings.Contains(string(help), "--cwd")
		result.Supported, result.NonInteractive = &supported, &supported
	}
	return result
}
