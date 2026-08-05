package project

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type fakeProjectRepository struct {
	created []CreateInput
}

func (*fakeProjectRepository) List(context.Context) ([]Project, error) { return nil, nil }
func (*fakeProjectRepository) Get(context.Context, string) (Project, error) {
	return Project{}, ErrNotFound
}
func (repository *fakeProjectRepository) Create(_ context.Context, input CreateInput) (Project, error) {
	repository.created = append(repository.created, input)
	return Project{ID: "project-1", Name: input.Name, StorePath: input.StorePath}, nil
}
func (*fakeProjectRepository) Update(context.Context, string, UpdateInput) (Project, error) {
	return Project{}, nil
}
func (*fakeProjectRepository) Delete(context.Context, string) error { return nil }

type fakeStoreManager struct {
	path string
}

func (manager fakeStoreManager) Validate(context.Context, string) (string, error) {
	return manager.path, nil
}
func (manager fakeStoreManager) Clone(context.Context, string) (string, error) {
	return manager.path, nil
}

type fakeContextImporter struct {
	validated   []string
	imported    []string
	validateErr error
	summary     ContextImportSummary
}

func (importer *fakeContextImporter) ValidateContextRepositories(values []string) ([]string, error) {
	importer.validated = append([]string(nil), values...)
	if importer.validateErr != nil {
		return nil, importer.validateErr
	}
	return []string{"git@example.com:team/one.git", "git@example.com:team/two.git"}, nil
}
func (importer *fakeContextImporter) ImportContext(_ context.Context, _ Project, values []string) ContextImportSummary {
	importer.imported = append([]string(nil), values...)
	return importer.summary
}

func TestCreateFromGitUsesManifestAndImportsContext(t *testing.T) {
	root := t.TempDir()
	writeContextManifest(t, root, `name: sorface.openspec
context:
  repositories:
    - git@example.com:team/one.git
    - git@example.com:team/one.git
    - git@example.com:team/two.git
`)
	repository := &fakeProjectRepository{}
	importer := &fakeContextImporter{summary: ContextImportSummary{
		Imported: 1,
		Failures: []ContextImportFailure{{
			URL: "git@example.com:team/two.git", Code: "GIT_AUTH_FAILED", Message: "auth failed",
		}},
	}}
	service := NewService(repository, fakeStoreManager{path: root}).WithContextImporter(importer)

	created, err := service.CreateFromGit(context.Background(), CreateFromGitInput{
		Name: "Fallback", URL: "git@example.com:team/store.git",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "sorface.openspec" || len(repository.created) != 1 {
		t.Fatalf("manifest name not applied: %#v", created)
	}
	if len(importer.validated) != 3 || len(importer.imported) != 2 {
		t.Fatalf("unexpected importer calls: validated=%#v imported=%#v", importer.validated, importer.imported)
	}
	if created.ContextImport == nil || !created.ContextImport.ManifestFound || created.ContextImport.Requested != 2 || created.ContextImport.Imported != 1 || len(created.ContextImport.Failures) != 1 {
		t.Fatalf("unexpected context summary: %#v", created.ContextImport)
	}
}

func TestCreateFromGitKeepsFallbackWithoutManifest(t *testing.T) {
	root := t.TempDir()
	repository := &fakeProjectRepository{}
	service := NewService(repository, fakeStoreManager{path: root})

	created, err := service.CreateFromGit(context.Background(), CreateFromGitInput{
		Name: "Fallback", URL: "git@example.com:team/store.git",
	})
	if err != nil || created.Name != "Fallback" || created.ContextImport != nil {
		t.Fatalf("fallback project: %#v err=%v", created, err)
	}
	_, err = service.CreateFromGit(context.Background(), CreateFromGitInput{URL: "git@example.com:team/store.git"})
	if !errors.Is(err, ErrInvalidName) {
		t.Fatalf("expected fallback name error, got %v", err)
	}
}

func TestCreateFromGitValidatesManifestBeforeProjectCreation(t *testing.T) {
	t.Run("invalid yaml", func(t *testing.T) {
		root := t.TempDir()
		writeContextManifest(t, root, "name: [invalid\n")
		repository := &fakeProjectRepository{}
		service := NewService(repository, fakeStoreManager{path: root})
		_, err := service.CreateFromGit(context.Background(), CreateFromGitInput{Name: "Fallback", URL: "git@example.com:team/store.git"})
		if !errors.Is(err, ErrInvalidContextManifest) || len(repository.created) != 0 {
			t.Fatalf("expected manifest error before create, created=%#v err=%v", repository.created, err)
		}
	})

	t.Run("invalid repository url", func(t *testing.T) {
		root := t.TempDir()
		writeContextManifest(t, root, "name: demo\ncontext:\n  repositories: [invalid]\n")
		repository := &fakeProjectRepository{}
		importer := &fakeContextImporter{validateErr: ErrInvalidContextRepositoryURL}
		service := NewService(repository, fakeStoreManager{path: root}).WithContextImporter(importer)
		_, err := service.CreateFromGit(context.Background(), CreateFromGitInput{URL: "git@example.com:team/store.git"})
		if !errors.Is(err, ErrInvalidContextRepositoryURL) || len(repository.created) != 0 {
			t.Fatalf("expected URL error before create, created=%#v err=%v", repository.created, err)
		}
	})
}

func TestReadContextManifestRejectsParentSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	external := t.TempDir()
	if err := os.WriteFile(filepath.Join(external, "context.yaml"), []byte("name: demo\ncontext:\n  repositories: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(root, ".openspec")); err != nil {
		t.Fatal(err)
	}
	_, found, err := ReadContextManifest(root)
	if !found || !errors.Is(err, ErrInvalidContextManifest) {
		t.Fatalf("expected parent symlink rejection, found=%v err=%v", found, err)
	}
}
