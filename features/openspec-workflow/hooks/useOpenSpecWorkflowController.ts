"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/features/api/api-client";
import {
  acceptOpenSpecOperation,
  cancelOpenSpecOperation,
  deleteOpenSpecChange,
  getOpenSpecChange,
  getOpenSpecOperation,
  getOpenSpecOperations,
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
  advanceOpenSpecArtifactRefreshCascade,
  bindOpenSpecArtifactRefreshOperation,
  createOpenSpecArtifactRefreshCascade,
  interruptOpenSpecArtifactRefreshCascade,
  openSpecArtifactRefreshActionArtifact,
  openSpecArtifactRefreshCascadeGoal,
  openSpecArtifactRefreshMatchesOperation,
  resumeOpenSpecArtifactRefreshCascade,
  type OpenSpecArtifactRefreshCascade,
} from "@/features/openspec-workflow/model/artifact-refresh-cascade";
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
  operations: OpenSpecOperation[];
  operationsLoading: boolean;
  operationsPanelOpen: boolean;
  operationDialogOpen: boolean;
  result: OpenSpecActionResult | null;
  draft: OpenSpecDraftSet | null;
  status: OpenSpecViewStatus;
  detailsLoading: boolean;
  pending: boolean;
  operationProgress: string;
  operationActivity: string[];
  operationElapsedSeconds: number;
  artifactRefresh: OpenSpecArtifactRefreshCascade | null;
  error: ApiError | null;
  agentAvailable: boolean;
  selectChange: (change: string) => void;
  selectOperation: (operation: OpenSpecOperation) => void;
  setOperationsPanelOpen: (open: boolean) => void;
  setOperationDialogOpen: (open: boolean) => void;
  refresh: () => void;
  validate: (all?: boolean) => Promise<void>;
  explore: (goal: string) => Promise<void>;
  createChange: (change: string, proposal: string) => Promise<void>;
  deleteChange: (confirmation: string) => Promise<void>;
  runAction: (action: OpenSpecAction, goal: string) => Promise<void>;
  runArtifactAction: (change: string, artifact: string, goal: string) => Promise<OpenSpecOperation | undefined>;
  startArtifactRefresh: (change: string, specsArtifact: string, includeTasks: boolean, proposalGuidance?: string) => Promise<void>;
  retryArtifactRefresh: () => Promise<void>;
  cancel: () => Promise<void>;
  accept: () => Promise<boolean>;
  reject: () => Promise<void>;
  write: () => Promise<boolean>;
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

