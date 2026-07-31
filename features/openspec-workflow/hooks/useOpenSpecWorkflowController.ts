"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import {
  acceptOpenSpecOperation,
  cancelOpenSpecOperation,
  deleteOpenSpecChange,
  getOpenSpecChange,
  getOpenSpecOperation,
  getOpenSpecOverview,
  openSpecEventsUrl,
  rejectOpenSpecOperation,
  startOpenSpecAction,
  validateOpenSpec,
  writeOpenSpecDraft,
} from "@/features/openspec-workflow/api/openspec-client";
import {
  isOpenSpecOperationTerminal,
  openSpecViewStatus,
  reduceOpenSpecOperationStatus,
} from "@/features/openspec-workflow/model/openspec-state";
import {
  actionMatchesDocument,
  changeFromDocumentPath,
} from "@/features/openspec-workflow/model/openspec-document-action";
import type {
  OpenSpecAction,
  OpenSpecActionResult,
  OpenSpecChangeDetails,
  OpenSpecDraftSet,
  OpenSpecOperation,
  OpenSpecOverview,
  OpenSpecValidation,
  OpenSpecValidationStatus,
  OpenSpecViewStatus,
  StartOpenSpecActionInput,
} from "@/features/openspec-workflow/model/openspec-types";

export interface OpenSpecWorkflowController {
  overview: OpenSpecOverview | null;
  details: OpenSpecChangeDetails | null;
  selectedChange: string;
  validation: OpenSpecValidation | null;
  validationStatus: OpenSpecValidationStatus;
  operation: OpenSpecOperation | null;
  result: OpenSpecActionResult | null;
  draft: OpenSpecDraftSet | null;
  status: OpenSpecViewStatus;
  detailsLoading: boolean;
  pending: boolean;
  operationProgress: string;
  operationActivity: string[];
  operationElapsedSeconds: number;
  error: ApiError | null;
  agentAvailable: boolean;
  selectChange: (change: string) => void;
  refresh: () => void;
  validate: (all?: boolean) => Promise<void>;
  explore: (goal: string) => Promise<void>;
  createChange: (change: string, goal: string, exploration: string) => Promise<void>;
  editDocument: (path: string, selection: string, instruction: string) => Promise<void>;
  deleteChange: (confirmation: string) => Promise<void>;
  runAction: (action: OpenSpecAction, goal: string) => Promise<void>;
  cancel: () => Promise<void>;
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  write: () => Promise<void>;
  resetOperation: () => void;
}

function toApiError(cause: unknown, fallback: string): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError(0, { code: "UNKNOWN_ERROR", message: fallback, details: cause });
}

function parseResult(operation: OpenSpecOperation | null): OpenSpecActionResult | null {
  if (!operation?.result) return null;
  try {
    return JSON.parse(operation.result) as OpenSpecActionResult;
  } catch {
    return null;
  }
}

function appendOperationActivity(current: string[], message: string): string[] {
  const normalized = message.trim();
  if (!normalized || current.at(-1) === normalized) return current;
  return [...current, normalized].slice(-6);
}

