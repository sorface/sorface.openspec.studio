import { apiRequest } from "@/features/api/api-client";
import type {
  PublicationPreview,
  PublicationResult,
  TaskSyncResult,
  TaskWorkspaceOverview,
} from "@/features/task-context/model/task-context-types";

function taskPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/${suffix}`;
}

export function getTaskWorkspaces(projectId: string, signal?: AbortSignal): Promise<TaskWorkspaceOverview> {
  return apiRequest<TaskWorkspaceOverview>(taskPath(projectId, "task-workspaces"), { signal });
}

export function openTaskWorkspace(
  projectId: string,
  input: { branch?: string; remoteBranch?: string },
): Promise<TaskWorkspaceOverview> {
  return apiRequest<TaskWorkspaceOverview>(taskPath(projectId, "task-workspaces"), {
    method: "POST",
    body: input,
  });
}

export function syncTaskWorkspace(projectId: string): Promise<TaskSyncResult> {
  return apiRequest<TaskSyncResult>(taskPath(projectId, "task-workspaces/sync"), {
    method: "POST",
  });
}

export function previewTaskPublication(projectId: string): Promise<PublicationPreview> {
  return apiRequest<PublicationPreview>(taskPath(projectId, "task-publications/preview"), {
    method: "POST",
  });
}

export function generateTaskPublicationMessage(projectId: string, token: string): Promise<PublicationPreview> {
  return apiRequest<PublicationPreview>(taskPath(projectId, "task-publications/message"), {
    method: "POST",
    body: { token },
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
