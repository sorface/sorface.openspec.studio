"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import {
  getDocument,
  listDocuments,
  writeDocument,
} from "@/features/documents/api/documents-client";
import type {
  DocumentItem,
  DocumentViewStatus,
} from "@/features/documents/model/document-types";

export interface DocumentsController {
  items: DocumentItem[];
  selectedPath: string | null;
  markdown: string;
  status: DocumentViewStatus;
  loadingDocument: boolean;
  saving: boolean;
  dirty: boolean;
  conflict: boolean;
  error: ApiError | null;
  select: (path: string) => void;
  change: (markdown: string) => void;
  save: () => Promise<void>;
  retry: () => void;
}

interface DraftSnapshot {
  markdown: string;
  baseMarkdown: string;
  contentHash: string;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, {
    code: "UNKNOWN_ERROR",
    message: "Операция с документом не выполнена",
    details: error,
  });
}

export function useDocumentsController(projectId?: string): DocumentsController {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [baseMarkdown, setBaseMarkdown] = useState("");
  const [contentHash, setContentHash] = useState("");
  const [status, setStatus] = useState<DocumentViewStatus>(projectId ? "loading" : "idle");
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const loadedProjectId = useRef<string | undefined>(undefined);
  const drafts = useRef(new Map<string, DraftSnapshot>());
  const currentDocument = useRef({
    selectedPath,
    markdown,
    baseMarkdown,
    contentHash,
  });

  const dirty = markdown !== baseMarkdown;
  useEffect(() => {
    currentDocument.current = { selectedPath, markdown, baseMarkdown, contentHash };
  }, [baseMarkdown, contentHash, markdown, selectedPath]);

  const rememberDraft = useCallback(() => {
    const current = currentDocument.current;
    if (!loadedProjectId.current || !current.selectedPath || current.markdown === current.baseMarkdown) return;
    drafts.current.set(`${loadedProjectId.current}:${current.selectedPath}`, {
      markdown: current.markdown,
      baseMarkdown: current.baseMarkdown,
      contentHash: current.contentHash,
    });
  }, []);

  const loadContent = useCallback(async (activeProjectId: string, path: string, signal?: AbortSignal) => {
    setLoadingDocument(true);
    setError(null);
    setConflict(false);
    try {
      const document = await getDocument(activeProjectId, path, signal);
      const cached = drafts.current.get(`${activeProjectId}:${path}`);
      loadedProjectId.current = activeProjectId;
      setSelectedPath(document.path);
      setMarkdown(cached?.markdown ?? document.content);
      setBaseMarkdown(cached?.baseMarkdown ?? document.content);
      setContentHash(cached?.contentHash ?? document.contentHash);
    } catch (cause) {
      if (signal?.aborted) return;
      const apiError = toApiError(cause);
      setError(apiError);
      setStatus(apiError.code === "NETWORK_ERROR" ? "unavailable" : "error");
    } finally {
      if (!signal?.aborted) setLoadingDocument(false);
    }
  }, []);

  useEffect(() => {
    rememberDraft();
    const controller = new AbortController();
    if (!projectId) {
      loadedProjectId.current = undefined;
      void Promise.resolve().then(() => {
        if (controller.signal.aborted) return;
        setItems([]);
        setSelectedPath(null);
        setMarkdown("");
        setBaseMarkdown("");
        setContentHash("");
        setStatus("idle");
        setError(null);
      });
      return () => controller.abort();
    }

    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setStatus("loading");
      setError(null);
      return listDocuments(projectId, controller.signal);
    })
      .then(async (loadedItems) => {
        if (controller.signal.aborted || !loadedItems) return;
        setItems(loadedItems);
        const firstFile = loadedItems.find((item) => item.kind === "file");
        if (!firstFile) {
          loadedProjectId.current = projectId;
          setSelectedPath(null);
          setMarkdown("");
          setBaseMarkdown("");
          setContentHash("");
          setStatus("empty");
          return;
        }
        setStatus("ready");
        await loadContent(projectId, firstFile.path, controller.signal);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const apiError = toApiError(cause);
        setError(apiError);
        setStatus(apiError.code === "NETWORK_ERROR" ? "unavailable" : "error");
      });
    return () => controller.abort();
  }, [loadContent, projectId, reloadVersion, rememberDraft]);

  const select = useCallback((path: string) => {
    if (!projectId || path === selectedPath) return;
    if (dirty && !window.confirm("В текущем документе есть несохранённые изменения. Переключить файл? Ввод останется в памяти до перезагрузки страницы.")) {
      return;
    }
    rememberDraft();
    void loadContent(projectId, path);
  }, [dirty, loadContent, projectId, rememberDraft, selectedPath]);

  const change = useCallback((nextMarkdown: string) => {
    setMarkdown(nextMarkdown);
    setConflict(false);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    const activeProjectId = loadedProjectId.current;
    if (!activeProjectId || !selectedPath || !dirty || saving) return;
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      const document = await writeDocument(activeProjectId, {
        path: selectedPath,
        content: markdown,
        baseContentHash: contentHash,
      });
      setMarkdown(document.content);
      setBaseMarkdown(document.content);
      setContentHash(document.contentHash);
      drafts.current.delete(`${activeProjectId}:${selectedPath}`);
    } catch (cause) {
      const apiError = toApiError(cause);
      setError(apiError);
      setConflict(apiError.code === "DRAFT_CONFLICT");
      throw apiError;
    } finally {
      setSaving(false);
    }
  }, [contentHash, dirty, markdown, saving, selectedPath]);

  const retry = useCallback(() => {
    const activeProjectId = loadedProjectId.current;
    if (conflict && activeProjectId && selectedPath) {
      if (!window.confirm("Загрузить актуальную версию с диска? Несохранённый текст текущего документа будет заменён.")) {
        return;
      }
      drafts.current.delete(`${activeProjectId}:${selectedPath}`);
      void loadContent(activeProjectId, selectedPath);
      return;
    }
    setReloadVersion((current) => current + 1);
  }, [conflict, loadContent, selectedPath]);

  return useMemo(() => ({
    items,
    selectedPath,
    markdown,
    status,
    loadingDocument,
    saving,
    dirty,
    conflict,
    error,
    select,
    change,
    save,
    retry,
  }), [change, conflict, dirty, error, items, loadingDocument, markdown, retry, save, saving, select, selectedPath, status]);
}
