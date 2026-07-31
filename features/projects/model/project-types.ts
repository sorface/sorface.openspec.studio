export interface Project {
  id: string;
  name: string;
  storePath: string;
  activeWorktreeId: string | null;
  defaultAiProvider: string | null;
  defaultModel: string | null;
  contextImport?: ContextImportSummary;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  storePath: string;
}

export interface CreateProjectFromGitInput {
  name?: string;
  url: string;
}

export interface ContextImportFailure {
  url: string;
  code: string;
  message: string;
}

export interface ContextImportSummary {
  manifestFound: boolean;
  requested: number;
  imported: number;
  failures: ContextImportFailure[];
}

export interface UpdateProjectInput {
  name?: string;
  defaultAiProvider?: string;
  defaultModel?: string;
}

export interface ProjectListResponse {
  items: Project[];
}

export type ProjectViewStatus = "loading" | "ready" | "empty" | "error" | "unavailable";
