import { apiRequest } from "@/features/api/api-client";
import type { CloneOperation, RepositoryLink } from "@/features/repositories/model/repository-types";

export async function listRepositories(projectId: string, signal?: AbortSignal): Promise<RepositoryLink[]> {
  const response = await apiRequest<{ items: RepositoryLink[] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/repositories`,
    { signal },
  );
  return response.items;
}

export function startRepositoryClone(
  projectId: string,
  input: { url: string },
): Promise<CloneOperation> {
  return apiRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/repository-clones`, {
    method: "POST",
    body: input,
  });
}

export function getRepositoryClone(projectId: string, operationId: string): Promise<CloneOperation> {
  return apiRequest(
    `/api/v1/projects/${encodeURIComponent(projectId)}/repository-clones/${encodeURIComponent(operationId)}`,
  );
}

export function cancelRepositoryClone(projectId: string, operationId: string): Promise<CloneOperation> {
  return apiRequest(
    `/api/v1/projects/${encodeURIComponent(projectId)}/repository-clones/${encodeURIComponent(operationId)}`,
    { method: "DELETE" },
  );
}

export function cloneEventsUrl(projectId: string, operationId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/repository-clones/${encodeURIComponent(operationId)}/events`;
}
