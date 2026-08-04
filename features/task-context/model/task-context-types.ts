import type { GitOperation } from "@/features/git/model/git-operation";

export interface TaskWorkspace {
  id: string;
  branch: string;
  managed: boolean;
  active: boolean;
  dirty: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWorkspaceOverview {
  items: TaskWorkspace[];
  availableBranches: string[];
  active?: TaskWorkspace;
}

export interface PublicationPreview {
  token: string;
  task: string;
  paths: string[];
  excludedCount: number;
  message: string;
  body?: string;
  generatedBy: "agent" | "fallback";
  diffTruncated: boolean;
  expiresAt: string;
}

export interface PublicationResult {
  task: string;
  commitSha: string;
  operation: GitOperation;
}
