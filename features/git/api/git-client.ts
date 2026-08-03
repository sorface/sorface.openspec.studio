import { apiRequest } from "@/features/api/api-client";
import type { GitStatus } from "@/features/git/model/git-types";
import type { GitOperation } from "@/features/git/model/git-operation";

function projectGitPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/git/${suffix}`;
}

export function getGitStatus(projectId: string, signal?: AbortSignal): Promise<GitStatus> {
  return apiRequest<GitStatus>(projectGitPath(projectId, "status"), { signal });
}

export function stageGitPaths(projectId: string, paths: string[]): Promise<GitStatus> {
  return apiRequest<GitStatus>(projectGitPath(projectId, "stage"), { method: "POST", body: { paths } });
}

export function unstageGitPaths(projectId: string, paths: string[]): Promise<GitStatus> {
  return apiRequest<GitStatus>(projectGitPath(projectId, "unstage"), { method: "POST", body: { paths } });
}

export function createGitCommit(projectId: string, message: string, paths: string[], expectedHead: string): Promise<GitStatus> {
  return apiRequest<GitStatus>(projectGitPath(projectId, "commits"), {
    method: "POST", body: { message, paths, expectedHead },
  });
}

export function createGitBranch(projectId: string, name: string): Promise<GitStatus> {
  return apiRequest<GitStatus>(projectGitPath(projectId, "branches"), { method: "POST", body: { name } });
}

export function switchGitBranch(
  projectId: string,
  input: { branch?: string; remoteBranch?: string; localBranch?: string },
): Promise<GitStatus> {
  return apiRequest<GitStatus>(projectGitPath(projectId, "branch-switches"), { method: "POST", body: input });
}

export function startGitFetch(projectId: string, remote: string): Promise<GitOperation> {
  return apiRequest<GitOperation>(projectGitPath(projectId, "fetches"), { method: "POST", body: { remote } });
}

export function startGitPush(projectId: string, remote?: string, targetBranch?: string): Promise<GitOperation> {
  return apiRequest<GitOperation>(projectGitPath(projectId, "pushes"), {
    method: "POST", body: { remote, targetBranch },
  });
}

export function getGitOperation(projectId: string, operationId: string, signal?: AbortSignal): Promise<GitOperation> {
  return apiRequest<GitOperation>(projectGitPath(projectId, `operations/${encodeURIComponent(operationId)}`), { signal });
}

export function cancelGitOperation(projectId: string, operationId: string): Promise<GitOperation> {
  return apiRequest<GitOperation>(projectGitPath(projectId, `operations/${encodeURIComponent(operationId)}`), { method: "DELETE" });
}
