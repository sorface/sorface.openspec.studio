export interface ContextEntry {
  source: string;
  path: string;
  size: number;
  checksum: string;
  reason: string;
  included: boolean;
}

export interface ContextManifest {
  reviewToken: string;
  entries: ContextEntry[];
  expiresAt: string;
  limits: Record<string, number>;
}

export type AiStatus =
  | "queued" | "running" | "validating" | "awaiting_review"
  | "cancelled" | "failed";

export interface AiOperation {
  id: string;
  projectId: string;
  kind: "ai";
  status: AiStatus;
  provider: string;
  model?: string;
  result?: string;
  errorCode?: string;
  errorMessage?: string;
  correlationId?: string;
}

export interface AiResult {
  finalResponse: string;
  files: Array<{ path: string; before: string; after: string }>;
}
