"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import {
  cancelRepositoryClone,
  cloneEventsUrl,
  getRepositoryClone,
  listRepositories,
  startRepositoryClone,
} from "@/features/repositories/api/repositories-client";
import type { CloneOperation, RepositoryLink } from "@/features/repositories/model/repository-types";
import { isCloneTerminal, reduceCloneStatus, type CloneEventName } from "@/features/repositories/model/repository-operation";

export interface RepositoriesController {
  repositories: RepositoryLink[];
  operation: CloneOperation | null;
  loading: boolean;
  error: ApiError | null;
  startClone: (url: string) => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => void;
}

export function useRepositoriesController(projectId?: string): RepositoriesController {
  const [repositories, setRepositories] = useState<RepositoryLink[]>([]);
  const [operation, setOperation] = useState<CloneOperation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      setRepositories([]);
      return;
    }
    setLoading(true);
    try {
      setRepositories(await listRepositories(projectId, signal));
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof ApiError ? cause : new ApiError(0, { code: "UNKNOWN_ERROR", message: "Не удалось загрузить репозитории" }));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, version]);

  const operationId = operation?.id;
  const operationStatus = operation?.status;
  useEffect(() => {
    if (!projectId || !operationId || !operationStatus || isCloneTerminal(operationStatus)) return;
    const source = new EventSource(cloneEventsUrl(projectId, operationId));
    const refresh = async () => {
      try {
        const next = await getRepositoryClone(projectId, operationId);
        setOperation(next);
        if (isCloneTerminal(next.status)) {
          source.close();
          if (next.status === "failed") {
            setError(new ApiError(409, {
              code: next.errorCode || "GIT_CLONE_FAILED",
              message: next.errorMessage || "Клонирование Git-репозитория завершилось ошибкой",
              correlationId: next.correlationId,
            }));
          } else {
            setError(null);
          }
          if (next.status === "completed") await load();
        }
      } catch (cause) {
        setError(cause instanceof ApiError ? cause : new ApiError(0, {
          code: "UNKNOWN_ERROR",
          message: "Не удалось получить состояние клонирования",
        }));
      }
    };
    (["running", "progress", "validating", "completed", "cancelled", "failed"] satisfies CloneEventName[]).forEach((name) => {
      source.addEventListener(name, () => {
        setOperation((current) => current ? { ...current, status: reduceCloneStatus(current.status, name) as CloneOperation["status"] } : current);
        void refresh();
      });
    });
    source.onerror = () => { void refresh(); };
    const poll = window.setInterval(() => { void refresh(); }, 1500);
    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [load, operationId, operationStatus, projectId]);

  const startClone = useCallback(async (url: string) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      setOperation(await startRepositoryClone(projectId, { url }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError(0, { code: "UNKNOWN_ERROR", message: "Клонирование не запущено" }));
      throw cause;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const cancel = useCallback(async () => {
    if (!projectId || !operation) return;
    setOperation(await cancelRepositoryClone(projectId, operation.id));
  }, [operation, projectId]);

  return { repositories, operation, loading, error, startClone, cancel, retry: () => setVersion((value) => value + 1) };
}
