import { apiRequest } from "@/features/api/api-client";
import type {
  DeleteOpenSpecChangeResult,
  OpenSpecChangeDetails,
  OpenSpecDraftSet,
  OpenSpecOperation,
  OpenSpecOverview,
  OpenSpecValidation,
  StartOpenSpecActionInput,
} from "@/features/openspec-workflow/model/openspec-types";

const projectPath = (projectId: string) =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/openspec`;

export function getOpenSpecOverview(projectId: string, signal?: AbortSignal): Promise<OpenSpecOverview> {
  return apiRequest(`${projectPath(projectId)}/changes`, { signal });
}

export function getOpenSpecChange(
  projectId: string,
  change: string,
  signal?: AbortSignal,
): Promise<OpenSpecChangeDetails> {
  return apiRequest(`${projectPath(projectId)}/changes/${encodeURIComponent(change)}`, { signal });
}

export function deleteOpenSpecChange(
  projectId: string,
  change: string,
  input: { confirmation: string; statusFingerprint: string },
): Promise<DeleteOpenSpecChangeResult> {
  return apiRequest(`${projectPath(projectId)}/changes/${encodeURIComponent(change)}`, {
    method: "DELETE",
    body: input,
  });
}

export function validateOpenSpec(
  projectId: string,
  change?: string,
): Promise<OpenSpecValidation> {
  return apiRequest(`${projectPath(projectId)}/validate`, {
    method: "POST",
    body: change ? { change } : {},
  });
}

export function startOpenSpecAction(
  projectId: string,
  input: StartOpenSpecActionInput,
): Promise<OpenSpecOperation> {
  return apiRequest(`${projectPath(projectId)}/actions`, { method: "POST", body: input });
}

export function getOpenSpecOperation(
  projectId: string,
  operationId: string,
): Promise<OpenSpecOperation> {
  return apiRequest(`${projectPath(projectId)}/operations/${encodeURIComponent(operationId)}`);
}

export function cancelOpenSpecOperation(
  projectId: string,
  operationId: string,
): Promise<OpenSpecOperation> {
  return apiRequest(`${projectPath(projectId)}/operations/${encodeURIComponent(operationId)}`, {
    method: "DELETE",
  });
}

export function openSpecEventsUrl(projectId: string, operationId: string): string {
  return `${projectPath(projectId)}/operations/${encodeURIComponent(operationId)}/events`;
}

export function acceptOpenSpecOperation(
  projectId: string,
  operationId: string,
): Promise<OpenSpecDraftSet> {
  return apiRequest(`${projectPath(projectId)}/operations/${encodeURIComponent(operationId)}/accept`, {
    method: "POST",
  });
}

export function rejectOpenSpecOperation(
  projectId: string,
  operationId: string,
): Promise<OpenSpecOperation> {
  return apiRequest(`${projectPath(projectId)}/operations/${encodeURIComponent(operationId)}/reject`, {
    method: "POST",
  });
}

export function getOpenSpecDraft(projectId: string, draftId: string): Promise<OpenSpecDraftSet> {
  return apiRequest(`${projectPath(projectId)}/drafts/${encodeURIComponent(draftId)}`);
}

export function writeOpenSpecDraft(projectId: string, draftId: string): Promise<OpenSpecDraftSet> {
  return apiRequest(`${projectPath(projectId)}/drafts/${encodeURIComponent(draftId)}/write`, {
    method: "POST",
  });
}
