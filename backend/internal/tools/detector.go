package tools

import (
	"context"
	"encoding/json"
	"os/exec"
	"regexp"
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
		result.Models = detectCodexModels(parent, path)
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

var modelSlugPattern = regexp.MustCompile(`^[A-Za-z0-9._:/-]{1,100}$`)

func detectCodexModels(parent context.Context, path string) []string {
	type catalogModel struct {
		Slug       string `json:"slug"`
		Visibility string `json:"visibility"`
	}
	type catalog struct {
		Models []catalogModel `json:"models"`
	}

	commands := [][]string{{"debug", "models"}, {"debug", "models", "--bundled"}}
	for _, arguments := range commands {
		ctx, cancel := context.WithTimeout(parent, 4*time.Second)
		output, err := exec.CommandContext(ctx, path, arguments...).Output()
		cancel()
		if err != nil {
			continue
		}

		var decoded catalog
		if json.Unmarshal(output, &decoded) != nil {
			continue
		}
		models := make([]string, 0, len(decoded.Models))
		seen := make(map[string]struct{}, len(decoded.Models))
		for _, model := range decoded.Models {
			if (model.Visibility != "" && model.Visibility != "list") || !modelSlugPattern.MatchString(model.Slug) {
				continue
			}
			if _, exists := seen[model.Slug]; exists {
				continue
			}
			seen[model.Slug] = struct{}{}
			models = append(models, model.Slug)
		}
		if len(models) > 0 {
			return models
		}
	}
	return nil
}