export function useOpenSpecWorkflowController(
  projectId?: string,
  provider?: string,
  model?: string,
  agentAvailable = false,
  onStoreChanged?: () => void,
): OpenSpecWorkflowController {
  const [overview, setOverview] = useState<OpenSpecOverview | null>(null);
  const [details, setDetails] = useState<OpenSpecChangeDetails | null>(null);
  const [selectedChange, setSelectedChange] = useState("");
  const [validation, setValidation] = useState<OpenSpecValidation | null>(null);
  const [validationStatus, setValidationStatus] = useState<OpenSpecValidationStatus>("idle");
  const [operation, setOperation] = useState<OpenSpecOperation | null>(null);
  const [draft, setDraft] = useState<OpenSpecDraftSet | null>(null);
  const [status, setStatus] = useState<OpenSpecViewStatus>(projectId ? "loading" : "idle");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [operationProgress, setOperationProgress] = useState("");
  const [operationActivity, setOperationActivity] = useState<string[]>([]);
  const [operationElapsedSeconds, setOperationElapsedSeconds] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const operationStartInFlight = useRef(false);

  useEffect(() => {
    if (!projectId) {
      const timer = window.setTimeout(() => {
        setOverview(null);
        setDetails(null);
        setSelectedChange("");
        setValidation(null);
        setValidationStatus("idle");
        setOperation(null);
        setDraft(null);
        setOperationProgress("");
        setOperationActivity([]);
        setOperationElapsedSeconds(0);
        setError(null);
        setStatus("idle");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const resetTimer = window.setTimeout(() => {
      setOverview(null);
      setDetails(null);
      setValidation(null);
      setValidationStatus("idle");
      setOperation(null);
      setDraft(null);
      setOperationProgress("");
      setOperationActivity([]);
      setOperationElapsedSeconds(0);
      setError(null);
      setStatus("loading");
    }, 0);
    getOpenSpecOverview(projectId, controller.signal)
      .then((next) => {
        setOverview(next);
        setStatus(next.changes.length ? "ready" : "empty");
        setSelectedChange((current) =>
          current && next.changes.some((change) => change.name === current)
            ? current
            : next.changes[0]?.name ?? "");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const nextError = toApiError(cause, "OpenSpec не загружен");
        setError(nextError);
        setStatus(openSpecViewStatus(nextError.code));
      });
    return () => {
      window.clearTimeout(resetTimer);
      controller.abort();
    };
  }, [projectId, reloadVersion]);

  useEffect(() => {
    if (!projectId || !selectedChange) {
      const timer = window.setTimeout(() => setDetails(null), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => setDetailsLoading(true), 0);
    getOpenSpecChange(projectId, selectedChange, controller.signal)
      .then((next) => {
        setDetails(next);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const nextError = toApiError(cause, "Change не загружен");
        setError(nextError);
        setStatus(openSpecViewStatus(nextError.code));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailsLoading(false);
      });
    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [projectId, selectedChange, reloadVersion]);

  const refresh = useCallback(() => {
    setError(null);
    setValidation(null);
    setValidationStatus("idle");
    setReloadVersion((current) => current + 1);
  }, []);

  const execute = useCallback(async (input: StartOpenSpecActionInput) => {
    if (!projectId || operationStartInFlight.current) return;
    operationStartInFlight.current = true;
    setPending(true);
    setError(null);
    setValidation(null);
    setValidationStatus("idle");
    setDraft(null);
    const initialProgress = "Подготавливаем безопасный контекст…";
    setOperationProgress(initialProgress);
    setOperationActivity([initialProgress]);
    setOperationElapsedSeconds(0);
    try {
      setOperation(await startOpenSpecAction(projectId, input));
    } catch (cause) {
      const nextError = toApiError(cause, "OpenSpec-операция не запущена");
      setError(nextError);
      if (nextError.code === "OPENSPEC_STATUS_STALE") {
        setStatus("stale");
        setReloadVersion((current) => current + 1);
      }
      setOperationProgress("");
      setOperationActivity([]);
      throw nextError;
    } finally {
      operationStartInFlight.current = false;
      setPending(false);
    }
  }, [projectId]);

  const explore = useCallback(async (goal: string) => {
    await execute({
      kind: "explore",
      goal,
      provider,
      model,
    });
  }, [execute, model, provider]);

  const createChange = useCallback(async (change: string, goal: string, exploration: string) => {
    const handoff = [
      `Исходная задача аналитика:\n${goal}`,
      exploration.trim() ? `Результат обязательного explore:\n${exploration.trim()}` : "",
      "Создай change с указанным именем и последовательно подготовь proposal.md и начальные delta specs на основе исследования. Не расширяй scope неявно.",
    ].filter(Boolean).join("\n\n");
    await execute({
      kind: "create_change",
      change,
      goal: handoff,
      provider,
      model,
    });
  }, [execute, model, provider]);

  const editDocument = useCallback(async (path: string, selection: string, instruction: string) => {
    const change = changeFromDocumentPath(path);
    if (!projectId || !provider || !change) {
      throw new ApiError(400, {
        code: "OPENSPEC_DOCUMENT_ACTION_UNAVAILABLE",
        message: "Agent доступен только для Markdown-артефактов активного OpenSpec change",
      });
    }
    setPending(true);
    setError(null);
    let current: OpenSpecChangeDetails;
    try {
      current = await getOpenSpecChange(projectId, change);
      setSelectedChange(change);
      setDetails(current);
    } catch (cause) {
      const nextError = toApiError(cause, "Не удалось определить OpenSpec-артефакт");
      setError(nextError);
      throw nextError;
    } finally {
      setPending(false);
    }
    const action = current.actions.find((candidate) =>
      candidate.available && !!candidate.artifact && actionMatchesDocument(candidate, path),
    );
    if (!action?.artifact) {
      const nextError = new ApiError(409, {
        code: "OPENSPEC_DOCUMENT_ACTION_UNAVAILABLE",
        message: "Для выбранного файла сейчас нет доступного действия OpenSpec",
      });
      setError(nextError);
      throw nextError;
    }
    const goal = [
      "Отредактируй текущий артефакт OpenSpec по инструкции аналитика.",
      `Активный файл: ${path}`,
      selection.trim() ? `Выделенный фрагмент:\n${selection.trim()}` : "",
      `Инструкция аналитика:\n${instruction.trim()}`,
      "Сохрани остальной смысл документа и не изменяй файлы за пределами разрешённого артефакта.",
    ].filter(Boolean).join("\n\n");
    await execute({
      kind: "fix_artifact",
      change,
      artifact: action.artifact,
      goal,
      provider,
      model,
      statusFingerprint: current.fingerprint,
    });
  }, [execute, model, projectId, provider]);

  const runAction = useCallback(async (action: OpenSpecAction, goal: string) => {
    if (!details || !action.available) return;
    await execute({
      kind: action.kind,
      change: details.summary.name,
      artifact: action.artifact,
      goal: action.kind === "archive" ? undefined : goal,
      provider: action.kind === "archive" ? undefined : provider,
      model: action.kind === "archive" ? undefined : model,
      statusFingerprint: details.fingerprint,
    });
  }, [details, execute, model, provider]);

  const deleteChange = useCallback(async (confirmation: string) => {
    if (!projectId || !details) return;
    setPending(true);
    setError(null);
    try {
      const deletedName = details.summary.name;
      await deleteOpenSpecChange(projectId, deletedName, {
        confirmation,
        statusFingerprint: details.fingerprint,
      });
      setDetails(null);
      setSelectedChange("");
      setValidation(null);
      setValidationStatus("idle");
      setOperation(null);
      setDraft(null);
      setOverview((current) => current
        ? { ...current, changes: current.changes.filter((change) => change.name !== deletedName) }
        : current);
      setReloadVersion((current) => current + 1);
      onStoreChanged?.();
    } catch (cause) {
      const nextError = toApiError(cause, "Change не удалён");
      setError(nextError);
      if (nextError.code === "OPENSPEC_STATUS_STALE") {
        setStatus("stale");
        setReloadVersion((current) => current + 1);
      }
      throw nextError;
    } finally {
      setPending(false);
    }
  }, [details, onStoreChanged, projectId]);

  const operationId = operation?.id;
  const operationStatus = operation?.status;
  const operationCreatedAt = operation?.createdAt;
  useEffect(() => {
    if (!operationId || !operationStatus || isOpenSpecOperationTerminal(operationStatus)) return;
    const parsedStart = operationCreatedAt ? Date.parse(operationCreatedAt) : Number.NaN;
    const startedAt = Number.isFinite(parsedStart) ? parsedStart : Date.now();
    const updateElapsed = () => {
      setOperationElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [operationCreatedAt, operationId, operationStatus]);

  useEffect(() => {
    if (!projectId || !operationId || !operationStatus ||
        isOpenSpecOperationTerminal(operationStatus)) return;
    const source = new EventSource(openSpecEventsUrl(projectId, operationId));
    const refreshOperation = async () => {
      try {
        setOperation(await getOpenSpecOperation(projectId, operationId));
      } catch (cause) {
        setError(toApiError(cause, "Статус операции недоступен"));
      }
    };
    ["running", "provider_event", "provider_diagnostic", "validating",
      "awaiting_review", "cancelled", "failed"].forEach((name) => {
      source.addEventListener(name, (event) => {
        setOperation((current) => current
          ? { ...current, status: reduceOpenSpecOperationStatus(current.status, name) }
          : current);
        if (name === "running") {
          const message = "Agent начал исследование…";
          setOperationProgress(message);
          setOperationActivity((current) => appendOperationActivity(current, message));
        }
        if (name === "provider_event") {
          let message = "Agent продолжает исследование…";
          try {
            const payload = JSON.parse((event as MessageEvent<string>).data) as { message?: string };
            message = payload.message?.trim() || message;
          } catch {}
          setOperationProgress(message);
          setOperationActivity((current) => appendOperationActivity(current, message));
        }
        if (name === "validating") {
          const message = "Проверяем, что Store не изменён…";
          setOperationProgress(message);
          setOperationActivity((current) => appendOperationActivity(current, message));
        }
        void refreshOperation();
      });
    });
    source.onerror = () => { void refreshOperation(); };
    const poll = window.setInterval(() => { void refreshOperation(); }, 1500);
    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [operationId, operationStatus, projectId]);

  const validate = useCallback(async (all = false) => {
    if (!projectId) return;
    setValidationStatus("checking");
    setError(null);
    try {
      const next = await validateOpenSpec(projectId, all ? undefined : selectedChange || undefined);
      setValidation(next);
      setValidationStatus(next.valid ? "valid" : "invalid");
    } catch (cause) {
      setError(toApiError(cause, "Проверка OpenSpec не выполнена"));
      setValidationStatus("error");
    }
  }, [projectId, selectedChange]);

  useEffect(() => {
    if (!projectId || !selectedChange || !details?.fingerprint) return;
    const timer = window.setTimeout(() => { void validate(false); }, 0);
    return () => { window.clearTimeout(timer); };
  }, [details?.fingerprint, projectId, selectedChange, validate]);

  const cancel = useCallback(async () => {
    if (!projectId || !operation) return;
    const message = "Останавливаем исследование…";
    setOperationProgress(message);
    setOperationActivity((current) => appendOperationActivity(current, message));
    setOperation(await cancelOpenSpecOperation(projectId, operation.id));
  }, [operation, projectId]);

  const accept = useCallback(async () => {
    if (!projectId || operation?.status !== "awaiting_review") return;
    setPending(true);
    try {
      setDraft(await acceptOpenSpecOperation(projectId, operation.id));
      setOperation((current) => current ? { ...current, status: "accepted" } : current);
    } catch (cause) {
      setError(toApiError(cause, "Результат не принят"));
    } finally {
      setPending(false);
    }
  }, [operation, projectId]);

  const reject = useCallback(async () => {
    if (!projectId || operation?.status !== "awaiting_review") return;
    setOperation(await rejectOpenSpecOperation(projectId, operation.id));
    setDraft(null);
  }, [operation, projectId]);

  const write = useCallback(async () => {
    if (!projectId || !draft) return;
    setPending(true);
    try {
      setDraft(await writeOpenSpecDraft(projectId, draft.id));
      if (operation?.openspecAction === "create_change" && operation.openspecChange) {
        setSelectedChange(operation.openspecChange);
      }
      setValidation(null);
      setValidationStatus("idle");
      setReloadVersion((current) => current + 1);
      onStoreChanged?.();
    } catch (cause) {
      setError(toApiError(cause, "Draft не записан в Store"));
    } finally {
      setPending(false);
    }
  }, [draft, onStoreChanged, operation, projectId]);

  const selectChange = useCallback((change: string) => {
    setSelectedChange(change);
    setValidation(null);
    setValidationStatus("idle");
  }, []);

  const resetOperation = useCallback(() => {
    setOperation(null);
    setDraft(null);
    setOperationProgress("");
    setOperationActivity([]);
    setOperationElapsedSeconds(0);
    setError(null);
  }, []);

  return {
    overview,
    details,
    selectedChange,
    validation,
    validationStatus,
    operation,
    result: useMemo(() => parseResult(operation), [operation]),
    draft,
    status,
    detailsLoading,
    pending,
    operationProgress,
    operationActivity,
    operationElapsedSeconds,
    error,
    agentAvailable,
    selectChange,
    refresh,
    validate,
    explore,
    createChange,
    editDocument,
    deleteChange,
    runAction,
    cancel,
    accept,
    reject,
    write,
    resetOperation,
  };
}
