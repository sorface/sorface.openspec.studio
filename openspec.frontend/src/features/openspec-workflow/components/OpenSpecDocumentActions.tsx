"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { OpenSpecOperationPanel } from "@/features/openspec-workflow/components/OpenSpecOperationPanel";
import type { OpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import {
  defaultOpenSpecActionGoal,
  openSpecDocumentActions,
} from "@/features/openspec-workflow/model/openspec-action-presentation";
import {
  openSpecArtifactRefreshStepLabel,
  openSpecArtifactRefreshStepNumber,
  openSpecArtifactRefreshStepsForDocument,
} from "@/features/openspec-workflow/model/artifact-refresh-cascade";
import type { OpenSpecAction, OpenSpecFileMutation, OpenSpecOperation } from "@/features/openspec-workflow/model/openspec-types";
import type { EditorFragmentComment } from "@/features/editor/model/fragment-comment";
import { artifactCommentsGoal } from "@/features/editor/model/fragment-comment";

interface OpenSpecDocumentActionProps {
  controller: OpenSpecWorkflowController;
  change: string;
  documentArtifact: "proposal" | "design" | "tasks";
  hasSpecs: boolean;
  documentDirty: boolean;
  documentSaving: boolean;
  documentComments: EditorFragmentComment[];
  onSave: () => Promise<boolean>;
  onCommentsSubmitted: () => void;
}

interface OpenSpecDocumentReviewProps {
  controller: OpenSpecWorkflowController;
  change: string;
}

export function OpenSpecDocumentAction({
  controller,
  change,
  documentArtifact,
  hasSpecs,
  documentDirty,
  documentSaving,
  documentComments,
  onSave,
  onCommentsSubmitted,
}: OpenSpecDocumentActionProps) {
  const [startingArtifact, setStartingArtifact] = useState("");
  const [startError, setStartError] = useState("");

  useEffect(() => {
    if (controller.selectedChange !== change) controller.selectChange(change);
  }, [change, controller]);

  const actions = useMemo(() => {
    if (controller.details?.summary.name !== change) return [];
    return openSpecDocumentActions(controller.details, hasSpecs, documentArtifact);
  }, [change, controller.details, documentArtifact, hasSpecs]);
  const operationActive = controller.operation?.openspecChange === change &&
    ["queued", "running", "validating"].includes(controller.operation.status);
  const designCreated = controller.details?.summary.name === change && controller.details.artifacts.some((artifact) =>
    artifact.id === "design" && artifact.status === "done",
  );
  const tasksCreated = controller.details?.summary.name === change && controller.details.artifacts.some((artifact) =>
    artifact.id === "tasks" && artifact.status === "done",
  );
  const refreshSteps = useMemo(
    () => openSpecArtifactRefreshStepsForDocument(documentArtifact, designCreated, tasksCreated),
    [designCreated, documentArtifact, tasksCreated],
  );

  const disabledFor = (action: OpenSpecAction) => !!startingArtifact || documentSaving || controller.pending ||
    operationActive || !controller.agentAvailable || !action.available;
  const titleFor = (action: OpenSpecAction, label: string) => startingArtifact || operationActive
    ? "Подготовка артефакта уже выполняется"
    : documentSaving
      ? `Дождитесь сохранения ${documentArtifact}.md`
      : controller.pending
        ? "Загружаем состояние change"
        : !controller.agentAvailable
          ? "Настройте доступный agent CLI"
          : !action.available
            ? action.reason || "Действие пока недоступно"
            : `${label}: agent покажет diff до записи`;

  const run = async (action: OpenSpecAction) => {
    if (!action.artifact || disabledFor(action)) return;
    setStartingArtifact(action.artifact);
    setStartError("");
    try {
      if (documentDirty && !await onSave()) return;
      const refreshSource = documentArtifact === "proposal"
        ? ["spec", "specs"].includes(action.artifact)
        : action.artifact === documentArtifact;
      const guidance = artifactCommentsGoal(documentComments, documentArtifact);
      if (refreshSource) {
        await controller.startArtifactRefresh(change, action.artifact, refreshSteps, guidance);
        if (guidance) onCommentsSubmitted();
        return;
      }
      const goal = defaultOpenSpecActionGoal(action);
      const operation = await controller.runArtifactAction(change, action.artifact, [goal, guidance].filter(Boolean).join("\n\n"));
      if (operation && guidance) onCommentsSubmitted();
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : "Не удалось запустить подготовку артефакта");
    } finally {
      setStartingArtifact("");
    }
  };

  return (
    <div className="openspec-document-action">
      {startError && <span className="openspec-document-action-error" role="alert" title={startError}>!</span>}
      {actions.map(({ action, label, primary }) => (
        <button
          key={`${action.kind}-${action.artifact}`}
          type="button"
          className={`openspec-document-action-button ${primary ? "" : "secondary"}`}
          disabled={disabledFor(action)}
          onClick={() => void run(action)}
          title={titleFor(action, label)}
          aria-label={`${label} изменения ${change}`}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m10 2 1.2 4.1L15 7.5l-3.8 1.4L10 13 8.8 8.9 5 7.5l3.8-1.4L10 2Z" />
            <path d="m15.6 12 .6 2 1.8.6-1.8.7-.6 1.9-.6-1.9-1.9-.7 1.9-.6.6-2Z" />
          </svg>
          <span>{startingArtifact === action.artifact || controller.operation?.openspecArtifact === action.artifact && operationActive
            ? "Agent работает…"
            : documentDirty
              ? `Записать и ${label.toLowerCase()}`
              : label}</span>
          {documentComments.length > 0 && (
            <b className="proposal-comments-count" aria-label={`Комментариев: ${documentComments.length}`}>{documentComments.length}</b>
          )}
        </button>
      ))}
    </div>
  );
}

