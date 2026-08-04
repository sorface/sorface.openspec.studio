package document

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/project"
)

const MaxDocumentSize int64 = 2 << 20
const maxHistoryOutput int64 = 256 << 10
const maxBlameOutput int64 = 16 << 20

var (
	ErrPathOutsideScope = errors.New("document path is outside allowed scope")
	ErrNotFound         = errors.New("document not found")
	ErrInvalidContent   = errors.New("document content is invalid")
	ErrTooLarge         = errors.New("document is too large")
	ErrConflict         = errors.New("document content changed")
)

var allowedRoots = []string{
	filepath.Join("openspec", "specs"),
	filepath.Join("openspec", "changes"),
	filepath.Join("openspec", "archive"),
}

type ProjectReader interface {
	Get(context.Context, string) (project.Project, error)
}

type Item struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type Content struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	ContentHash string `json:"contentHash"`
}

type WriteInput struct {
	Path            string `json:"path"`
	Content         string `json:"content"`
	BaseContentHash string `json:"baseContentHash"`
}

type HistoryEntry struct {
	Hash        string `json:"hash"`
	ShortHash   string `json:"shortHash"`
	Author      string `json:"author"`
	CommittedAt string `json:"committedAt"`
	Subject     string `json:"subject"`
}

type AnnotationEntry struct {
	StartLine   int      `json:"startLine"`
	EndLine     int      `json:"endLine"`
	Hash        string   `json:"hash,omitempty"`
	ShortHash   string   `json:"shortHash,omitempty"`
	Author      string   `json:"author"`
	AuthorEmail string   `json:"authorEmail,omitempty"`
	AuthoredAt  string   `json:"authoredAt,omitempty"`
	Subject     string   `json:"subject"`
	Lines       []string `json:"lines"`
	Local       bool     `json:"local"`
}

type blameLine struct {
	line        int
	hash        string
	author      string
	authorEmail string
	authoredAt  string
	subject     string
	content     string
}

type Service struct {
	projects ProjectReader
	runner   processrunner.Runner
	gitPath  string
}

func NewService(projects ProjectReader) *Service {
	gitPath, _ := exec.LookPath("git")
	return &Service{projects: projects, gitPath: gitPath}
}

func (service *Service) List(ctx context.Context, projectID string) ([]Item, error) {
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return nil, err
	}
	storeRoot, err := trustedStoreRoot(item.StorePath)
	if err != nil {
		return nil, err
	}

	items := make([]Item, 0)
	for _, relativeRoot := range allowedRoots {
		root := filepath.Join(storeRoot, relativeRoot)
		info, statErr := os.Lstat(root)
		if errors.Is(statErr, fs.ErrNotExist) {
			continue
		}
		if statErr != nil {
			return nil, statErr
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			continue
		}
		walkErr := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.Type()&os.ModeSymlink != 0 {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			relative, relErr := filepath.Rel(storeRoot, path)
			if relErr != nil {
				return relErr
			}
			relative = filepath.ToSlash(relative)
			if entry.IsDir() {
				items = append(items, Item{Path: relative, Name: entry.Name(), Kind: "directory"})
				return nil
			}
			if strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
				items = append(items, Item{Path: relative, Name: entry.Name(), Kind: "file"})
			}
			return nil
		})
		if walkErr != nil {
			return nil, walkErr
		}
	}
	sort.Slice(items, func(i, j int) bool {
		leftKey := documentSortKey(items[i].Path)
		rightKey := documentSortKey(items[j].Path)
		if leftKey == rightKey {
			return items[i].Kind < items[j].Kind
		}
		return leftKey < rightKey
	})
	return items, nil
}

func documentSortKey(path string) string {
	segments := strings.Split(filepath.ToSlash(path), "/")
	if len(segments) < 4 || segments[0] != "openspec" || segments[1] != "changes" {
		return path
	}

	var rank string
	switch segments[3] {
	case "proposal.md":
		rank = "0"
	case "spec", "specs":
		rank = "1"
	case "design.md":
		rank = "2"
	case "tasks.md":
		rank = "3"
	default:
		rank = "4-" + segments[3]
	}
	return strings.Join(segments[:3], "/") + "/" + rank + "/" + strings.Join(segments[3:], "/")
}

func (service *Service) Read(ctx context.Context, projectID, relativePath string) (Content, error) {
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return Content{}, err
	}
	cleanPath, target, err := resolveDocument(item.StorePath, relativePath)
	if err != nil {
		return Content{}, err
	}
	data, err := readDocument(target)
	if err != nil {
		return Content{}, err
	}
	return Content{Path: cleanPath, Content: string(data), ContentHash: hash(data)}, nil
}

