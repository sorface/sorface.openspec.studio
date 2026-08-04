package openspec

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/sorface/openspec-studio/backend/internal/operation"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

var (
	ErrDraftConflict       = errors.New("openspec draft conflict")
	ErrInvalidDraft        = errors.New("invalid openspec draft")
	ErrDraftAlreadyWritten = errors.New("openspec draft already written")
)

type DraftStore interface {
	Get(context.Context, string) (project.Project, error)
	GetOperation(context.Context, string) (operation.Operation, error)
	UpdateOperation(context.Context, operation.Operation) (operation.Operation, error)
	CreateDraftSet(context.Context, operation.DraftSet) (operation.DraftSet, error)
	GetDraftSet(context.Context, string) (operation.DraftSet, error)
	UpdateDraftSetStatus(context.Context, string, operation.DraftSetStatus) (operation.DraftSet, error)
}

type DraftService struct {
	store   DraftStore
	dataDir string
}

func NewDraftService(store DraftStore, dataDir string) *DraftService {
	return &DraftService{store: store, dataDir: dataDir}
}

func (service *DraftService) Accept(
	ctx context.Context,
	projectID string,
	operationID string,
) (operation.DraftSet, error) {
	item, err := service.store.GetOperation(ctx, operationID)
	if err != nil {
		return operation.DraftSet{}, err
	}
	if item.ProjectID != projectID || item.Kind != operation.KindOpenSpec {
		return operation.DraftSet{}, project.ErrNotFound
	}
	if item.Status != operation.StatusAwaitingReview {
		return operation.DraftSet{}, ErrInvalidDraft
	}
	var result ActionResult
	if err := jsonUnmarshalActionResult(item.ResultJSON, &result); err != nil {
		return operation.DraftSet{}, ErrInvalidDraft
	}
	mutations := make([]operation.DraftMutation, 0, len(result.Files))
	for _, file := range result.Files {
		if !validDraftMutation(file) {
			return operation.DraftSet{}, ErrInvalidDraft
		}
		mutations = append(mutations, operation.DraftMutation{
			Type: file.Type, Path: file.Path, PreviousPath: file.PreviousPath,
			Before: file.Before, After: file.After,
		})
	}
	set, err := service.store.CreateDraftSet(ctx, operation.DraftSet{
		ProjectID: projectID, OperationID: operationID, Status: operation.DraftAccepted,
		Mutations: mutations,
	})
	if err != nil {
		return operation.DraftSet{}, err
	}
	item.Status = operation.StatusAccepted
	if _, err := service.store.UpdateOperation(ctx, item); err != nil {
		return operation.DraftSet{}, err
	}
	return set, nil
}

func (service *DraftService) Reject(
	ctx context.Context,
	projectID string,
	operationID string,
) (operation.Operation, error) {
	item, err := service.store.GetOperation(ctx, operationID)
	if err != nil {
		return operation.Operation{}, err
	}
	if item.ProjectID != projectID || item.Kind != operation.KindOpenSpec {
		return operation.Operation{}, project.ErrNotFound
	}
	if item.Status != operation.StatusAwaitingReview {
		return operation.Operation{}, ErrInvalidDraft
	}
	item.Status = operation.StatusRejected
	return service.store.UpdateOperation(ctx, item)
}

func (service *DraftService) Get(
	ctx context.Context,
	projectID string,
	draftID string,
) (operation.DraftSet, error) {
	set, err := service.store.GetDraftSet(ctx, draftID)
	if err != nil {
		return operation.DraftSet{}, err
	}
	if set.ProjectID != projectID {
		return operation.DraftSet{}, project.ErrNotFound
	}
	return set, nil
}

func (service *DraftService) Write(
	ctx context.Context,
	projectID string,
	draftID string,
) (operation.DraftSet, error) {
	set, err := service.Get(ctx, projectID, draftID)
	if err != nil {
		return operation.DraftSet{}, err
	}
	if set.Status == operation.DraftWritten {
		return operation.DraftSet{}, ErrDraftAlreadyWritten
	}
	operationItem, err := service.store.GetOperation(ctx, set.OperationID)
	if err != nil {
		return operation.DraftSet{}, err
	}
	var execution actionExecution
	_ = json.Unmarshal([]byte(operationItem.InputJSON), &execution)
	storePath := strings.TrimSpace(execution.StorePath)
	if storePath == "" {
		projectItem, projectErr := service.store.Get(ctx, projectID)
		if projectErr != nil {
			return operation.DraftSet{}, projectErr
		}
		storePath = projectItem.StorePath
	}
	root, err := filepath.EvalSymlinks(storePath)
	if err != nil {
		return operation.DraftSet{}, err
	}
	resolved := make([]resolvedDraftMutation, 0, len(set.Mutations))
	for _, mutation := range set.Mutations {
		item, resolveErr := resolveDraftMutation(root, mutation)
		if resolveErr != nil {
			return operation.DraftSet{}, resolveErr
		}
		resolved = append(resolved, item)
	}
	if err := validateDraftState(resolved); err != nil {
		return operation.DraftSet{}, err
	}
	if err := applyDraftMutations(root, resolved); err != nil {
		return operation.DraftSet{}, err
	}
	return service.store.UpdateDraftSetStatus(ctx, draftID, operation.DraftWritten)
}

type resolvedDraftMutation struct {
	operation.DraftMutation
	absolute         string
	previousAbsolute string
}

