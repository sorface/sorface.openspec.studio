"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import { getDocumentAnnotations, getDocumentHistory } from "@/features/documents/api/documents-client";
import type {
  DocumentAnnotationEntry,
  DocumentHistoryEntry,
  DocumentHistoryStatus,
} from "@/features/documents/model/document-types";

export interface DocumentHistoryController {
  open: boolean;
  status: DocumentHistoryStatus;
  items: DocumentHistoryEntry[];
  annotations: DocumentAnnotationEntry[];
  error: ApiError | null;
  show: () => void;
  close: () => void;
  retry: () => void;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, {
    code: "UNKNOWN_ERROR",
    message: "Не удалось загрузить Git-данные файла",
    details: error,
  });
}

export function useDocumentHistoryController(
  projectId?: string,
  path?: string | null,
  workspaceContext = "",
): DocumentHistoryController {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DocumentHistoryStatus>("idle");
  const [items, setItems] = useState<DocumentHistoryEntry[]>([]);
  const [annotations, setAnnotations] = useState<DocumentAnnotationEntry[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!projectId || !path) return;
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setOpen(true);
    setStatus("loading");
    setError(null);
    void Promise.all([
      getDocumentAnnotations(projectId, path, request.signal),
      getDocumentHistory(projectId, path, request.signal),
    ])
      .then(([annotationItems, history]) => {
        if (request.signal.aborted) return;
        setAnnotations(annotationItems);
        setItems(history);
        setStatus(annotationItems.length > 0 || history.length > 0 ? "ready" : "empty");
      })
      .catch((cause) => {
        if (request.signal.aborted) return;
        setItems([]);
        setAnnotations([]);
        setError(toApiError(cause));
        setStatus("error");
      });
  }, [path, projectId]);

  const close = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setOpen(false);
  }, []);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    void Promise.resolve().then(() => {
      setOpen(false);
      setStatus("idle");
      setItems([]);
      setAnnotations([]);
      setError(null);
    });
    return () => requestRef.current?.abort();
  }, [path, projectId, workspaceContext]);

  return useMemo(() => ({
    open,
    status,
    items,
    annotations,
    error,
    show: load,
    close,
    retry: load,
  }), [annotations, close, error, items, load, open, status]);
}
