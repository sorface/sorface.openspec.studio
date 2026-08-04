"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import {
  getTaskWorkspaces,
  openTaskWorkspace,
  previewTaskPublication,
  publishTaskArtifacts,
} from "@/features/task-context/api/task-context-client";
import type {
  PublicationPreview,
  PublicationResult,
  TaskWorkspaceOverview,
} from "@/features/task-context/model/task-context-types";

export interface TaskContextController {
  overview: TaskWorkspaceOverview | null;
  status: "idle" | "loading" | "ready" | "error";
  switching: boolean;
  preparing: boolean;
  publishing: boolean;
  preview: PublicationPreview | null;
  result: PublicationResult | null;
  error: ApiError | null;
  openTask: (branch: string) => Promise<void>;
  refresh: () => void;
  preparePublication: () => Promise<void>;
  publish: (message: string, body: string) => Promise<PublicationResult>;
  dismissPublication: () => void;
  clearError: () => void;
}

function toApiError(cause: unknown, message: string): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError(0, { code: "UNKNOWN_ERROR", message, details: cause });
}

export function useTaskContextController(projectId?: string): TaskContextController {
  const [overview, setOverview] = useState<TaskWorkspaceOverview | null>(null);
  const [status, setStatus] = useState<TaskContextController["status"]>(projectId ? "loading" : "idle");
  const [switching, setSwitching] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [result, setResult] = useState<PublicationResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const mutationInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!projectId) {
      void Promise.resolve().then(() => {
        if (controller.signal.aborted) return;
        setOverview(null);
        setPreview(null);
        setResult(null);
        setError(null);
        setStatus("idle");
      });
      return () => controller.abort();
    }
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setStatus("loading");
      return getTaskWorkspaces(projectId, controller.signal);
    }).then((next) => {
      if (controller.signal.aborted) return;
      setOverview(next);
      setError(null);
      setStatus("ready");
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(toApiError(cause, "Не удалось загрузить задачи"));
      setStatus("error");
    });
    return () => controller.abort();
  }, [projectId, reloadVersion]);

  const openTask = useCallback(async (branch: string) => {
    const normalized = branch.trim();
    if (!projectId || !normalized || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setSwitching(true);
    setError(null);
    setPreview(null);
    try {
      setOverview(await openTaskWorkspace(projectId, normalized));
      setResult(null);
      setStatus("ready");
    } catch (cause) {
      const next = toApiError(cause, "Не удалось открыть задачу");
      setError(next);
      throw next;
    } finally {
      mutationInFlight.current = false;
      setSwitching(false);
    }
  }, [projectId]);

  const refresh = useCallback(() => setReloadVersion((current) => current + 1), []);

  const preparePublication = useCallback(async () => {
    if (!projectId || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setPreparing(true);
    setError(null);
    try {
      setPreview(await previewTaskPublication(projectId));
    } catch (cause) {
      const next = toApiError(cause, "Не удалось подготовить публикацию");
      setError(next);
      throw next;
    } finally {
      mutationInFlight.current = false;
      setPreparing(false);
    }
  }, [projectId]);

  const publish = useCallback(async (message: string, body: string) => {
    if (!projectId || !preview || mutationInFlight.current) {
      throw new ApiError(409, { code: "PUBLICATION_UNAVAILABLE", message: "Публикация уже изменилась" });
    }
    mutationInFlight.current = true;
    setPublishing(true);
    setError(null);
    try {
      const next = await publishTaskArtifacts(projectId, {
        token: preview.token,
        message: message.trim() || undefined,
        body: body.trim() || undefined,
      });
      setResult(next);
      setPreview(null);
      setReloadVersion((current) => current + 1);
      return next;
    } catch (cause) {
      const next = toApiError(cause, "Не удалось опубликовать артефакты");
      setError(next);
      throw next;
    } finally {
      mutationInFlight.current = false;
      setPublishing(false);
    }
  }, [preview, projectId]);

  const dismissPublication = useCallback(() => {
    if (!publishing) setPreview(null);
  }, [publishing]);
  const clearError = useCallback(() => setError(null), []);

  return useMemo(() => ({
    overview,
    status,
    switching,
    preparing,
    publishing,
    preview,
    result,
    error,
    openTask,
    refresh,
    preparePublication,
    publish,
    dismissPublication,
    clearError,
  }), [clearError, dismissPublication, error, openTask, overview, preparePublication, preparing, preview, publish, publishing, refresh, result, status, switching]);
}
