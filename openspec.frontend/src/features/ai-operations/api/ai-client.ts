import { apiRequest } from "@/features/api/api-client";
import type { AiOperation, ContextManifest } from "@/features/ai-operations/model/ai-types";

const projectPath = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/ai`;

export function createContextManifest(
  projectId: string,
  files: Array<{ source: string; path: string }> = [],
): Promise<ContextManifest> {
  return apiRequest(`${projectPath(projectId)}/context-manifests`, { method: "POST", body: { files } });
}

export function createAiOperation(
  projectId: string,
  input: {
    reviewToken: string;
    prompt: string;
    provider: string;
    model?: string;
    reasoningEffort?: "low";
  },
): Promise<AiOperation> {
  return apiRequest(`${projectPath(projectId)}/operations`, { method: "POST", body: input });
}

export function getAiOperation(projectId: string, operationId: string): Promise<AiOperation> {
  return apiRequest(`${projectPath(projectId)}/operations/${encodeURIComponent(operationId)}`);
}

export function cancelAiOperation(projectId: string, operationId: string): Promise<AiOperation> {
  return apiRequest(`${projectPath(projectId)}/operations/${encodeURIComponent(operationId)}`, { method: "DELETE" });
}

export function aiEventsUrl(projectId: string, operationId: string): string {
  return `${projectPath(projectId)}/operations/${encodeURIComponent(operationId)}/events`;
}