function upsertOperation(current: OpenSpecOperation[], item: OpenSpecOperation): OpenSpecOperation[] {
  return [item, ...current.filter((candidate) => candidate.id !== item.id)]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function useOpenSpecWorkflowController(
  projectId?: string,
  provider?: string,
  model?: string,
  agentAvailable = false,
  onStoreChanged?: (operation?: OpenSpecOperation) => void,
  workspaceContext = "",
): OpenSpecWorkflowController {
  const [overview, setOverview] = useState<OpenSpecOverview | null>(null);
  const [details, setDetails] = useState<OpenSpecChangeDetails | null>(null);
  const [selectedChange, setSelectedChange] = useState("");
  const [validation, setValidation] = useState<OpenSpecValidation | null>(null);
  const [validationStatus, setValidationStatus] = useState<OpenSpecValidationStatus>("idle");
  const [operation, setOperation] = useState<OpenSpecOperation | null>(null);
  const [operations, setOperations] = useState<OpenSpecOperation[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsPanelOpen, setOperationsPanelOpen] = useState(true);
  const [operationDialogOpen, setOperationDialogOpen] = useState(false);
  const [draft, setDraft] = useState<OpenSpecDraftSet | null>(null);
  const [status, setStatus] = useState<OpenSpecViewStatus>(projectId ? "loading" : "idle");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [operationProgress, setOperationProgress] = useState("");
  const [operationActivity, setOperationActivity] = useState<string[]>([]);
  const [operationElapsedSeconds, setOperationElapsedSeconds] = useState(0);
  const [artifactRefresh, setArtifactRefresh] = useState<OpenSpecArtifactRefreshCascade | null>(null);
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
        setOperations([]);
        setDraft(null);
        setOperationProgress("");
        setOperationActivity([]);
        setOperationElapsedSeconds(0);
        setArtifactRefresh(null);
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
      setOperations([]);
      setDraft(null);
      setOperationsPanelOpen(true);
      setOperationDialogOpen(false);
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
  }, [projectId, reloadVersion, workspaceContext]);

  useEffect(() => {
    const timer = window.setTimeout(() => setArtifactRefresh(null), 0);
    return () => window.clearTimeout(timer);
  }, [projectId, workspaceContext]);

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
  }, [projectId, selectedChange, reloadVersion, workspaceContext]);

  useEffect(() => {
    if (!projectId || !selectedChange) {
      const timer = window.setTimeout(() => setOperations([]), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => setOperationsLoading(true), 0);
    getOpenSpecOperations(projectId, selectedChange, controller.signal)
      .then(({ items }) => {
        setOperations(items);
        setOperation((current) => current?.openspecChange === selectedChange ? current : items[0] ?? null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(toApiError(cause, "История операций недоступна"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setOperationsLoading(false);
      });
    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [projectId, selectedChange, reloadVersion, workspaceContext]);

  const refresh = useCallback(() => {
    setError(null);
    setValidation(null);
    setValidationStatus("idle");
    setReloadVersion((current) => current + 1);
  }, []);

  const execute = useCallback(async (input: StartOpenSpecActionInput): Promise<OpenSpecOperation | undefined> => {
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
      const next = await startOpenSpecAction(projectId, input);
      setOperation(next);
      setOperations((current) => upsertOperation(current, next));
      setOperationsPanelOpen(true);
      setOperationDialogOpen(false);
      return next;
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

  const createChange = useCallback(async (change: string, proposal: string) => {
    await execute({
      kind: "create_change",
      change,
      proposal,
    });
  }, [execute]);

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

  const runArtifactAction = useCallback(async (change: string, artifact: string, goal: string) => {
    if (!projectId) return;
    setPending(true);
    setError(null);
    let latest: OpenSpecChangeDetails;
    try {
      latest = await getOpenSpecChange(projectId, change);
      setSelectedChange(change);
      setDetails(latest);
    } catch (cause) {
      const nextError = toApiError(cause, "Change не загружен");
      setError(nextError);
      throw nextError;
    } finally {
      setPending(false);
    }
    const action = latest.actions.find((candidate) =>
      candidate.artifact === artifact &&
      (candidate.kind === "prepare_artifact" || candidate.kind === "fix_artifact"),
    );
    if (!action?.available) {
      const nextError = new ApiError(409, {
        code: "OPENSPEC_ACTION_BLOCKED",
        message: action?.reason || "Действие для артефакта сейчас недоступно",
      });
      setError(nextError);
      throw nextError;
    }
    return execute({
      kind: action.kind,
      change,
      artifact,
      goal,
      provider,
      model,
      statusFingerprint: latest.fingerprint,
    });
  }, [execute, model, projectId, provider]);

  const startArtifactRefresh = useCallback(async (change: string, specsArtifact: string, includeTasks: boolean, proposalGuidance = "") => {
    const initial = createOpenSpecArtifactRefreshCascade(change, specsArtifact, includeTasks, proposalGuidance);
    setArtifactRefresh(initial);
    try {
      const nextOperation = await runArtifactAction(
        change,
        openSpecArtifactRefreshActionArtifact(initial),
        openSpecArtifactRefreshCascadeGoal(initial),
      );
      if (!nextOperation) {
        setArtifactRefresh((current) => current?.status === "active"
          ? interruptOpenSpecArtifactRefreshCascade(current, "Операция обновления specs не запущена")
          : current);
        return;
      }
      setArtifactRefresh((current) => current?.status === "active" && current.change === change
        ? bindOpenSpecArtifactRefreshOperation(current, nextOperation.id)
        : current);
    } catch (cause) {
      setArtifactRefresh((current) => current?.status === "active" && current.change === change
        ? interruptOpenSpecArtifactRefreshCascade(
          current,
          cause instanceof Error ? cause.message : "Каскад не запущен",
        )
        : current);
      throw cause;
    }
  }, [runArtifactAction]);

  const retryArtifactRefresh = useCallback(async () => {
    if (!artifactRefresh || artifactRefresh.status !== "interrupted") return;
    const resumed = resumeOpenSpecArtifactRefreshCascade(artifactRefresh);
    setArtifactRefresh(resumed);
    try {
      const nextOperation = await runArtifactAction(
        resumed.change,
        openSpecArtifactRefreshActionArtifact(resumed),
        openSpecArtifactRefreshCascadeGoal(resumed),
      );
      setArtifactRefresh((current) => current?.status === "active" && current.current === resumed.current
        ? bindOpenSpecArtifactRefreshOperation(current, nextOperation?.id)
        : current);
    } catch (cause) {
      setArtifactRefresh((current) => current?.status === "active" && current.current === resumed.current
        ? interruptOpenSpecArtifactRefreshCascade(
          current,
          cause instanceof Error ? cause.message : "Повторный запуск этапа не выполнен",
        )
        : current);
    }
  }, [artifactRefresh, runArtifactAction]);

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
        const next = await getOpenSpecOperation(projectId, operationId);
        setOperation(next);
        setOperations((current) => upsertOperation(current, next));
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
        if (name === "awaiting_review") setOperationDialogOpen(true);
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
    const next = await cancelOpenSpecOperation(projectId, operation.id);
    setOperation(next);
    setOperations((current) => upsertOperation(current, next));
    setArtifactRefresh((current) => openSpecArtifactRefreshMatchesOperation(current, {
      id: operation.id,
      change: operation.openspecChange,
      artifact: operation.openspecArtifact,
    }) ? interruptOpenSpecArtifactRefreshCascade(current!, "Операция отменена пользователем") : current);
  }, [operation, projectId]);

  const accept = useCallback(async () => {
    if (!projectId || operation?.status !== "awaiting_review") return false;
    setPending(true);
    try {
      setDraft(await acceptOpenSpecOperation(projectId, operation.id));
      setOperation((current) => current ? { ...current, status: "accepted" } : current);
      setOperations((current) => operation
        ? upsertOperation(current, { ...operation, status: "accepted" })
        : current);
      return true;
    } catch (cause) {
      setError(toApiError(cause, "Результат не принят"));
      return false;
    } finally {
      setPending(false);
    }
  }, [operation, projectId]);

  const reject = useCallback(async () => {
    if (!projectId || operation?.status !== "awaiting_review") return;
    const next = await rejectOpenSpecOperation(projectId, operation.id);
    setOperation(next);
    setOperations((current) => upsertOperation(current, next));
    setDraft(null);
    setArtifactRefresh((current) => openSpecArtifactRefreshMatchesOperation(current, {
      id: operation.id,
      change: operation.openspecChange,
      artifact: operation.openspecArtifact,
    }) ? interruptOpenSpecArtifactRefreshCascade(current!, "Результат текущего этапа отклонён") : current);
  }, [operation, projectId]);

  const write = useCallback(async () => {
    if (!projectId || !draft) return false;
    setPending(true);
    try {
      const writtenDraft = await writeOpenSpecDraft(projectId, draft.id);
      setDraft(writtenDraft);
      if (operation?.openspecAction === "create_change" && operation.openspecChange) {
        setSelectedChange(operation.openspecChange);
      }
      setValidation(null);
      setValidationStatus("idle");
      onStoreChanged?.(operation ?? undefined);
      const refreshForWrite = artifactRefresh?.status === "interrupted"
        ? resumeOpenSpecArtifactRefreshCascade(artifactRefresh)
        : artifactRefresh;
      const advancesArtifactRefresh = openSpecArtifactRefreshMatchesOperation(refreshForWrite, {
        id: operation?.id,
        change: operation?.openspecChange,
        artifact: operation?.openspecArtifact,
      }, true);
      if (advancesArtifactRefresh) {
        const nextCascade = advanceOpenSpecArtifactRefreshCascade(refreshForWrite!);
        setArtifactRefresh(nextCascade);
        if (nextCascade.status === "active") {
          try {
            const nextOperation = await runArtifactAction(
              nextCascade.change,
              openSpecArtifactRefreshActionArtifact(nextCascade),
              openSpecArtifactRefreshCascadeGoal(nextCascade),
            );
            setArtifactRefresh((current) => current?.status === "active" && current.current === nextCascade.current
              ? bindOpenSpecArtifactRefreshOperation(current, nextOperation?.id)
              : current);
          } catch (cause) {
            setArtifactRefresh((current) => current?.status === "active" && current.current === nextCascade.current
              ? interruptOpenSpecArtifactRefreshCascade(
                current,
                cause instanceof Error ? cause.message : "Следующий этап не запущен",
              )
              : current);
          }
        } else {
          setReloadVersion((current) => current + 1);
        }
      } else {
        setReloadVersion((current) => current + 1);
      }
      return true;
    } catch (cause) {
      const nextError = toApiError(cause, "Draft не записан в Store");
      setError(nextError);
      setArtifactRefresh((current) => openSpecArtifactRefreshMatchesOperation(current, {
        id: operation?.id,
        change: operation?.openspecChange,
        artifact: operation?.openspecArtifact,
      }) ? interruptOpenSpecArtifactRefreshCascade(current!, nextError.message) : current);
      return false;
    } finally {
      setPending(false);
    }
  }, [artifactRefresh, draft, onStoreChanged, operation, projectId, runArtifactAction]);

  useEffect(() => {
    if (!operation || !["failed", "cancelled", "rejected"].includes(operation.status)) return;
    setArtifactRefresh((current) => openSpecArtifactRefreshMatchesOperation(current, {
      id: operation.id,
      change: operation.openspecChange,
      artifact: operation.openspecArtifact,
    }) ? interruptOpenSpecArtifactRefreshCascade(
      current!,
      operation.errorMessage || (operation.status === "failed" ? "Этап завершился с ошибкой" : "Каскад остановлен"),
    ) : current);
  }, [operation]);

  const selectChange = useCallback((change: string) => {
    setSelectedChange(change);
    setOperationsPanelOpen(true);
    setOperationDialogOpen(false);
    setValidation(null);
    setValidationStatus("idle");
  }, []);

  const selectOperation = useCallback((next: OpenSpecOperation) => {
    setOperation(next);
    setDraft(null);
    setOperationProgress("");
    setOperationActivity([]);
    setOperationElapsedSeconds(0);
    setError(null);
    setOperationDialogOpen(true);
  }, []);

  const resetOperation = useCallback(() => {
    setOperation(null);
    setDraft(null);
    setOperationProgress("");
    setOperationActivity([]);
    setOperationElapsedSeconds(0);
    setOperationDialogOpen(false);
    setError(null);
  }, []);

  return {
    overview,
    details,
    selectedChange,
    validation,
    validationStatus,
    operation,
    operations,
    operationsLoading,
    operationsPanelOpen,
    operationDialogOpen,
    result: useMemo(() => parseResult(operation), [operation]),
    draft,
    status,
    detailsLoading,
    pending,
    operationProgress,
    operationActivity,
    operationElapsedSeconds,
    artifactRefresh,
    error,
    agentAvailable,
    selectChange,
    selectOperation,
    setOperationsPanelOpen,
    setOperationDialogOpen,
    refresh,
    validate,
    explore,
    createChange,
    deleteChange,
    runAction,
    runArtifactAction,
    startArtifactRefresh,
    retryArtifactRefresh,
    cancel,
    accept,
    reject,
    write,
    resetOperation,
  };
}
