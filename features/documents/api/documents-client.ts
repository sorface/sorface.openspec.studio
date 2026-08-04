import { apiRequest } from "@/features/api/api-client";
import type {
  DocumentAnnotationsResponse,
  DocumentContent,
  DocumentHistoryResponse,
  DocumentListResponse,
  WriteDocumentInput,
} from "@/features/documents/model/document-types";

const documentsPath = (projectId: string) =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/documents`;

export async function listDocuments(projectId: string, signal?: AbortSignal): Promise<DocumentListResponse["items"]> {
  const response = await apiRequest<DocumentListResponse>(documentsPath(projectId), { signal });
  return response.items;
}

export async function getDocumentAnnotations(
  projectId: string,
  path: string,
  signal?: AbortSignal,
): Promise<DocumentAnnotationsResponse["items"]> {
  const query = new URLSearchParams({ path });
  const response = await apiRequest<DocumentAnnotationsResponse>(`${documentsPath(projectId)}/annotations?${query}`, { signal });
  return response.items;
}

export function getDocument(projectId: string, path: string, signal?: AbortSignal): Promise<DocumentContent> {
  const query = new URLSearchParams({ path });
  return apiRequest<DocumentContent>(`${documentsPath(projectId)}/content?${query}`, { signal });
}

export async function getDocumentHistory(
  projectId: string,
  path: string,
  signal?: AbortSignal,
): Promise<DocumentHistoryResponse["items"]> {
  const query = new URLSearchParams({ path });
  const response = await apiRequest<DocumentHistoryResponse>(`${documentsPath(projectId)}/history?${query}`, { signal });
  return response.items;
}

export function writeDocument(projectId: string, input: WriteDocumentInput): Promise<DocumentContent> {
  return apiRequest<DocumentContent>(`${documentsPath(projectId)}/content`, {
    method: "PUT",
    body: input,
  });
}
