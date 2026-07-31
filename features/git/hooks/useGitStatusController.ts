"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import { getGitStatus } from "@/features/git/api/git-client";
import type { GitStatus } from "@/features/git/model/git-types";

export interface GitStatusController {
  status: GitStatus | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => void;
}

export function useGitStatusController(projectId?: string, enabled = false): GitStatusController {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!projectId || !enabled) {
      setStatus(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      setStatus(await getGitStatus(projectId, signal));
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof ApiError
        ? cause
        : new ApiError(0, { code: "UNKNOWN_ERROR", message: "Не удалось получить Git status" }));
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, version]);

  return { status, loading, error, refresh: () => setVersion((value) => value + 1) };
}
