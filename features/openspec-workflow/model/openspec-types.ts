export type OpenSpecViewStatus =
  | "idle" | "loading" | "ready" | "empty" | "unavailable" | "stale" | "error";

export interface OpenSpecCapability {
  available: boolean;
  supported: boolean;
  version?: string;
}

export interface OpenSpecChangeSummary {
  name: string;
  completedTasks: number;
  totalTasks: number;
  lastModified: string;
  status: string;
}

export interface OpenSpecOverview {
  capability: OpenSpecCapability;
  changes: OpenSpecChangeSummary[];
}

export interface OpenSpecArtifact {
  id: string;
  outputPath: string;
  status: string;
  requires: string[];
  missingDeps?: string[];
}

export type OpenSpecActionKind =
  | "explore" | "create_change" | "prepare_artifact" | "fix_artifact" | "archive";

export type OpenSpecValidationStatus =
  | "idle" | "checking" | "valid" | "invalid" | "error";

export interface OpenSpecAction {
  kind: OpenSpecActionKind;
  artifact?: string;
  available: boolean;
  reason?: string;
  inputPaths?: string[];
  outputPaths?: string[];
}

export interface OpenSpecChangeDetails {
  summary: OpenSpecChangeSummary;
  schema: string;
  complete: boolean;
  artifacts: OpenSpecArtifact[];
  actions: OpenSpecAction[];
  deletion: OpenSpecDeletionPreview;
  fingerprint: string;
}

export interface OpenSpecDeletionPreview {
  files: string[];
  totalFiles: number;
}

export interface DeleteOpenSpecChangeResult {
  deleted: boolean;
  change: string;
  deletedFiles: string[];
}

export interface OpenSpecDiagnostic {
  level: string;
  path?: string;
  message: string;
}

export interface OpenSpecValidation {
  valid: boolean;
  diagnostics: OpenSpecDiagnostic[];
}

export type OpenSpecOperationStatus =
  | "queued" | "running" | "validating" | "awaiting_review"
  | "accepted" | "rejected" | "cancelled" | "failed";

export interface OpenSpecOperation {
  id: string;
  projectId: string;
  kind: "openspec";
  status: OpenSpecOperationStatus;
  provider?: string;
  model?: string;
  result?: string;
  errorCode?: string;
  errorMessage?: string;
  correlationId?: string;
  openspecAction: OpenSpecActionKind;
  openspecChange: string;
  openspecSchema?: string;
  openspecArtifact?: string;
  openspecFingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenSpecOperationList {
  items: OpenSpecOperation[];
}

export interface OpenSpecFileMutation {
  type: "create" | "update" | "delete" | "rename";
  path: string;
  previousPath?: string;
  before?: string;
  after?: string;
}

export interface OpenSpecActionResult {
  finalResponse?: string;
  exploration?: OpenSpecExplorationResult;
  files: OpenSpecFileMutation[];
  diagnostics: OpenSpecDiagnostic[];
}

export type OpenSpecQuestionKind = "text" | "single_choice" | "multi_choice";

export interface OpenSpecExplorationQuestion {
  id: string;
  prompt: string;
  why?: string;
  kind: OpenSpecQuestionKind;
  options?: string[];
}

export interface OpenSpecExplorationResult {
  state: "needs_input" | "proposal_ready";
  summary: string;
  questions: OpenSpecExplorationQuestion[];
  assumptions: string[];
  proposal?: string;
  suggestedNames: string[];
}

export type ChangeCreationStage = "intent" | "clarifying" | "proposal" | "naming" | "creating";

export interface ChangeCreationDraft {
  projectId?: string;
  version: 1;
  stage: ChangeCreationStage;
  intent: string;
  summary?: string;
  questions: OpenSpecExplorationQuestion[];
  answers: Record<string, string[]>;
  assumptions: string[];
  proposal?: string;
  suggestedNames: string[];
  proposalAccepted: boolean;
  changeName?: string;
  contextFingerprint?: string;
  feedback?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface OpenSpecDraftMutation extends OpenSpecFileMutation {
  id: string;
  setId: string;
}

export interface OpenSpecDraftSet {
  id: string;
  projectId: string;
  operationId: string;
  status: "accepted" | "written";
  mutations: OpenSpecDraftMutation[];
}

export interface StartOpenSpecActionInput {
  kind: OpenSpecActionKind;
  change?: string;
  artifact?: string;
  goal?: string;
  proposal?: string;
  provider?: string;
  model?: string;
  statusFingerprint?: string;
}
