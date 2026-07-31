package openspec

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/sorface/openspec-studio/backend/internal/project"
)

type ProjectStore interface {
	Get(context.Context, string) (project.Project, error)
}

type Adapter interface {
	Capability(context.Context, string) Capability
	List(context.Context, string) (ListResult, error)
	Status(context.Context, string, string) (Status, error)
	Instructions(context.Context, string, string, string) (Instructions, error)
	Show(context.Context, string, string) (json.RawMessage, error)
	Validate(context.Context, string, string) (Validation, error)
}

type MutationAdapter interface {
	Adapter
	NewChange(context.Context, string, string) error
	Archive(context.Context, string, string) error
}

type Service struct {
	projects ProjectStore
	adapter  Adapter
	deleteMu sync.Mutex
}

func NewService(projects ProjectStore, adapter Adapter) *Service {
	return &Service{projects: projects, adapter: adapter}
}

func (service *Service) Overview(ctx context.Context, projectID string) (Overview, error) {
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return Overview{}, err
	}
	capability := service.adapter.Capability(ctx, item.StorePath)
	if !capability.Available {
		return Overview{Capability: capability, Changes: []ChangeSummary{}}, ErrToolUnavailable
	}
	if !capability.Supported {
		return Overview{Capability: capability, Changes: []ChangeSummary{}}, ErrVersionUnsupported
	}
	result, err := service.adapter.List(ctx, item.StorePath)
	if err != nil {
		return Overview{}, err
	}
	return Overview{Capability: capability, Changes: result.Changes}, nil
}

func (service *Service) Details(ctx context.Context, projectID, change string) (ChangeDetails, error) {
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return ChangeDetails{}, err
	}
	if err := service.ensureCapability(ctx, item.StorePath); err != nil {
		return ChangeDetails{}, err
	}
	list, err := service.adapter.List(ctx, item.StorePath)
	if err != nil {
		return ChangeDetails{}, err
	}
	var summary ChangeSummary
	found := false
	for _, candidate := range list.Changes {
		if candidate.Name == change {
			summary, found = candidate, true
			break
		}
	}
	if !found {
		return ChangeDetails{}, ErrInvalidChange
	}
	status, err := service.adapter.Status(ctx, item.StorePath, change)
	if err != nil {
		return ChangeDetails{}, err
	}
	actions := make([]Action, 0, len(status.Artifacts)+1)
	instructionValues := make([]Instructions, 0)
	for _, artifact := range status.Artifacts {
		action := Action{
			Kind:      "prepare_artifact",
			Artifact:  artifact.ID,
			Available: artifact.Status != "blocked",
		}
		if artifact.Status == "blocked" {
			action.Reason = "MISSING_DEPENDENCIES"
			actions = append(actions, action)
			continue
		}
		instructions, instructionErr := service.adapter.Instructions(ctx, item.StorePath, change, artifact.ID)
		if instructionErr != nil {
			action.Available = false
			action.Reason = "INSTRUCTIONS_UNAVAILABLE"
			actions = append(actions, action)
			continue
		}
		normalizeInstructionPaths(item.StorePath, &instructions)
		action.Instruction = &instructions
		action.OutputPaths = []string{instructions.ResolvedOutputPath}
		for _, dependency := range instructions.Dependencies {
			if dependency.Done && dependency.Path != "" {
				action.InputPaths = append(action.InputPaths, dependency.Path)
			}
		}
		instructionValues = append(instructionValues, instructions)
		actions = append(actions, action)
	}
	actions = append(actions, Action{
		Kind:      "archive",
		Available: status.IsComplete,
		Reason:    archiveReason(status.IsComplete),
	})
	deletion, treeHashes, _, err := changeSnapshot(item.StorePath, change)
	if err != nil {
		return ChangeDetails{}, err
	}
	fingerprint, err := actionFingerprint(item.StorePath, status, instructionValues, treeHashes)
	if err != nil {
		return ChangeDetails{}, err
	}
	return ChangeDetails{
		Summary: summary, Schema: status.SchemaName, Complete: status.IsComplete,
		Artifacts: status.Artifacts, Actions: actions, Fingerprint: fingerprint, Deletion: deletion,
	}, nil
}

