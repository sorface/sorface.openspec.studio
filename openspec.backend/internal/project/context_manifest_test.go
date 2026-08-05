package project

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeContextManifest(t *testing.T, root, content string) string {
	t.Helper()
	directory := filepath.Join(root, ".openspec")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "context.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReadContextManifest(t *testing.T) {
	root := t.TempDir()
	writeContextManifest(t, root, `name: " sorface.openspec "
context:
  repositories:
    - git@example.com:team/one.git
    - ssh://git@example.com/team/two.git
`)

	manifest, found, err := ReadContextManifest(root)
	if err != nil || !found {
		t.Fatalf("read manifest: found=%v err=%v", found, err)
	}
	if manifest.Name != "sorface.openspec" || len(manifest.Repositories) != 2 {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
	if manifest.Repositories[0] != "git@example.com:team/one.git" {
		t.Fatalf("repository was not normalized: %#v", manifest.Repositories)
	}
}

func TestReadContextManifestAbsent(t *testing.T) {
	manifest, found, err := ReadContextManifest(t.TempDir())
	if err != nil || found || manifest.Name != "" {
		t.Fatalf("absent manifest: found=%v manifest=%#v err=%v", found, manifest, err)
	}
}

func TestReadContextManifestRejectsInvalidDocuments(t *testing.T) {
	tests := map[string]string{
		"unknown field": `name: demo
unknown: true
context:
  repositories: []
`,
		"wrong type": `name: demo
context:
  repositories: git@example.com:team/one.git
`,
		"empty name": `name: " "
context:
  repositories: []
`,
		"missing repositories": `name: demo
context: {}
`,
		"empty repository": `name: demo
context:
  repositories: [""]
`,
		"multiple documents": `name: demo
context:
  repositories: []
---
name: second
context:
  repositories: []
`,
	}
	for name, content := range tests {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			writeContextManifest(t, root, content)
			_, found, err := ReadContextManifest(root)
			if !found || !errors.Is(err, ErrInvalidContextManifest) {
				t.Fatalf("expected invalid manifest, found=%v err=%v", found, err)
			}
		})
	}
}

func TestReadContextManifestRejectsSymlinkAndLimits(t *testing.T) {
	t.Run("symlink", func(t *testing.T) {
		root := t.TempDir()
		directory := filepath.Join(root, ".openspec")
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(root, "target.yaml")
		if err := os.WriteFile(target, []byte("name: demo\ncontext:\n  repositories: []\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, filepath.Join(directory, "context.yaml")); err != nil {
			t.Fatal(err)
		}
		_, found, err := ReadContextManifest(root)
		if !found || !errors.Is(err, ErrInvalidContextManifest) {
			t.Fatalf("expected symlink rejection, found=%v err=%v", found, err)
		}
	})

	t.Run("file size", func(t *testing.T) {
		root := t.TempDir()
		writeContextManifest(t, root, strings.Repeat("x", maxContextManifestSize+1))
		_, found, err := ReadContextManifest(root)
		if !found || !errors.Is(err, ErrInvalidContextManifest) {
			t.Fatalf("expected size rejection, found=%v err=%v", found, err)
		}
	})

	t.Run("repository count", func(t *testing.T) {
		root := t.TempDir()
		var content strings.Builder
		content.WriteString("name: demo\ncontext:\n  repositories:\n")
		for index := 0; index <= maxContextRepositories; index++ {
			content.WriteString("    - git@example.com:team/repo.git\n")
		}
		writeContextManifest(t, root, content.String())
		_, found, err := ReadContextManifest(root)
		if !found || !errors.Is(err, ErrInvalidContextManifest) {
			t.Fatalf("expected count rejection, found=%v err=%v", found, err)
		}
	})
}
