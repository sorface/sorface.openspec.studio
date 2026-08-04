import { apiRequest } from "@/features/api/api-client";
import type {
  PublicationPreview,
  PublicationResult,
  TaskWorkspaceOverview,
} from "@/features/task-context/model/task-context-types";

function taskPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/${suffix}`;
}

export function getTaskWorkspaces(projectId: string, signal?: AbortSignal): Promise<TaskWorkspaceOverview> {
  return apiRequest<TaskWorkspaceOverview>(taskPath(projectId, "task-workspaces"), { signal });
}

export function openTaskWorkspace(projectId: string, branch: string): Promise<TaskWorkspaceOverview> {
  return apiRequest<TaskWorkspaceOverview>(taskPath(projectId, "task-workspaces"), {
    method: "POST",
    body: { branch },
  });
}

export function previewTaskPublication(projectId: string): Promise<PublicationPreview> {
  return apiRequest<PublicationPreview>(taskPath(projectId, "task-publications/preview"), {
    method: "POST",
  });
}

export function publishTaskArtifacts(
  projectId: string,
  input: { token: string; message?: string; body?: string },
): Promise<PublicationResult> {
  return apiRequest<PublicationResult>(taskPath(projectId, "task-publications"), {
    method: "POST",
    body: input,
  });
}
