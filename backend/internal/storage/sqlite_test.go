package storage_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/storage"
)

func TestProjectsSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.db")
	first, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	created, err := first.Create(context.Background(), project.CreateInput{Name: "Platform", StorePath: "/store"})
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	loaded, err := second.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Name != created.Name || loaded.StorePath != created.StorePath {
		t.Fatalf("loaded project differs: %#v", loaded)
	}
}
