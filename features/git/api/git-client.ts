import { apiRequest } from "@/features/api/api-client";
import type { GitStatus } from "@/features/git/model/git-types";

export function getGitStatus(projectId: string, signal?: AbortSignal): Promise<GitStatus> {
  return apiRequest<GitStatus>(`/api/v1/projects/${encodeURIComponent(projectId)}/git/status`, { signal });
}