export function OpenSpecDocumentReview({ controller, change }: OpenSpecDocumentReviewProps) {
  const activeOperation = controller.operations.find((operation) =>
    operation.openspecChange === change && ["queued", "running", "validating"].includes(operation.status),
  );
  const panelOpen = controller.operationsPanelOpen || !!activeOperation;

  const selectedOperation = controller.operation?.openspecChange === change ? controller.operation : null;

  return <>
    {!panelOpen ? (
      <button
        type="button"
        className="open-panel right openspec-operations-open"
        onClick={() => controller.setOperationsPanelOpen(true)}
        aria-label={`Показать историю операций изменения ${change}`}
        title="Показать историю операций"
      >
        <span aria-hidden="true">Операции</span>
      </button>
    ) : (
      <aside className="document-openspec-review" aria-label={`История операций OpenSpec: ${change}`}>
      <header className="openspec-operations-heading">
        <div><small>ИСТОРИЯ ОПЕРАЦИЙ</small><strong>{change}</strong></div>
        <button type="button" onClick={() => controller.setOperationsPanelOpen(false)} aria-label="Свернуть панель операций">×</button>
      </header>
      {controller.artifactRefresh?.change === change && (
        <div className={`artifact-refresh-inline-status status-${controller.artifactRefresh.status}`}>
          <b>{controller.artifactRefresh.status === "complete" ? "Планы согласованы" : controller.artifactRefresh.status === "interrupted" ? "Обновление остановлено" : "Пересогласование планов"}</b>
          <span>
            {controller.artifactRefresh.status === "complete"
              ? "Готовность реализации определяется пунктами tasks.md"
              : `Этап ${openSpecArtifactRefreshStepNumber(controller.artifactRefresh.current, controller.artifactRefresh.steps)} из ${controller.artifactRefresh.steps.length} · ${openSpecArtifactRefreshStepLabel(controller.artifactRefresh.current)}`}
          </span>
          <ol className="artifact-refresh-stages" aria-label="Стадии обновления артефактов">
            {controller.artifactRefresh.steps.map((step) => {
              const completed = controller.artifactRefresh!.completed.includes(step);
              const current = controller.artifactRefresh!.current === step && controller.artifactRefresh!.status !== "complete";
              const stageState = completed ? "completed" : current ? "current" : "planned";
              const stateLabel = completed
                ? "Выполнено"
                : current && controller.artifactRefresh!.status === "interrupted"
                  ? "Остановлено"
                  : current
                    ? "Выполняется"
                    : "Запланировано";
              return (
                <li key={step} className={stageState}>
                  <i aria-hidden="true">{completed ? "✓" : current ? "•" : ""}</i>
                  <span><strong>{openSpecArtifactRefreshStepLabel(step)}</strong><small>{stateLabel}</small></span>
                </li>
              );
            })}
          </ol>
          {controller.artifactRefresh.reason && <small>{controller.artifactRefresh.reason}</small>}
          {controller.artifactRefresh.status === "interrupted" && controller.draft?.status !== "accepted" && (
            <button type="button" disabled={controller.pending} onClick={() => void controller.retryArtifactRefresh()}>
              Повторить этап
            </button>
          )}
        </div>
      )}
      <div className="openspec-operations-list" role="list" aria-label={`История операций ${change}`}>
        {controller.operationsLoading && <p>Загружаем операции…</p>}
        {!controller.operationsLoading && controller.operations.length === 0 && (
          <p>Для этого изменения операций пока нет.</p>
        )}
        {controller.operations.map((operation) => {
          const changedFiles = openSpecOperationChangedFiles(operation);
          const artifactKind = openSpecOperationArtifactKind(operation.openspecArtifact);
          return (
          <button
            type="button"
            role="listitem"
            key={operation.id}
            className={[
              controller.operation?.id === operation.id ? "active" : "",
              operation.provider ? "ai-operation" : "",
            ].filter(Boolean).join(" ")}
            data-ai-provider={operation.provider || undefined}
            data-artifact-kind={artifactKind}
            onClick={() => controller.selectOperation(operation)}
          >
            <span className="openspec-operation-artifact">
              <i aria-hidden="true">{openSpecOperationArtifactSymbol(artifactKind)}</i>
              {openSpecDocumentOperationLabel(operation.openspecAction, operation.openspecArtifact)}
            </span>
            <small>{new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(operation.createdAt))}</small>
            <b data-status={operation.status}>{operationStatusLabel(operation.status)}</b>
            {changedFiles.length > 0 && (
              <span className="openspec-operation-files" aria-label={`Изменено файлов: ${changedFiles.length}`}>
                <em>{changedFiles.length} {changedFiles.length === 1 ? "файл" : "файла"}</em>
                {changedFiles.map((mutation, index) => (
                  <span key={`${mutation.type}-${mutation.previousPath || ""}-${mutation.path}-${index}`}>
                    <i data-mutation={mutation.type} aria-hidden="true">{openSpecMutationSymbol(mutation.type)}</i>
                    <code title={mutation.previousPath ? `${mutation.previousPath} → ${mutation.path}` : mutation.path}>
                      {mutation.previousPath
                        ? `${openSpecFileName(mutation.previousPath)} → ${openSpecFileName(mutation.path)}`
                        : openSpecFileName(mutation.path)}
                    </code>
                  </span>
                ))}
              </span>
            )}
          </button>
          );
        })}
      </div>
      </aside>
    )}
    {controller.operationDialogOpen && selectedOperation && createPortal((
      <div className="openspec-operation-dialog-backdrop" role="presentation">
        <section
          className="openspec-operation-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={`Просмотр операции ${openSpecDocumentOperationLabel(selectedOperation.openspecAction, selectedOperation.openspecArtifact)}`}
        >
          <OpenSpecOperationPanel
            controller={controller}
            onClose={() => controller.setOperationDialogOpen(false)}
          />
        </section>
      </div>
    ), document.body)}
  </>;
}

