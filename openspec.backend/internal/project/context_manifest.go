package project

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	contextManifestRelativePath = ".openspec/context.yaml"
	maxContextManifestSize      = 256 << 10
	maxContextRepositories      = 100
)

type ContextManifest struct {
	Name         string
	Repositories []string
}

type contextManifestDocument struct {
	Name    string                  `yaml:"name"`
	Context *contextManifestContext `yaml:"context"`
}

type contextManifestContext struct {
	Repositories *[]string `yaml:"repositories"`
}

func ReadContextManifest(storePath string) (ContextManifest, bool, error) {
	storeRoot, err := filepath.EvalSymlinks(filepath.Clean(storePath))
	if err != nil {
		return ContextManifest{}, false, ErrInvalidContextManifest
	}
	manifestPath := filepath.Join(storeRoot, filepath.FromSlash(contextManifestRelativePath))
	info, err := os.Lstat(manifestPath)
	if errors.Is(err, os.ErrNotExist) {
		return ContextManifest{}, false, nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > maxContextManifestSize {
		return ContextManifest{}, true, ErrInvalidContextManifest
	}
	canonicalPath, err := filepath.EvalSymlinks(manifestPath)
	if err != nil || !pathWithin(storeRoot, canonicalPath) {
		return ContextManifest{}, true, ErrInvalidContextManifest
	}
	content, err := os.ReadFile(canonicalPath)
	if err != nil || len(content) > maxContextManifestSize {
		return ContextManifest{}, true, ErrInvalidContextManifest
	}

	decoder := yaml.NewDecoder(bytes.NewReader(content))
	decoder.KnownFields(true)
	var document contextManifestDocument
	if err := decoder.Decode(&document); err != nil {
		return ContextManifest{}, true, ErrInvalidContextManifest
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return ContextManifest{}, true, ErrInvalidContextManifest
	}

	name := strings.TrimSpace(document.Name)
	if name == "" || document.Context == nil || document.Context.Repositories == nil {
		return ContextManifest{}, true, ErrInvalidContextManifest
	}
	repositories := *document.Context.Repositories
	if len(repositories) > maxContextRepositories {
		return ContextManifest{}, true, ErrInvalidContextManifest
	}
	for index := range repositories {
		repositories[index] = strings.TrimSpace(repositories[index])
		if repositories[index] == "" {
			return ContextManifest{}, true, ErrInvalidContextManifest
		}
	}
	return ContextManifest{Name: name, Repositories: repositories}, true, nil
}

func pathWithin(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
