package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	"github.com/sorface/openspec-studio/backend/internal/project"
	"github.com/sorface/openspec-studio/backend/internal/taskcontext"
	_ "modernc.org/sqlite"
)

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	applied_at TEXT NOT NULL
);
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
CREATE TABLE IF NOT EXISTS task_workspaces (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	branch TEXT NOT NULL,
	path TEXT NOT NULL UNIQUE,
	managed INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(project_id, branch)
);
CREATE INDEX IF NOT EXISTS task_workspaces_project_idx
	ON task_workspaces(project_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS repositories (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	path TEXT NOT NULL UNIQUE,
	remote_url TEXT NOT NULL,
	fingerprint TEXT NOT NULL,
	branch TEXT NOT NULL DEFAULT '',
	commit_sha TEXT NOT NULL,
	dirty INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS repositories_project_idx ON repositories(project_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS operations (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	status TEXT NOT NULL,
	provider TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	prompt TEXT NOT NULL DEFAULT '',
	input_json TEXT NOT NULL DEFAULT '{}',
	result_json TEXT NOT NULL DEFAULT '',
	error_code TEXT NOT NULL DEFAULT '',
	error_message TEXT NOT NULL DEFAULT '',
	correlation_id TEXT NOT NULL DEFAULT '',
	openspec_action TEXT NOT NULL DEFAULT '',
	openspec_change TEXT NOT NULL DEFAULT '',
	openspec_schema TEXT NOT NULL DEFAULT '',
	openspec_artifact TEXT NOT NULL DEFAULT '',
	openspec_fingerprint TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operations_project_idx ON operations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operations_active_idx ON operations(project_id, kind, status);
CREATE TABLE IF NOT EXISTS operation_events (
	sequence INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
	type TEXT NOT NULL,
	payload TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_events_operation_idx ON operation_events(operation_id, sequence);
CREATE TABLE IF NOT EXISTS ai_context_entries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
	source TEXT NOT NULL,
	path TEXT NOT NULL,
	size INTEGER NOT NULL,
	checksum TEXT NOT NULL,
	reason TEXT NOT NULL,
	included INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS operation_audit (
	operation_id TEXT PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE,
	executable TEXT NOT NULL,
	arguments TEXT NOT NULL,
	exit_code INTEGER NOT NULL,
	stop_reason TEXT NOT NULL DEFAULT '',
	stdout_bytes INTEGER NOT NULL,
	stderr_bytes INTEGER NOT NULL,
	duration_ms INTEGER NOT NULL,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS draft_sets (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS draft_mutations (
	id TEXT PRIMARY KEY,
	set_id TEXT NOT NULL REFERENCES draft_sets(id) ON DELETE CASCADE,
	type TEXT NOT NULL,
	path TEXT NOT NULL,
	previous_path TEXT NOT NULL DEFAULT '',
	before_content TEXT NOT NULL DEFAULT '',
	after_content TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS draft_mutations_set_idx ON draft_mutations(set_id);
CREATE TABLE IF NOT EXISTS openspec_change_drafts (
	project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
	payload_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
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
	if err = ensureOperationMetadataColumns(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate operation metadata: %w", err)
	}
	return &SQLite{db: db}, nil
}

func ensureOperationMetadataColumns(db *sql.DB) error {
	columns := []struct {
		name       string
		definition string
	}{
		{"openspec_action", "TEXT NOT NULL DEFAULT ''"},
		{"openspec_change", "TEXT NOT NULL DEFAULT ''"},
		{"openspec_schema", "TEXT NOT NULL DEFAULT ''"},
		{"openspec_artifact", "TEXT NOT NULL DEFAULT ''"},
		{"openspec_fingerprint", "TEXT NOT NULL DEFAULT ''"},
	}
	existing := map[string]bool{}
	rows, err := db.Query("PRAGMA table_info(operations)")
	if err != nil {
		return err
	}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, dataType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		existing[name] = true
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, column := range columns {
		if existing[column.name] {
			continue
		}
		if _, err := db.Exec("ALTER TABLE operations ADD COLUMN " + column.name + " " + column.definition); err != nil {
			return err
		}
	}
	_, err = db.Exec(`
		INSERT OR IGNORE INTO schema_migrations(version, applied_at)
		VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	return err
}

func (store *SQLite) Close() error {
	return store.db.Close()
}

func (store *SQLite) List(ctx context.Context) ([]project.Project, error) {
	rows, err := store.db.QueryContext(ctx, `
		SELECT p.id, p.name, COALESCE(w.path, p.store_path), p.store_path,
		       p.active_worktree_id, COALESCE(w.branch, ''), p.default_ai_provider,
		       p.default_model, p.created_at, p.updated_at
		FROM projects p
		LEFT JOIN task_workspaces w ON w.id = p.active_worktree_id AND w.project_id = p.id
		ORDER BY p.updated_at DESC`)
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
		SELECT p.id, p.name, COALESCE(w.path, p.store_path), p.store_path,
		       p.active_worktree_id, COALESCE(w.branch, ''), p.default_ai_provider,
		       p.default_model, p.created_at, p.updated_at
		FROM projects p
		LEFT JOIN task_workspaces w ON w.id = p.active_worktree_id AND w.project_id = p.id
		WHERE p.id = ?`, id)
	item, err := scanProject(row)
	if errors.Is(err, sql.ErrNoRows) {
		return project.Project{}, project.ErrNotFound
	}
	return item, err
}

func (store *SQLite) GetBaseProject(ctx context.Context, id string) (project.Project, error) {
	row := store.db.QueryRowContext(ctx, `
		SELECT id, name, store_path, store_path, active_worktree_id, '',
		       default_ai_provider, default_model, created_at, updated_at
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
		ID:            newID(),
		Name:          input.Name,
		StorePath:     input.StorePath,
		BaseStorePath: input.StorePath,
		CreatedAt:     now,
		UpdatedAt:     now,
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
		&item.ID, &item.Name, &item.StorePath, &item.BaseStorePath,
		&item.ActiveWorktreeID, &item.ActiveTask, &item.DefaultProvider,
		&item.DefaultModel, &createdAt, &updatedAt,
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

func (store *SQLite) CreateTaskWorkspace(ctx context.Context, item taskcontext.Workspace) (taskcontext.Workspace, error) {
	now := time.Now().UTC()
	if item.ID == "" {
		item.ID = newID()
	}
	item.CreatedAt, item.UpdatedAt = now, now
	_, err := store.db.ExecContext(ctx, `
		INSERT INTO task_workspaces (id, project_id, branch, path, managed, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.ProjectID, item.Branch, item.Path, boolInt(item.Managed), formatTime(now), formatTime(now))
	return item, err
}

func (store *SQLite) ListTaskWorkspaces(ctx context.Context, projectID string) ([]taskcontext.Workspace, error) {
	rows, err := store.db.QueryContext(ctx, `
		SELECT w.id, w.project_id, w.branch, w.path, w.managed,
		       w.id = p.active_worktree_id, w.created_at, w.updated_at
		FROM task_workspaces w
		JOIN projects p ON p.id = w.project_id
		WHERE w.project_id = ?
		ORDER BY (w.id = p.active_worktree_id) DESC, w.updated_at DESC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]taskcontext.Workspace, 0)
	for rows.Next() {
		item, scanErr := scanTaskWorkspace(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *SQLite) GetTaskWorkspace(ctx context.Context, projectID, id string) (taskcontext.Workspace, error) {
	row := store.db.QueryRowContext(ctx, `
		SELECT w.id, w.project_id, w.branch, w.path, w.managed,
		       w.id = p.active_worktree_id, w.created_at, w.updated_at
		FROM task_workspaces w
		JOIN projects p ON p.id = w.project_id
		WHERE w.project_id = ? AND w.id = ?`, projectID, id)
	item, err := scanTaskWorkspace(row)
	if errors.Is(err, sql.ErrNoRows) {
		return taskcontext.Workspace{}, taskcontext.ErrWorkspaceNotFound
	}
	return item, err
}

func (store *SQLite) GetTaskWorkspaceByBranch(ctx context.Context, projectID, branch string) (taskcontext.Workspace, error) {
	row := store.db.QueryRowContext(ctx, `
		SELECT w.id, w.project_id, w.branch, w.path, w.managed,
		       w.id = p.active_worktree_id, w.created_at, w.updated_at
		FROM task_workspaces w
		JOIN projects p ON p.id = w.project_id
		WHERE w.project_id = ? AND w.branch = ?`, projectID, branch)
	item, err := scanTaskWorkspace(row)
	if errors.Is(err, sql.ErrNoRows) {
		return taskcontext.Workspace{}, taskcontext.ErrWorkspaceNotFound
	}
	return item, err
}

func (store *SQLite) SetActiveTaskWorkspace(ctx context.Context, projectID, id string) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM task_workspaces WHERE id = ? AND project_id = ?", id, projectID,
	).Scan(&exists); err != nil {
		return err
	}
	if exists != 1 {
		return taskcontext.ErrWorkspaceNotFound
	}
	now := formatTime(time.Now().UTC())
	result, err := tx.ExecContext(ctx,
		"UPDATE projects SET active_worktree_id = ?, updated_at = ? WHERE id = ?", id, now, projectID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return project.ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, "UPDATE task_workspaces SET updated_at = ? WHERE id = ?", now, id); err != nil {
		return err
	}
	return tx.Commit()
}

func scanTaskWorkspace(source scanner) (taskcontext.Workspace, error) {
	var item taskcontext.Workspace
	var managed, active int
	var createdAt, updatedAt string
	err := source.Scan(
		&item.ID, &item.ProjectID, &item.Branch, &item.Path, &managed,
		&active, &createdAt, &updatedAt,
	)
	if err != nil {
		return taskcontext.Workspace{}, err
	}
	item.Managed, item.Active = managed != 0, active != 0
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return taskcontext.Workspace{}, err
	}
	item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	return item, err
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
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

func (store *SQLite) CreateOperation(ctx context.Context, item operation.Operation) (operation.Operation, error) {
	now := time.Now().UTC()
	if item.ID == "" {
		item.ID = newID()
	}
	if item.Status == "" {
		item.Status = operation.StatusQueued
	}
	item.CreatedAt, item.UpdatedAt = now, now
	_, err := store.db.ExecContext(ctx, `
		INSERT INTO operations
		(id, project_id, kind, status, provider, model, prompt, input_json,
		 result_json, error_code, error_message, correlation_id, openspec_action,
		 openspec_change, openspec_schema, openspec_artifact, openspec_fingerprint,
		 created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.ProjectID, item.Kind, item.Status, item.Provider, item.Model,
		item.Prompt, item.InputJSON, item.ResultJSON, item.ErrorCode, item.ErrorMessage,
		item.CorrelationID, item.OpenSpecAction, item.OpenSpecChange, item.OpenSpecSchema,
		item.OpenSpecArtifact, item.OpenSpecFingerprint, formatTime(now), formatTime(now))
	return item, err
}

func (store *SQLite) GetOperation(ctx context.Context, id string) (operation.Operation, error) {
	row := store.db.QueryRowContext(ctx, `
		SELECT id, project_id, kind, status, provider, model, prompt, input_json,
		       result_json, error_code, error_message, correlation_id, openspec_action,
		       openspec_change, openspec_schema, openspec_artifact, openspec_fingerprint,
		       created_at, updated_at
		FROM operations WHERE id = ?`, id)
	return scanOperation(row)
}

func (store *SQLite) ListOpenSpecOperations(
	ctx context.Context,
	projectID string,
	change string,
	limit int,
) ([]operation.Operation, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := store.db.QueryContext(ctx, `
		SELECT id, project_id, kind, status, provider, model, prompt, input_json,
		       result_json, error_code, error_message, correlation_id, openspec_action,
		       openspec_change, openspec_schema, openspec_artifact, openspec_fingerprint,
		       created_at, updated_at
		FROM operations
		WHERE project_id = ? AND kind = ? AND openspec_change = ?
		ORDER BY created_at DESC
		LIMIT ?`, projectID, operation.KindOpenSpec, change, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]operation.Operation, 0)
	for rows.Next() {
		item, scanErr := scanOperation(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *SQLite) UpdateOperation(ctx context.Context, item operation.Operation) (operation.Operation, error) {
	current, err := store.GetOperation(ctx, item.ID)
	if err != nil {
		return operation.Operation{}, err
	}
	if !operation.CanTransition(current.Status, item.Status) {
		return operation.Operation{}, operation.ErrInvalidTransition
	}
	item.CreatedAt = current.CreatedAt
	item.UpdatedAt = time.Now().UTC()
	_, err = store.db.ExecContext(ctx, `
		UPDATE operations SET status=?, provider=?, model=?, prompt=?, input_json=?,
		result_json=?, error_code=?, error_message=?, correlation_id=?,
		openspec_action=?, openspec_change=?, openspec_schema=?, openspec_artifact=?,
		openspec_fingerprint=?, updated_at=?
		WHERE id=?`,
		item.Status, item.Provider, item.Model, item.Prompt, item.InputJSON,
		item.ResultJSON, item.ErrorCode, item.ErrorMessage, item.CorrelationID,
		item.OpenSpecAction, item.OpenSpecChange, item.OpenSpecSchema, item.OpenSpecArtifact,
		item.OpenSpecFingerprint, formatTime(item.UpdatedAt), item.ID)
	return item, err
}

func (store *SQLite) HasActiveOperation(ctx context.Context, projectID string, kind operation.Kind) (bool, error) {
	var count int
	err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM operations
		WHERE project_id=? AND kind=? AND status IN ('queued','running','validating')`,
		projectID, kind).Scan(&count)
	return count > 0, err
}

func (store *SQLite) AddEvent(ctx context.Context, event operation.Event) (operation.Event, error) {
	now := time.Now().UTC()
	result, err := store.db.ExecContext(ctx, `
		INSERT INTO operation_events(operation_id, type, payload, created_at)
		VALUES (?, ?, ?, ?)`, event.OperationID, event.Type, event.Payload, formatTime(now))
	if err != nil {
		return operation.Event{}, err
	}
	event.Sequence, err = result.LastInsertId()
	event.CreatedAt = now
	return event, err
}

func (store *SQLite) ListEvents(ctx context.Context, operationID string, after int64) ([]operation.Event, error) {
	rows, err := store.db.QueryContext(ctx, `
		SELECT sequence, operation_id, type, payload, created_at
		FROM operation_events WHERE operation_id=? AND sequence>? ORDER BY sequence`,
		operationID, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]operation.Event, 0)
	for rows.Next() {
		var item operation.Event
		var created string
		if err := rows.Scan(&item.Sequence, &item.OperationID, &item.Type, &item.Payload, &created); err != nil {
			return nil, err
		}
		item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *SQLite) CreateRepository(ctx context.Context, item operation.RepositoryLink) (operation.RepositoryLink, error) {
	now := time.Now().UTC()
	if item.ID == "" {
		item.ID = newID()
	}
	item.CreatedAt, item.UpdatedAt = now, now
	item.ReadOnlyForAI, item.Available = true, true
	_, err := store.db.ExecContext(ctx, `
		INSERT INTO repositories
		(id, project_id, name, path, remote_url, fingerprint, branch, commit_sha,
		 dirty, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.ProjectID, item.Name, item.Path, item.RemoteURL,
		item.Fingerprint, item.Branch, item.CommitSHA, item.Dirty,
		formatTime(now), formatTime(now))
	return item, err
}

func (store *SQLite) UpdateRepository(ctx context.Context, item operation.RepositoryLink) (operation.RepositoryLink, error) {
	result, err := store.db.ExecContext(ctx, `
		UPDATE repositories
		SET fingerprint=?, branch=?, commit_sha=?, dirty=?
		WHERE id=? AND project_id=?`,
		item.Fingerprint, item.Branch, item.CommitSHA, item.Dirty, item.ID, item.ProjectID)
	if err != nil {
		return operation.RepositoryLink{}, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return operation.RepositoryLink{}, project.ErrNotFound
	}
	return item, nil
}

func (store *SQLite) ListRepositories(ctx context.Context, projectID string) ([]operation.RepositoryLink, error) {
	rows, err := store.db.QueryContext(ctx, `
		SELECT id, project_id, name, path, remote_url, fingerprint, branch,
		       commit_sha, dirty, created_at, updated_at
		FROM repositories WHERE project_id=? ORDER BY updated_at DESC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]operation.RepositoryLink, 0)
	for rows.Next() {
		var item operation.RepositoryLink
		var created, updated string
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Name, &item.Path,
			&item.RemoteURL, &item.Fingerprint, &item.Branch, &item.CommitSHA,
			&item.Dirty, &created, &updated); err != nil {
			return nil, err
		}
		item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
		if err != nil {
			return nil, err
		}
		item.ReadOnlyForAI, item.Available = true, true
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *SQLite) SaveContext(ctx context.Context, operationID string, entries []operation.ContextEntry) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, entry := range entries {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ai_context_entries
			(operation_id, source, path, size, checksum, reason, included)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, operationID, entry.Source, entry.Path,
			entry.Size, entry.Checksum, entry.Reason, entry.Included); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (store *SQLite) SaveAudit(ctx context.Context, audit operation.Audit) error {
	_, err := store.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO operation_audit
		(operation_id, executable, arguments, exit_code, stop_reason,
		 stdout_bytes, stderr_bytes, duration_ms, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		audit.OperationID, audit.Executable, audit.Arguments, audit.ExitCode,
		audit.StopReason, audit.StdoutBytes, audit.StderrBytes, audit.DurationMS,
		formatTime(time.Now().UTC()))
	return err
}

func (store *SQLite) GetAudit(ctx context.Context, operationID string) (operation.Audit, error) {
	var item operation.Audit
	var created string
	err := store.db.QueryRowContext(ctx, `
		SELECT operation_id, executable, arguments, exit_code, stop_reason,
		       stdout_bytes, stderr_bytes, duration_ms, created_at
		FROM operation_audit WHERE operation_id=?`, operationID).Scan(
		&item.OperationID, &item.Executable, &item.Arguments, &item.ExitCode,
		&item.StopReason, &item.StdoutBytes, &item.StderrBytes, &item.DurationMS, &created)
	if err != nil {
		return operation.Audit{}, err
	}
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	return item, err
}

func (store *SQLite) CreateDraftSet(ctx context.Context, item operation.DraftSet) (operation.DraftSet, error) {
	transaction, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return operation.DraftSet{}, err
	}
	defer transaction.Rollback()
	now := time.Now().UTC()
	if item.ID == "" {
		item.ID = newID()
	}
	if item.Status == "" {
		item.Status = operation.DraftAccepted
	}
	item.CreatedAt, item.UpdatedAt = now, now
	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO draft_sets(id, project_id, operation_id, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		item.ID, item.ProjectID, item.OperationID, item.Status, formatTime(now), formatTime(now)); err != nil {
		return operation.DraftSet{}, err
	}
	for index := range item.Mutations {
		if item.Mutations[index].ID == "" {
			item.Mutations[index].ID = newID()
		}
		item.Mutations[index].SetID = item.ID
		mutation := item.Mutations[index]
		if _, err := transaction.ExecContext(ctx, `
			INSERT INTO draft_mutations
			(id, set_id, type, path, previous_path, before_content, after_content)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			mutation.ID, mutation.SetID, mutation.Type, mutation.Path, mutation.PreviousPath,
			mutation.Before, mutation.After); err != nil {
			return operation.DraftSet{}, err
		}
	}
	if err := transaction.Commit(); err != nil {
		return operation.DraftSet{}, err
	}
	return item, nil
}

func (store *SQLite) GetDraftSet(ctx context.Context, id string) (operation.DraftSet, error) {
	var item operation.DraftSet
	var created, updated string
	err := store.db.QueryRowContext(ctx, `
		SELECT id, project_id, operation_id, status, created_at, updated_at
		FROM draft_sets WHERE id=?`, id).Scan(
		&item.ID, &item.ProjectID, &item.OperationID, &item.Status, &created, &updated,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return operation.DraftSet{}, project.ErrNotFound
	}
	if err != nil {
		return operation.DraftSet{}, err
	}
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return operation.DraftSet{}, err
	}
	item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	if err != nil {
		return operation.DraftSet{}, err
	}
	rows, err := store.db.QueryContext(ctx, `
		SELECT id, set_id, type, path, previous_path, before_content, after_content
		FROM draft_mutations WHERE set_id=? ORDER BY rowid`, id)
	if err != nil {
		return operation.DraftSet{}, err
	}
	defer rows.Close()
	item.Mutations = []operation.DraftMutation{}
	for rows.Next() {
		var mutation operation.DraftMutation
		if err := rows.Scan(
			&mutation.ID, &mutation.SetID, &mutation.Type, &mutation.Path,
			&mutation.PreviousPath, &mutation.Before, &mutation.After,
		); err != nil {
			return operation.DraftSet{}, err
		}
		item.Mutations = append(item.Mutations, mutation)
	}
	return item, rows.Err()
}

func (store *SQLite) UpdateDraftSetStatus(
	ctx context.Context,
	id string,
	status operation.DraftSetStatus,
) (operation.DraftSet, error) {
	result, err := store.db.ExecContext(ctx, `
		UPDATE draft_sets SET status=?, updated_at=? WHERE id=?`,
		status, formatTime(time.Now().UTC()), id)
	if err != nil {
		return operation.DraftSet{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return operation.DraftSet{}, err
	}
	if affected == 0 {
		return operation.DraftSet{}, project.ErrNotFound
	}
	return store.GetDraftSet(ctx, id)
}

func (store *SQLite) GetChangeCreationDraft(
	ctx context.Context,
	projectID string,
) (operation.ChangeCreationDraft, error) {
	var payload, created, updated string
	err := store.db.QueryRowContext(ctx, `
		SELECT payload_json, created_at, updated_at
		FROM openspec_change_drafts WHERE project_id=?`, projectID).Scan(&payload, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return operation.ChangeCreationDraft{}, operation.ErrChangeCreationDraftNotFound
	}
	if err != nil {
		return operation.ChangeCreationDraft{}, err
	}
	var item operation.ChangeCreationDraft
	if err := json.Unmarshal([]byte(payload), &item); err != nil {
		return operation.ChangeCreationDraft{}, err
	}
	item.ProjectID = projectID
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return operation.ChangeCreationDraft{}, err
	}
	item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	return item, err
}

func (store *SQLite) UpsertChangeCreationDraft(
	ctx context.Context,
	item operation.ChangeCreationDraft,
) (operation.ChangeCreationDraft, error) {
	now := time.Now().UTC()
	createdAt := item.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}
	item.CreatedAt = createdAt
	item.UpdatedAt = now
	payload, err := json.Marshal(item)
	if err != nil {
		return operation.ChangeCreationDraft{}, err
	}
	_, err = store.db.ExecContext(ctx, `
		INSERT INTO openspec_change_drafts(project_id, payload_json, created_at, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(project_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
		item.ProjectID, string(payload), formatTime(createdAt), formatTime(now))
	if err != nil {
		return operation.ChangeCreationDraft{}, err
	}
	return store.GetChangeCreationDraft(ctx, item.ProjectID)
}

func (store *SQLite) DeleteChangeCreationDraft(ctx context.Context, projectID string) error {
	result, err := store.db.ExecContext(ctx, "DELETE FROM openspec_change_drafts WHERE project_id=?", projectID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return operation.ErrChangeCreationDraftNotFound
	}
	return nil
}

func (store *SQLite) ListContext(ctx context.Context, operationID string) ([]operation.ContextEntry, error) {
	rows, err := store.db.QueryContext(ctx, `
		SELECT operation_id, source, path, size, checksum, reason, included
		FROM ai_context_entries WHERE operation_id=? ORDER BY id`, operationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]operation.ContextEntry, 0)
	for rows.Next() {
		var item operation.ContextEntry
		if err := rows.Scan(&item.OperationID, &item.Source, &item.Path, &item.Size,
			&item.Checksum, &item.Reason, &item.Included); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *SQLite) RecoverInterrupted(ctx context.Context) (int64, error) {
	now := formatTime(time.Now().UTC())
	result, err := store.db.ExecContext(ctx, `
		UPDATE operations SET status='failed', error_code='APPLICATION_RESTARTED',
		error_message='Приложение было перезапущено', updated_at=?
		WHERE status IN ('queued','running','validating')`, now)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func scanOperation(source scanner) (operation.Operation, error) {
	var item operation.Operation
	var created, updated string
	err := source.Scan(&item.ID, &item.ProjectID, &item.Kind, &item.Status,
		&item.Provider, &item.Model, &item.Prompt, &item.InputJSON, &item.ResultJSON,
		&item.ErrorCode, &item.ErrorMessage, &item.CorrelationID, &item.OpenSpecAction,
		&item.OpenSpecChange, &item.OpenSpecSchema, &item.OpenSpecArtifact,
		&item.OpenSpecFingerprint, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return operation.Operation{}, project.ErrNotFound
	}
	if err != nil {
		return operation.Operation{}, err
	}
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return operation.Operation{}, err
	}
	item.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	return item, err
}