function openSpecDocumentOperationLabel(action: string, artifact?: string): string {
  if (artifact) return artifact.endsWith(".md") ? artifact : `${artifact}.md`;
  return action === "create_change" ? "Создание change" : action === "explore" ? "Исследование" : action;
}

type OpenSpecOperationArtifactKind = "proposal" | "specs" | "design" | "tasks" | "other";

function openSpecOperationArtifactKind(artifact?: string): OpenSpecOperationArtifactKind {
  if (artifact === "spec" || artifact === "specs") return "specs";
  if (artifact === "proposal" || artifact === "design" || artifact === "tasks") return artifact;
  return "other";
}

function openSpecOperationArtifactSymbol(kind: OpenSpecOperationArtifactKind): string {
  return ({ proposal: "P", specs: "S", design: "D", tasks: "T", other: "·" })[kind];
}

function openSpecOperationChangedFiles(operation: OpenSpecOperation): OpenSpecFileMutation[] {
  if (!operation.result) return [];
  try {
    const parsed = JSON.parse(operation.result) as { files?: OpenSpecFileMutation[] };
    return Array.isArray(parsed.files)
      ? parsed.files.filter((file) => file && typeof file.path === "string" && file.path.length > 0)
      : [];
  } catch {
    return [];
  }
}

function openSpecMutationSymbol(type: OpenSpecFileMutation["type"]): string {
  return type === "create" ? "+" : type === "delete" ? "−" : type === "rename" ? "→" : "~";
}

function openSpecFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function operationStatusLabel(status: string): string {
  return ({
    queued: "В очереди", running: "Выполняется", validating: "Проверка",
    awaiting_review: "На проверке", accepted: "Принято", rejected: "Отклонено",
    cancelled: "Отменено", failed: "Ошибка",
  } as Record<string, string>)[status] ?? status;
}
