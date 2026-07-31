"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import { getDocumentHistory } from "@/features/documents/api/documents-client";
import type {
  DocumentHistoryEntry,
  DocumentHistoryStatus,
} from "@/features/documents/model/document-types";

export interface DocumentHistoryController {
  open: boolean;
  status: DocumentHistoryStatus;
  items: DocumentHistoryEntry[];
  error: ApiError | null;
  show: () => void;
  close: () => void;
  retry: () => void;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, {
    code: "UNKNOWN_ERROR",
    message: "Не удалось загрузить историю файла",
    details: error,
  });
}

export function useDocumentHistoryController(
  projectId?: string,
  path?: string | null,
): DocumentHistoryController {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DocumentHistoryStatus>("idle");
  const [items, setItems] = useState<DocumentHistoryEntry[]>([]);
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
    void getDocumentHistory(projectId, path, request.signal)
      .then((history) => {
        if (request.signal.aborted) return;
        setItems(history);
        setStatus(history.length > 0 ? "ready" : "empty");
      })
      .catch((cause) => {
        if (request.signal.aborted) return;
        setItems([]);
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
      setError(null);
    });
    return () => requestRef.current?.abort();
  }, [path, projectId]);

  return useMemo(() => ({
    open,
    status,
    items,
    error,
    show: load,
    close,
    retry: load,
  }), [close, error, items, load, open, status]);
}
