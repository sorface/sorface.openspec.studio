package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/project"
	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	store_path TEXT NOT NULL,
	active_worktree_id TEXT,
	default_ai_provider TEXT,
	default_model TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_updated_at_idx ON projects(updated_at DESC);
`

type SQLite struct {
	db *sql.DB
}

func Open(path string) (*SQLite, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)

	if _, err = db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &SQLite{db: db}, nil
}

func (store *SQLite) Close() error {
	return store.db.Close()
}

func (store *SQLite) List(ctx context.Context) ([]project.Project, error) {
	rows, err := store.db.QueryContext(ctx, `
		SELECT id, name, store_path, active_worktree_id, default_ai_provider,
		       default_model, created_at, updated_at
		FROM projects ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projects := make([]project.Project, 0)
	for rows.Next() {
		item, scanErr := scanProject(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		projects = append(projects, item)
	}
	return projects, rows.Err()
}

func (store *SQLite) Get(ctx context.Context, id string) (project.Project, error) {
	row := store.db.QueryRowContext(ctx, `
		SELECT id, name, store_path, active_worktree_id, default_ai_provider,
		       default_model, created_at, updated_at
		FROM projects WHERE id = ?`, id)
	item, err := scanProject(row)
	if errors.Is(err, sql.ErrNoRows) {
		return project.Project{}, project.ErrNotFound
	}
	return item, err
}

func (store *SQLite) Create(ctx context.Context, input project.CreateInput) (project.Project, error) {
	now := time.Now().UTC()
	item := project.Project{
		ID:        newID(),
		Name:      input.Name,
		StorePath: input.StorePath,
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := store.db.ExecContext(ctx, `
		INSERT INTO projects (id, name, store_path, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)`,
		item.ID, item.Name, item.StorePath, formatTime(now), formatTime(now))
	return item, err
}

func (store *SQLite) Update(ctx context.Context, id string, input project.UpdateInput) (project.Project, error) {
	current, err := store.Get(ctx, id)
	if err != nil {
		return project.Project{}, err
	}
	if input.Name != nil {
		current.Name = *input.Name
	}
	if input.DefaultProvider != nil {
		current.DefaultProvider = input.DefaultProvider
	}
	if input.DefaultModel != nil {
		current.DefaultModel = input.DefaultModel
	}
	current.UpdatedAt = time.Now().UTC()

	result, err := store.db.ExecContext(ctx, `
		UPDATE projects
		SET name = ?, default_ai_provider = ?, default_model = ?, updated_at = ?
		WHERE id = ?`,
		current.Name, current.DefaultProvider, current.DefaultModel,
		formatTime(current.UpdatedAt), id)
	if err != nil {
		return project.Project{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return project.Project{}, err
	}
	if affected == 0 {
		return project.Project{}, project.ErrNotFound
	}
	return current, nil
}

func (store *SQLite) Delete(ctx context.Context, id string) error {
	result, err := store.db.ExecContext(ctx, "DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return project.ErrNotFound
	}
	return nil
}

type scanner interface {
	Scan(...any) error
}

func scanProject(source scanner) (project.Project, error) {
	var item project.Project
	var createdAt, updatedAt string
	err := source.Scan(
		&item.ID, &item.Name, &item.StorePath, &item.ActiveWorktreeID,
		&item.DefaultProvider, &item.DefaultModel, &createdAt, &updatedAt,
	)
	if err != nil {
		return project.Project{}, err
	}
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return project.Project{}, err
	}
	item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	return item, err
}

func formatTime(value time.Time) string {
	return value.Format(time.RFC3339Nano)
}

func newID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic("crypto/rand is unavailable")
	}
	return hex.EncodeToString(bytes)
}
