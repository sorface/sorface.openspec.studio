export type GitOperationStatus =
  | "queued"
  | "running"
  | "validating"
  | "completed"
  | "cancelled"
  | "failed";

export interface GitOperation {
  id: string;
  projectId: string;
  kind: "store_git";
  status: GitOperationStatus;
  errorCode?: string;
  errorMessage?: string;
  correlationId?: string;
  gitAction: "fetch" | "push";
  gitRemote?: string;
  gitBranch?: string;
  createdAt: string;
  updatedAt: string;
}

export function isGitOperationTerminal(status: GitOperationStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}
