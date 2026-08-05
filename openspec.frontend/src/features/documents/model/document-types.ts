export interface DocumentItem {
  path: string;
  name: string;
  kind: "directory" | "file";
}

export interface DocumentListResponse {
  items: DocumentItem[];
}

export interface DocumentContent {
  path: string;
  content: string;
  contentHash: string;
}

export interface WriteDocumentInput {
  path: string;
  content: string;
  baseContentHash: string;
}

export interface DocumentHistoryEntry {
  hash: string;
  shortHash: string;
  author: string;
  committedAt: string;
  subject: string;
}

export interface DocumentHistoryResponse {
  items: DocumentHistoryEntry[];
}

export interface DocumentAnnotationEntry {
  startLine: number;
  endLine: number;
  hash?: string;
  shortHash?: string;
  author: string;
  authorEmail?: string;
  authoredAt?: string;
  subject: string;
  lines: string[];
  local: boolean;
}

export interface DocumentAnnotationsResponse {
  items: DocumentAnnotationEntry[];
}

export type DocumentHistoryStatus = "idle" | "loading" | "ready" | "empty" | "error";
export type DocumentViewStatus = "idle" | "loading" | "ready" | "empty" | "error" | "unavailable";
