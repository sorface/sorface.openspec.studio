package openspec

import "time"

type Capability struct {
	Available bool   `json:"available"`
	Supported bool   `json:"supported"`
	Version   string `json:"version,omitempty"`
	Path      string `json:"-"`
}

type ChangeSummary struct {
	Name           string    `json:"name"`
	CompletedTasks int       `json:"completedTasks"`
	TotalTasks     int       `json:"totalTasks"`
	LastModified   time.Time `json:"lastModified"`
	Status         string    `json:"status"`
}

type ListResult struct {
	Changes []ChangeSummary `json:"changes"`
}

type Artifact struct {
	ID          string   `json:"id"`
	OutputPath  string   `json:"outputPath"`
	Status      string   `json:"status"`
	Requires    []string `json:"requires"`
	MissingDeps []string `json:"missingDeps,omitempty"`
}

type Status struct {
	ChangeName    string     `json:"changeName"`
	SchemaName    string     `json:"schemaName"`
	IsComplete    bool       `json:"isComplete"`
	ApplyRequires []string   `json:"applyRequires"`
	Artifacts     []Artifact `json:"artifacts"`
}

type InstructionDependency struct {
	ID          string `json:"id"`
	Done        bool   `json:"done"`
	Path        string `json:"path"`
	Description string `json:"description"`
}

type Instructions struct {
	ArtifactID         string                  `json:"artifactId"`
	ChangeDir          string                  `json:"changeDir,omitempty"`
	Instruction        string                  `json:"instruction"`
	Context            string                  `json:"context"`
	Rules              []string                `json:"rules"`
	Template           string                  `json:"template"`
	ResolvedOutputPath string                  `json:"resolvedOutputPath"`
	Dependencies       []InstructionDependency `json:"dependencies"`
}

type Diagnostic struct {
	Level   string `json:"level"`
	Path    string `json:"path,omitempty"`
	Message string `json:"message"`
}

type Validation struct {
	Valid       bool         `json:"valid"`
	Diagnostics []Diagnostic `json:"diagnostics"`
	RawOutput   string       `json:"rawOutput,omitempty"`
}

type Action struct {
	Kind        string        `json:"kind"`
	Artifact    string        `json:"artifact,omitempty"`
	Available   bool          `json:"available"`
	Reason      string        `json:"reason,omitempty"`
	InputPaths  []string      `json:"inputPaths,omitempty"`
	OutputPaths []string      `json:"outputPaths,omitempty"`
	Instruction *Instructions `json:"-"`
}

type ChangeDetails struct {
	Summary     ChangeSummary   `json:"summary"`
	Schema      string          `json:"schema"`
	Complete    bool            `json:"complete"`
	Artifacts   []Artifact      `json:"artifacts"`
	Actions     []Action        `json:"actions"`
	Fingerprint string          `json:"fingerprint"`
	Deletion    DeletionPreview `json:"deletion"`
}

type DeletionPreview struct {
	Files      []string `json:"files"`
	TotalFiles int      `json:"totalFiles"`
}

type DeleteChangeInput struct {
	Confirmation      string `json:"confirmation"`
	StatusFingerprint string `json:"statusFingerprint"`
}

type DeleteChangeResult struct {
	Deleted      bool     `json:"deleted"`
	Change       string   `json:"change"`
	DeletedFiles []string `json:"deletedFiles"`
}

type Overview struct {
	Capability Capability      `json:"capability"`
	Changes    []ChangeSummary `json:"changes"`
}