func (service *Service) Delete(
	ctx context.Context,
	projectID, change string,
	input DeleteChangeInput,
) (DeleteChangeResult, error) {
	change = strings.TrimSpace(change)
	if !validChangeName(change) || change == "archive" || input.Confirmation != change {
		if input.Confirmation != change {
			return DeleteChangeResult{}, ErrDeleteConfirmation
		}
		return DeleteChangeResult{}, ErrInvalidChange
	}
	if input.StatusFingerprint == "" {
		return DeleteChangeResult{}, ErrStatusStale
	}

	service.deleteMu.Lock()
	defer service.deleteMu.Unlock()

	details, err := service.Details(ctx, projectID, change)
	if err != nil {
		return DeleteChangeResult{}, err
	}
	if details.Fingerprint != input.StatusFingerprint {
		return DeleteChangeResult{}, ErrStatusStale
	}
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return DeleteChangeResult{}, err
	}
	_, _, changeRoot, err := changeSnapshot(item.StorePath, change)
	if err != nil {
		return DeleteChangeResult{}, err
	}
	if err := os.RemoveAll(changeRoot); err != nil {
		return DeleteChangeResult{}, err
	}
	return DeleteChangeResult{
		Deleted: true, Change: change, DeletedFiles: details.Deletion.Files,
	}, nil
}

func (service *Service) Validate(ctx context.Context, projectID, change string) (Validation, error) {
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return Validation{}, err
	}
	if err := service.ensureCapability(ctx, item.StorePath); err != nil {
		return Validation{}, err
	}
	return service.adapter.Validate(ctx, item.StorePath, change)
}

func (service *Service) ensureCapability(ctx context.Context, root string) error {
	capability := service.adapter.Capability(ctx, root)
	if !capability.Available {
		return ErrToolUnavailable
	}
	if !capability.Supported {
		return ErrVersionUnsupported
	}
	return nil
}

func actionFingerprint(
	root string,
	status Status,
	instructions []Instructions,
	treeHashes map[string]string,
) (string, error) {
	sort.Slice(instructions, func(left, right int) bool {
		return instructions[left].ArtifactID < instructions[right].ArtifactID
	})
	dependencies := map[string]string{}
	for _, instruction := range instructions {
		for _, dependency := range instruction.Dependencies {
			if !dependency.Done || dependency.Path == "" {
				continue
			}
			path := dependency.Path
			if !filepath.IsAbs(path) {
				path = filepath.Join(root, filepath.Clean(path))
			}
			relative, err := filepath.Rel(root, path)
			if err != nil || relative == ".." || filepath.IsAbs(relative) {
				return "", ErrInvalidChange
			}
			content, err := os.ReadFile(path)
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return "", err
			}
			sum := sha256.Sum256(content)
			dependencies[filepath.ToSlash(relative)] = hex.EncodeToString(sum[:])
		}
	}
	payload, err := json.Marshal(struct {
		Status       Status            `json:"status"`
		Instructions []Instructions    `json:"instructions"`
		Dependencies map[string]string `json:"dependencies"`
		Tree         map[string]string `json:"tree"`
	}{status, instructions, dependencies, treeHashes})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func changeSnapshot(root, change string) (DeletionPreview, map[string]string, string, error) {
	if !validChangeName(change) || change == "archive" {
		return DeletionPreview{}, nil, "", ErrInvalidChange
	}
	changesRoot := filepath.Join(root, "openspec", "changes")
	changeRoot := filepath.Join(changesRoot, change)
	info, err := os.Lstat(changeRoot)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return DeletionPreview{}, nil, "", ErrInvalidChange
	}
	resolvedChangesRoot, err := filepath.EvalSymlinks(changesRoot)
	if err != nil {
		return DeletionPreview{}, nil, "", ErrInvalidChange
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return DeletionPreview{}, nil, "", ErrInvalidChange
	}
	resolvedChangeRoot, err := filepath.EvalSymlinks(changeRoot)
	if err != nil {
		return DeletionPreview{}, nil, "", ErrInvalidChange
	}
	relativeRoot, err := filepath.Rel(resolvedChangesRoot, resolvedChangeRoot)
	if err != nil || relativeRoot != change || filepath.IsAbs(relativeRoot) {
		return DeletionPreview{}, nil, "", ErrInvalidChange
	}

	files := make([]string, 0)
	hashes := map[string]string{}
	err = filepath.WalkDir(resolvedChangeRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrInvalidChange
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			return ErrInvalidChange
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		relative, relErr := filepath.Rel(resolvedRoot, path)
		if relErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) ||
			filepath.IsAbs(relative) {
			return ErrInvalidChange
		}
		relative = filepath.ToSlash(relative)
		sum := sha256.Sum256(content)
		files = append(files, relative)
		hashes[relative] = hex.EncodeToString(sum[:])
		return nil
	})
	if err != nil {
		return DeletionPreview{}, nil, "", err
	}
	sort.Strings(files)
	return DeletionPreview{Files: files, TotalFiles: len(files)}, hashes, resolvedChangeRoot, nil
}

func archiveReason(complete bool) string {
	if complete {
		return ""
	}
	return "CHANGE_INCOMPLETE"
}