func (service *Service) Write(ctx context.Context, projectID string, input WriteInput) (Content, error) {
	if !utf8.ValidString(input.Content) {
		return Content{}, ErrInvalidContent
	}
	if int64(len(input.Content)) > MaxDocumentSize {
		return Content{}, ErrTooLarge
	}
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return Content{}, err
	}
	cleanPath, target, err := resolveDocument(item.StorePath, input.Path)
	if err != nil {
		return Content{}, err
	}
	current, err := readDocument(target)
	if err != nil {
		return Content{}, err
	}
	if input.BaseContentHash == "" || hash(current) != input.BaseContentHash {
		return Content{}, ErrConflict
	}
	info, err := os.Stat(target)
	if err != nil {
		return Content{}, mapFileError(err)
	}
	if err := atomicWrite(target, []byte(input.Content), info.Mode().Perm()); err != nil {
		return Content{}, err
	}
	data := []byte(input.Content)
	return Content{Path: cleanPath, Content: input.Content, ContentHash: hash(data)}, nil
}

func (service *Service) History(ctx context.Context, projectID, relativePath string) ([]HistoryEntry, error) {
	if service.gitPath == "" {
		return nil, project.ErrGitUnavailable
	}
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return nil, err
	}
	cleanPath, _, err := resolveDocument(item.StorePath, relativePath)
	if err != nil {
		return nil, err
	}
	storeRoot, err := trustedStoreRoot(item.StorePath)
	if err != nil {
		return nil, err
	}

	if _, err = service.runner.Run(ctx, processrunner.Command{
		Executable: service.gitPath,
		Arguments:  []string{"rev-parse", "--verify", "HEAD"},
		Directory:  storeRoot,
		Timeout:    10 * time.Second,
	}); err != nil {
		return []HistoryEntry{}, nil
	}

	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable: service.gitPath,
		Arguments: []string{
			"log", "--follow", "--max-count=100",
			"--format=%H%x1f%h%x1f%aN%x1f%aI%x1f%s%x1e",
			"--", cleanPath,
		},
		Directory:      storeRoot,
		Timeout:        30 * time.Second,
		MaxOutputBytes: maxHistoryOutput,
	})
	if err != nil {
		return nil, project.ErrInvalidStore
	}
	return parseHistory(result.Stdout), nil
}

func (service *Service) Annotations(ctx context.Context, projectID, relativePath string) ([]AnnotationEntry, error) {
	if service.gitPath == "" {
		return nil, project.ErrGitUnavailable
	}
	item, err := service.projects.Get(ctx, projectID)
	if err != nil {
		return nil, err
	}
	cleanPath, target, err := resolveDocument(item.StorePath, relativePath)
	if err != nil {
		return nil, err
	}
	storeRoot, err := trustedStoreRoot(item.StorePath)
	if err != nil {
		return nil, err
	}

	if _, err = service.runner.Run(ctx, processrunner.Command{
		Executable: service.gitPath,
		Arguments:  []string{"rev-parse", "--verify", "HEAD"},
		Directory:  storeRoot,
		Timeout:    10 * time.Second,
	}); err != nil {
		return localAnnotations(target)
	}
	if _, err = service.runner.Run(ctx, processrunner.Command{
		Executable: service.gitPath,
		Arguments:  []string{"cat-file", "-e", "HEAD:" + cleanPath},
		Directory:  storeRoot,
		Timeout:    10 * time.Second,
	}); err != nil {
		return localAnnotations(target)
	}

	result, err := service.runner.Run(ctx, processrunner.Command{
		Executable:     service.gitPath,
		Arguments:      []string{"blame", "--line-porcelain", "--", cleanPath},
		Directory:      storeRoot,
		Timeout:        30 * time.Second,
		MaxOutputBytes: maxBlameOutput,
	})
	if err != nil {
		return nil, project.ErrInvalidStore
	}
	return groupBlameLines(parseBlame(result.Stdout)), nil
}

func parseHistory(output string) []HistoryEntry {
	entries := make([]HistoryEntry, 0)
	for _, rawRecord := range strings.Split(output, "\x1e") {
		record := strings.TrimSpace(rawRecord)
		if record == "" {
			continue
		}
		fields := strings.SplitN(record, "\x1f", 5)
		if len(fields) != 5 {
			continue
		}
		entries = append(entries, HistoryEntry{
			Hash:        fields[0],
			ShortHash:   fields[1],
			Author:      fields[2],
			CommittedAt: fields[3],
			Subject:     fields[4],
		})
	}
	return entries
}

func parseBlame(output string) []blameLine {
	lines := make([]blameLine, 0)
	var current *blameLine
	for _, raw := range strings.Split(output, "\n") {
		if strings.HasPrefix(raw, "\t") {
			if current != nil {
				current.content = strings.TrimPrefix(raw, "\t")
				lines = append(lines, *current)
				current = nil
			}
			continue
		}
		fields := strings.Fields(raw)
		if len(fields) >= 3 && isGitHash(fields[0]) {
			line, parseErr := strconv.Atoi(fields[2])
			if parseErr == nil {
				current = &blameLine{line: line, hash: fields[0]}
			}
			continue
		}
		if current == nil {
			continue
		}
		switch {
		case strings.HasPrefix(raw, "author "):
			current.author = strings.TrimPrefix(raw, "author ")
		case strings.HasPrefix(raw, "author-mail "):
			current.authorEmail = strings.Trim(strings.TrimPrefix(raw, "author-mail "), "<>")
		case strings.HasPrefix(raw, "author-time "):
			seconds, parseErr := strconv.ParseInt(strings.TrimPrefix(raw, "author-time "), 10, 64)
			if parseErr == nil && seconds > 0 {
				current.authoredAt = time.Unix(seconds, 0).UTC().Format(time.RFC3339)
			}
		case strings.HasPrefix(raw, "summary "):
			current.subject = strings.TrimPrefix(raw, "summary ")
		}
	}
	return lines
}

