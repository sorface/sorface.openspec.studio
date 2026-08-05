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
  remoteBranches: string[];
  active?: TaskWorkspace;
}

export interface TaskSyncResult {
  task: string;
  updated: boolean;
  previousHead: string;
  head: string;
}

export interface PublicationPreview {
  token: string;
  task: string;
  paths: string[];
  excludedCount: number;
  message: string;
  body?: string;
  generatedBy: "agent" | "manual";
  diffTruncated: boolean;
  expiresAt: string;
}

export interface PublicationResult {
  task: string;
  commitSha: string;
  operation: GitOperation;
}
