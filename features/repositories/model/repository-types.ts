export interface RepositoryLink {
  id: string;
  projectId: string;
  name: string;
  path: string;
  remoteUrl: string;
  fingerprint: string;
  branch?: string;
  commitSha: string;
  dirty: boolean;
  available: boolean;
  readOnlyForAi: true;
}

export type OperationStatus =
  | "queued" | "running" | "validating" | "completed" | "cancelled" | "failed";

export interface CloneOperation {
  id: string;
  projectId: string;
  kind: "repository_clone";
  status: OperationStatus;
  errorCode?: string;
  errorMessage?: string;
  correlationId?: string;
}