func groupBlameLines(lines []blameLine) []AnnotationEntry {
	entries := make([]AnnotationEntry, 0)
	for _, line := range lines {
		local := isZeroHash(line.hash)
		hash := line.hash
		shortHash := ""
		author := line.author
		authorEmail := line.authorEmail
		authoredAt := line.authoredAt
		subject := line.subject
		if local {
			hash = ""
			author = "Локальные изменения"
			authorEmail = ""
			authoredAt = ""
			subject = "Ещё не сохранено в Git"
		} else {
			shortHash = hash
			if len(shortHash) > 8 {
				shortHash = shortHash[:8]
			}
		}
		if len(entries) > 0 {
			last := &entries[len(entries)-1]
			if last.EndLine+1 == line.line && last.Hash == hash && last.Author == author &&
				last.AuthoredAt == authoredAt && last.Subject == subject {
				last.EndLine = line.line
				last.Lines = append(last.Lines, line.content)
				continue
			}
		}
		entries = append(entries, AnnotationEntry{
			StartLine: line.line, EndLine: line.line, Hash: hash, ShortHash: shortHash,
			Author: author, AuthorEmail: authorEmail, AuthoredAt: authoredAt,
			Subject: subject, Lines: []string{line.content}, Local: local,
		})
	}
	return entries
}

func localAnnotations(target string) ([]AnnotationEntry, error) {
	data, err := readDocument(target)
	if err != nil {
		return nil, err
	}
	content := strings.TrimSuffix(string(data), "\n")
	if content == "" {
		return []AnnotationEntry{}, nil
	}
	lines := strings.Split(content, "\n")
	return []AnnotationEntry{{
		StartLine: 1,
		EndLine:   len(lines),
		Author:    "Локальные изменения",
		Subject:   "Ещё не сохранено в Git",
		Lines:     lines,
		Local:     true,
	}}, nil
}

func isGitHash(value string) bool {
	if len(value) < 40 {
		return false
	}
	for _, character := range value {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func isZeroHash(value string) bool {
	return value != "" && strings.Trim(value, "0") == ""
}

func trustedStoreRoot(storePath string) (string, error) {
	storePath = strings.TrimSpace(storePath)
	if storePath == "" || !filepath.IsAbs(storePath) {
		return "", project.ErrInvalidStore
	}
	root, err := filepath.Abs(storePath)
	if err != nil {
		return "", project.ErrInvalidStore
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", project.ErrInvalidStore
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", project.ErrInvalidStore
	}
	if !info.IsDir() {
		return "", project.ErrInvalidStore
	}
	return resolved, nil
}

func resolveDocument(storePath, relativePath string) (string, string, error) {
	if relativePath == "" || filepath.IsAbs(relativePath) || strings.Contains(relativePath, "\\") {
		return "", "", ErrPathOutsideScope
	}
	clean := filepath.Clean(filepath.FromSlash(relativePath))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", "", ErrPathOutsideScope
	}
	if !strings.EqualFold(filepath.Ext(clean), ".md") || !withinAllowedRoot(clean) {
		return "", "", ErrPathOutsideScope
	}
	root, err := trustedStoreRoot(storePath)
	if err != nil {
		return "", "", err
	}
	target := filepath.Join(root, clean)
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		return "", "", mapFileError(err)
	}
	relative, err := filepath.Rel(root, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", "", ErrPathOutsideScope
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", "", mapFileError(err)
	}
	if !info.Mode().IsRegular() {
		return "", "", ErrPathOutsideScope
	}
	return filepath.ToSlash(clean), resolved, nil
}

func withinAllowedRoot(path string) bool {
	for _, root := range allowedRoots {
		if path == root || strings.HasPrefix(path, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func readDocument(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, mapFileError(err)
	}
	if info.Size() > MaxDocumentSize {
		return nil, ErrTooLarge
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, mapFileError(err)
	}
	if !utf8.Valid(data) {
		return nil, ErrInvalidContent
	}
	return data, nil
}

func atomicWrite(target string, data []byte, mode fs.FileMode) (err error) {
	temp, err := os.CreateTemp(filepath.Dir(target), ".openspec-studio-*")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer func() {
		_ = temp.Close()
		if err != nil {
			_ = os.Remove(tempName)
		}
	}()
	if err = temp.Chmod(mode); err != nil {
		return err
	}
	if _, err = temp.Write(data); err != nil {
		return err
	}
	if err = temp.Sync(); err != nil {
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, target)
}

func hash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func mapFileError(err error) error {
	if errors.Is(err, fs.ErrNotExist) {
		return ErrNotFound
	}
	return err
}