func resolveDraftMutation(root string, mutation operation.DraftMutation) (resolvedDraftMutation, error) {
	if !validRelativeOpenSpecPath(mutation.Path) ||
		(mutation.PreviousPath != "" && !validRelativeOpenSpecPath(mutation.PreviousPath)) {
		return resolvedDraftMutation{}, ErrInvalidDraft
	}
	absolute := filepath.Join(root, filepath.FromSlash(mutation.Path))
	previous := ""
	if mutation.PreviousPath != "" {
		previous = filepath.Join(root, filepath.FromSlash(mutation.PreviousPath))
	}
	for _, path := range []string{absolute, previous} {
		if path == "" {
			continue
		}
		if err := rejectSymlinkComponents(root, path); err != nil {
			return resolvedDraftMutation{}, err
		}
	}
	return resolvedDraftMutation{DraftMutation: mutation, absolute: absolute, previousAbsolute: previous}, nil
}

func validateDraftState(mutations []resolvedDraftMutation) error {
	targets := map[string]bool{}
	for _, mutation := range mutations {
		if targets[mutation.absolute] {
			return ErrInvalidDraft
		}
		targets[mutation.absolute] = true
		switch mutation.Type {
		case "create":
			if _, err := os.Lstat(mutation.absolute); !errors.Is(err, os.ErrNotExist) {
				return ErrDraftConflict
			}
		case "update", "delete":
			content, err := os.ReadFile(mutation.absolute)
			if err != nil || string(content) != mutation.Before {
				return ErrDraftConflict
			}
		case "rename":
			if mutation.previousAbsolute == "" {
				return ErrInvalidDraft
			}
			content, err := os.ReadFile(mutation.previousAbsolute)
			if err != nil || string(content) != mutation.Before {
				return ErrDraftConflict
			}
			if _, err := os.Lstat(mutation.absolute); !errors.Is(err, os.ErrNotExist) {
				return ErrDraftConflict
			}
		default:
			return ErrInvalidDraft
		}
	}
	return nil
}

func applyDraftMutations(root string, mutations []resolvedDraftMutation) error {
	type original struct {
		path    string
		content []byte
		exists  bool
	}
	originals := map[string]original{}
	record := func(path string) error {
		if path == "" {
			return nil
		}
		if _, ok := originals[path]; ok {
			return nil
		}
		content, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			originals[path] = original{path: path}
			return nil
		}
		if err != nil {
			return err
		}
		originals[path] = original{path: path, content: content, exists: true}
		return nil
	}
	for _, mutation := range mutations {
		if err := record(mutation.absolute); err != nil {
			return err
		}
		if err := record(mutation.previousAbsolute); err != nil {
			return err
		}
	}
	rollback := func() {
		for _, item := range originals {
			if item.exists {
				_ = atomicWriteFile(item.path, item.content)
			} else {
				_ = os.Remove(item.path)
			}
		}
	}
	for _, mutation := range mutations {
		var err error
		switch mutation.Type {
		case "create", "update":
			err = atomicWriteFile(mutation.absolute, []byte(mutation.After))
		case "delete":
			err = os.Remove(mutation.absolute)
		case "rename":
			err = os.MkdirAll(filepath.Dir(mutation.absolute), 0o700)
			if err == nil {
				err = os.Rename(mutation.previousAbsolute, mutation.absolute)
			}
		}
		if err != nil {
			rollback()
			return err
		}
	}
	if err := removeEmptyDraftDirectories(root, mutations); err != nil {
		rollback()
		return err
	}
	return nil
}

func removeEmptyDraftDirectories(root string, mutations []resolvedDraftMutation) error {
	for _, mutation := range mutations {
		var source string
		switch mutation.Type {
		case "delete":
			source = mutation.absolute
		case "rename":
			source = mutation.previousAbsolute
		default:
			continue
		}
		if err := removeEmptyDraftParents(root, filepath.Dir(source)); err != nil {
			return err
		}
	}
	return nil
}

func removeEmptyDraftParents(root, directory string) error {
	relative, err := filepath.Rel(root, directory)
	if err != nil || relative == ".." || filepath.IsAbs(relative) {
		return ErrInvalidDraft
	}
	parts := strings.Split(filepath.Clean(relative), string(filepath.Separator))
	if len(parts) == 0 || parts[0] != "openspec" {
		return ErrInvalidDraft
	}
	stop := filepath.Join(root, "openspec")
	if len(parts) > 1 && (parts[1] == "changes" || parts[1] == "specs") {
		stop = filepath.Join(stop, parts[1])
	}
	for current := directory; current != stop; current = filepath.Dir(current) {
		err := os.Remove(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			entries, readErr := os.ReadDir(current)
			if readErr == nil && len(entries) > 0 {
				return nil
			}
			return err
		}
	}
	return nil
}

func atomicWriteFile(path string, content []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".osstudio-draft-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(content); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func rejectSymlinkComponents(root, path string) error {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || filepath.IsAbs(relative) {
		return ErrInvalidDraft
	}
	current := root
	parts := strings.Split(filepath.Clean(relative), string(filepath.Separator))
	for _, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return ErrInvalidDraft
		}
	}
	return nil
}

func validRelativeOpenSpecPath(value string) bool {
	if value == "" || filepath.IsAbs(value) || strings.ContainsRune(value, '\x00') {
		return false
	}
	clean := filepath.ToSlash(filepath.Clean(value))
	return clean != ".." && !strings.HasPrefix(clean, "../") &&
		(clean == "openspec" || strings.HasPrefix(clean, "openspec/"))
}

func validDraftMutation(mutation FileMutation) bool {
	if !validRelativeOpenSpecPath(mutation.Path) {
		return false
	}
	switch mutation.Type {
	case "create":
		return mutation.PreviousPath == ""
	case "update", "delete":
		return mutation.PreviousPath == ""
	case "rename":
		return validRelativeOpenSpecPath(mutation.PreviousPath)
	default:
		return false
	}
}

func jsonUnmarshalActionResult(value string, target *ActionResult) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%w: empty result", ErrInvalidDraft)
	}
	return json.Unmarshal([]byte(value), target)
}
