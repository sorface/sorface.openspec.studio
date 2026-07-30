export interface Project {
  id: string;
  name: string;
  storePath: string;
  activeWorktreeId: string | null;
  defaultAiProvider: string | null;
  defaultModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  storePath: string;
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
