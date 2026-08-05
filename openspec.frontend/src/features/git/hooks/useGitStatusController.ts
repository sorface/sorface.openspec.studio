"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import {
  cancelGitOperation, createGitBranch, createGitCommit, getGitOperation, getGitStatus,
  stageGitPaths, startGitFetch, startGitPush, switchGitBranch, unstageGitPaths,
} from "@/features/git/api/git-client";
import { isGitOperationTerminal, type GitOperation } from "@/features/git/model/git-operation";
import type { GitStatus } from "@/features/git/model/git-types";

export interface GitStatusController {
  status: GitStatus | null;
  loading: boolean;
  error: ApiError | null;
  mutationPending: boolean;
  operation: GitOperation | null;
  refresh: () => void;
  stage: (paths: string[]) => Promise<boolean>;
  unstage: (paths: string[]) => Promise<boolean>;
  commit: (message: string, paths: string[]) => Promise<boolean>;
  createBranch: (name: string) => Promise<boolean>;
  switchBranch: (branch: string) => Promise<boolean>;
  trackRemoteBranch: (remoteBranch: string, localBranch: string) => Promise<boolean>;
  fetch: (remote: string) => Promise<boolean>;
  push: (remote?: string, targetBranch?: string) => Promise<boolean>;
  cancelOperation: () => Promise<void>;
}

export function useGitStatusController(projectId?: string, enabled = false): GitStatusController {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);
  const [mutationPending, setMutationPending] = useState(false);
  const [operation, setOperation] = useState<GitOperation | null>(null);

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

  useEffect(() => {
    if (!projectId || !operation || isGitOperationTerminal(operation.status)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void getGitOperation(projectId, operation.id, controller.signal).then((next) => {
        setOperation(next);
        if (isGitOperationTerminal(next.status)) setVersion((value) => value + 1);
      }).catch((cause) => {
        if (!controller.signal.aborted) setError(toApiError(cause));
      });
    }, 700);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [operation, projectId]);

  const mutateStatus = useCallback(async (action: () => Promise<GitStatus>): Promise<boolean> => {
    setMutationPending(true);
    try {
      setStatus(await action());
      setError(null);
      return true;
    } catch (cause) {
      setError(toApiError(cause));
      return false;
    } finally {
      setMutationPending(false);
    }
  }, []);

  const startOperation = useCallback(async (action: () => Promise<GitOperation>): Promise<boolean> => {
    setMutationPending(true);
    try {
      setOperation(await action());
      setError(null);
      return true;
    } catch (cause) {
      setError(toApiError(cause));
      return false;
    } finally {
      setMutationPending(false);
    }
  }, []);

  return {
    status, loading, error, mutationPending, operation,
    refresh: () => setVersion((value) => value + 1),
    stage: (paths) => projectId ? mutateStatus(() => stageGitPaths(projectId, paths)) : Promise.resolve(false),
    unstage: (paths) => projectId ? mutateStatus(() => unstageGitPaths(projectId, paths)) : Promise.resolve(false),
    commit: (message, paths) => projectId && status
      ? mutateStatus(() => createGitCommit(projectId, message, paths, status.head)) : Promise.resolve(false),
    createBranch: (name) => projectId ? mutateStatus(() => createGitBranch(projectId, name)) : Promise.resolve(false),
    switchBranch: (branch) => projectId ? mutateStatus(() => switchGitBranch(projectId, { branch })) : Promise.resolve(false),
    trackRemoteBranch: (remoteBranch, localBranch) => projectId
      ? mutateStatus(() => switchGitBranch(projectId, { remoteBranch, localBranch })) : Promise.resolve(false),
    fetch: (remote) => projectId ? startOperation(() => startGitFetch(projectId, remote)) : Promise.resolve(false),
    push: (remote, targetBranch) => projectId
      ? startOperation(() => startGitPush(projectId, remote, targetBranch)) : Promise.resolve(false),
    cancelOperation: async () => {
      if (projectId && operation && !isGitOperationTerminal(operation.status)) {
        setOperation(await cancelGitOperation(projectId, operation.id));
      }
    },
  };
}

function toApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError(0, { code: "UNKNOWN_ERROR", message: "Git-операция не выполнена" });
}
