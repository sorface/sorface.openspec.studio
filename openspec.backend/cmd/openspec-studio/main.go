package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"

	aiservice "github.com/sorface/openspec-studio/backend/internal/ai"
	"github.com/sorface/openspec-studio/backend/internal/config"
	"github.com/sorface/openspec-studio/backend/internal/document"
	"github.com/sorface/openspec-studio/backend/internal/gitstatus"
	"github.com/sorface/openspec-studio/backend/internal/httpapi"
	openspecworkflow "github.com/sorface/openspec-studio/backend/internal/openspec"
	"github.com/sorface/openspec-studio/backend/internal/platform/browser"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/repository"
	"github.com/sorface/openspec-studio/backend/internal/storage"
	"github.com/sorface/openspec-studio/backend/internal/storegit"
	"github.com/sorface/openspec-studio/backend/internal/taskcontext"
	"github.com/sorface/openspec-studio/backend/internal/web"
)

func main() {
	if err := run(); err != nil {
		slog.Error("OpenSpec Studio stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Parse()
	if err != nil {
		return err
	}

	store, err := storage.Open(filepath.Join(cfg.DataDir, "openspec-studio.db"))
	if err != nil {
		return err
	}
	defer store.Close()
	if _, err := store.RecoverInterrupted(context.Background()); err != nil {
		return err
	}
	supervisor := processrunner.NewSupervisor()
	defer supervisor.Close()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	projectsRoot := filepath.Join(cfg.DataDir, "projects")
	storeService := storegit.NewService(projectsRoot)
	repositoryService := repository.NewService(store, supervisor, projectsRoot)
	projectService := project.NewService(store, storeService).WithContextImporter(repositoryService)
	gitStatusService := gitstatus.NewService(projectService, storeService)
	storeGitManager := storegit.NewManager(store, supervisor, storeService, gitStatusService)
	taskContextManager := taskcontext.NewManager(store, filepath.Join(cfg.DataDir, "task-worktrees"))
	publicationPreviews := filepath.Join(cfg.DataDir, "publication-previews")
	if err := os.MkdirAll(publicationPreviews, 0o700); err != nil {
		return err
	}
	publicationService := taskcontext.NewPublicationService(
		store, storeGitManager, aiservice.NewCommitMessageGenerator(cfg.DataDir), publicationPreviews,
	)
	openSpecExecutable, _ := exec.LookPath("openspec")
	if openSpecExecutable != "" && !filepath.IsAbs(openSpecExecutable) {
		openSpecExecutable, _ = filepath.Abs(openSpecExecutable)
	}
	openSpecCLI := openspecworkflow.NewCLI(openSpecExecutable, nil)
	openSpecService := openspecworkflow.NewService(projectService, openSpecCLI)
	server := httpapi.New(httpapi.Options{
		Address:          cfg.Address,
		Projects:         projectService,
		Documents:        document.NewService(projectService),
		Repositories:     repositoryService,
		GitStatus:        gitStatusService,
		StoreGit:         storeGitManager,
		TaskContext:      taskContextManager,
		Publication:      publicationService,
		AIOperations:     aiservice.NewService(store, supervisor, cfg.DataDir),
		OpenSpec:         openSpecService,
		OpenSpecActions:  openspecworkflow.NewActionService(store, openSpecService, openSpecCLI, supervisor, cfg.DataDir),
		OpenSpecDrafts:   openspecworkflow.NewDraftService(store, cfg.DataDir),
		OpenSpecCreation: openspecworkflow.NewCreationDraftService(store),
		Static:           web.Handler(),
	})
	serverURL, err := server.Listen(ctx)
	if err != nil {
		return err
	}

	fmt.Printf("OpenSpec Studio: %s\n", serverURL)
	if !cfg.NoBrowser {
		if err := browser.Open(serverURL); err != nil {
			slog.Warn("browser was not opened automatically", "error", err)
		}
	}

	<-ctx.Done()
	return nil
}
