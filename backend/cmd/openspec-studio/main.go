package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	aiservice "github.com/sorface/openspec-studio/backend/internal/ai"
	"github.com/sorface/openspec-studio/backend/internal/config"
	"github.com/sorface/openspec-studio/backend/internal/httpapi"
	"github.com/sorface/openspec-studio/backend/internal/platform/browser"
	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/repository"
	"github.com/sorface/openspec-studio/backend/internal/storage"
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

	server := httpapi.New(httpapi.Options{
		Address:      cfg.Address,
		Projects:     project.NewService(store),
		Repositories: repository.NewService(store, supervisor),
		AIOperations: aiservice.NewService(store, supervisor, cfg.DataDir),
		Static:       web.Handler(),
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
