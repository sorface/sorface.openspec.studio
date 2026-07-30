"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import {
  aiEventsUrl,
  cancelAiOperation,
  createAiOperation,
  createContextManifest,
  getAiOperation,
} from "@/features/ai-operations/api/ai-client";
import type { AiOperation, AiResult, ContextManifest } from "@/features/ai-operations/model/ai-types";
import { isAiTerminal, reduceAiStatus, type AiEventName } from "@/features/ai-operations/model/ai-operation-state";

export interface AiOperationsController {
  manifest: ContextManifest | null;
  operation: AiOperation | null;
  result: AiResult | null;
  error: ApiError | null;
  pending: boolean;
  reviewContext: () => Promise<void>;
  send: (prompt: string) => Promise<void>;
  cancel: () => Promise<void>;
}

export function useAiOperationsController(
  projectId?: string,
  provider = "codex",
  model?: string,
): AiOperationsController {
  const [manifest, setManifest] = useState<ContextManifest | null>(null);
  const [operation, setOperation] = useState<AiOperation | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setManifest(null);
      setOperation(null);
      setError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [projectId]);

  const reviewContext = useCallback(async () => {
    if (!projectId) return;
    setPending(true);
    try {
      setManifest(await createContextManifest(projectId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError(0, { code: "UNKNOWN_ERROR", message: "Контекст не подготовлен" }));
    } finally {
      setPending(false);
    }
  }, [projectId]);

  const send = useCallback(async (prompt: string) => {
    if (!projectId || !manifest) return;
    setPending(true);
    setError(null);
    try {
      const next = await createAiOperation(projectId, {
        reviewToken: manifest.reviewToken, prompt, provider, model,
      });
      setOperation(next);
      setManifest(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError(0, { code: "UNKNOWN_ERROR", message: "AI-операция не запущена" }));
      throw cause;
    } finally {
      setPending(false);
    }
  }, [manifest, model, projectId, provider]);

  const operationId = operation?.id;
  const operationStatus = operation?.status;
  useEffect(() => {
    if (!projectId || !operationId || !operationStatus || isAiTerminal(operationStatus)) return;
    const source = new EventSource(aiEventsUrl(projectId, operationId));
    const refresh = async () => setOperation(await getAiOperation(projectId, operationId));
    (["running", "provider_event", "provider_diagnostic", "validating", "awaiting_review", "cancelled", "failed"] satisfies AiEventName[]).forEach((name) => {
      source.addEventListener(name, () => {
        setOperation((current) => current ? { ...current, status: reduceAiStatus(current.status, name) as AiOperation["status"] } : current);
        void refresh();
      });
    });
    source.onerror = () => { void refresh(); };
    const poll = window.setInterval(() => { void refresh(); }, 1500);
    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [operationId, operationStatus, projectId]);

  const cancel = useCallback(async () => {
    if (!projectId || !operation) return;
    setOperation(await cancelAiOperation(projectId, operation.id));
  }, [operation, projectId]);

  const result = (() => {
    if (!operation?.result) return null;
    try {
      return JSON.parse(operation.result) as AiResult;
    } catch {
      return null;
    }
  })();

  return { manifest, operation, result, error, pending, reviewContext, send, cancel };
}
