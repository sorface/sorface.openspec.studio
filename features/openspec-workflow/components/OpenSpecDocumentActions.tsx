"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OpenSpecOperationPanel } from "@/features/openspec-workflow/components/OpenSpecOperationPanel";
import type { OpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import {
  defaultOpenSpecActionGoal,
  openSpecDocumentActions,
} from "@/features/openspec-workflow/model/openspec-action-presentation";
import {
  openSpecArtifactRefreshGoal,
  openSpecArtifactRefreshStepLabel,
  openSpecArtifactRefreshStepNumber,
} from "@/features/openspec-workflow/model/artifact-refresh-cascade";
import type { OpenSpecAction } from "@/features/openspec-workflow/model/openspec-types";

interface OpenSpecDocumentActionProps {
  controller: OpenSpecWorkflowController;
  change: string;
  documentArtifact: "proposal" | "design";
  hasSpecs: boolean;
  documentDirty: boolean;
  documentSaving: boolean;
  onSave: () => Promise<boolean>;
  onCreateChange: () => void;
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
  onSave,
  onCreateChange,
}: OpenSpecDocumentActionProps) {
  const [startingArtifact, setStartingArtifact] = useState("");
  const [startError, setStartError] = useState("");
  const [refreshWarningAction, setRefreshWarningAction] = useState<OpenSpecAction | null>(null);
  const refreshWarningRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (controller.selectedChange !== change) controller.selectChange(change);
  }, [change, controller]);

  useEffect(() => {
    if (!refreshWarningAction) return;
    refreshWarningRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRefreshWarningAction(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [refreshWarningAction]);

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
  const downstreamCreated = designCreated || tasksCreated;

  const disabledFor = (action: OpenSpecAction) => !!startingArtifact || !!refreshWarningAction || documentSaving || controller.pending ||
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
      if (documentArtifact === "proposal" && downstreamCreated && ["spec", "specs"].includes(action.artifact)) {
        setRefreshWarningAction(action);
        return;
      }
      const goal = documentArtifact === "proposal" && hasSpecs && ["spec", "specs"].includes(action.artifact)
        ? openSpecArtifactRefreshGoal("specs")
        : defaultOpenSpecActionGoal(action);
      await controller.runArtifactAction(change, action.artifact, goal);
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : "Не удалось запустить подготовку артефакта");
    } finally {
      setStartingArtifact("");
    }
  };

  const startRefreshCascade = async () => {
    const action = refreshWarningAction;
    if (!action?.artifact) return;
    setRefreshWarningAction(null);
    setStartingArtifact(action.artifact);
    setStartError("");
    try {
      await controller.startArtifactRefresh(change, action.artifact, tasksCreated);
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : "Не удалось запустить пересогласование артефактов");
    } finally {
      setStartingArtifact("");
    }
  };

  const createSeparateChange = () => {
    setRefreshWarningAction(null);
    onCreateChange();
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
        </button>
      ))}
      {refreshWarningAction && createPortal((
        <div
          className="artifact-refresh-warning-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRefreshWarningAction(null);
          }}
        >
          <section
            ref={refreshWarningRef}
            className="artifact-refresh-warning"
            role="dialog"
            aria-modal="true"
            aria-labelledby="artifact-refresh-warning-title"
            tabIndex={-1}
          >
            <header>
              <div>
                <small>ИЗМЕНЕНИЕ ПЛАНА</small>
                <h2 id="artifact-refresh-warning-title">Пересогласовать артефакты change?</h2>
              </div>
              <button type="button" onClick={() => setRefreshWarningAction(null)} aria-label="Закрыть предупреждение">×</button>
            </header>
            <div className="artifact-refresh-warning-body">
              <p>
                Для <code>{change}</code> уже создан <code>{tasksCreated ? "tasks.md" : "design.md"}</code>. Обновление proposal повлияет на существующие planning-артефакты.
              </p>
              <ol aria-label="Артефакты, которые будут обновлены">
                <li><b>1</b><span><strong>proposal.md + diff specs</strong><small>Текущий файл и требования будут пересогласованы одним review-набором</small></span></li>
                <li><b>2</b><span><strong>design.md</strong><small>Техническое решение обновится по новым требованиям</small></span></li>
                {tasksCreated && <li><b>3</b><span><strong>tasks.md</strong><small>План реализации будет сверён с новым design</small></span></li>}
              </ol>
              <div className="artifact-refresh-intent-warning">
                <b>Проверьте намерение изменения</b>
                <p>
                  Если правка меняет исходную цель, scope или ожидаемое поведение, безопаснее создать новый change. Продолжайте здесь только для уточнения текущего намерения.
                </p>
              </div>
              <p className="artifact-refresh-review-note">
                Каждый этап будет показан отдельно. Следующий начнётся только после принятия и записи предыдущего результата.
              </p>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setRefreshWarningAction(null)}>Отмена</button>
              <button type="button" className="secondary-button create-change" onClick={createSeparateChange}>Создать новый change</button>
              <button type="button" className="primary-submit" onClick={() => void startRefreshCascade()}>Принять риск и обновить</button>
            </footer>
          </section>
        </div>
      ), document.body)}
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
      <aside className="document-openspec-review collapsed">
        <button
          type="button"
          className="openspec-operations-open"
          onClick={() => controller.setOperationsPanelOpen(true)}
          aria-label={`Показать историю операций изменения ${change}`}
          title="Показать историю операций"
        >
          <span className="openspec-operations-open-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <path d="M4.2 6.2A6.4 6.4 0 1 1 3.6 11" />
              <path d="M4.2 2.8v3.8H8" />
              <path d="M10 6.3v4.1l2.7 1.6" />
            </svg>
          </span>
          <span className="openspec-operations-open-label">История</span>
          {controller.operations.length > 0 && (
            <b aria-label={`Всего операций: ${controller.operations.length}`}>{controller.operations.length}</b>
          )}
        </button>
      </aside>
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
              : `Этап ${openSpecArtifactRefreshStepNumber(controller.artifactRefresh.current)} из 3 · ${openSpecArtifactRefreshStepLabel(controller.artifactRefresh.current)}`}
          </span>
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
        {controller.operations.map((operation) => (
          <button
            type="button"
            role="listitem"
            key={operation.id}
            className={controller.operation?.id === operation.id ? "active" : ""}
            onClick={() => controller.selectOperation(operation)}
          >
            <span>{openSpecDocumentOperationLabel(operation.openspecAction, operation.openspecArtifact)}</span>
            <small>{new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(operation.createdAt))}</small>
            <b data-status={operation.status}>{operationStatusLabel(operation.status)}</b>
          </button>
        ))}
      </div>
        {selectedOperation && selectedOperation.status !== "accepted" && (
          <div className="openspec-operation-summary">
            <div>
              <strong>{openSpecDocumentOperationLabel(selectedOperation.openspecAction, selectedOperation.openspecArtifact)}</strong>
              <span>{operationStatusLabel(selectedOperation.status)}</span>
            </div>
            {activeOperation?.id === selectedOperation.id && (
              <p>{controller.operationProgress || "Agent работает…"}</p>
            )}
            <button
              type="button"
              className="openspec-operation-view-button"
              onClick={() => controller.setOperationDialogOpen(true)}
            >
              Просмотреть результат
            </button>
          </div>
        )}
      </aside>
    )}
    {controller.operationDialogOpen && selectedOperation && (
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
    )}
  </>;
}

function openSpecDocumentOperationLabel(action: string, artifact?: string): string {
  if (artifact) return artifact.endsWith(".md") ? artifact : `${artifact}.md`;
  return action === "create_change" ? "Создание change" : action === "explore" ? "Исследование" : action;
}

function operationStatusLabel(status: string): string {
  return ({
    queued: "В очереди", running: "Выполняется", validating: "Проверка",
    awaiting_review: "На проверке", accepted: "Принято", rejected: "Отклонено",
    cancelled: "Отменено", failed: "Ошибка",
  } as Record<string, string>)[status] ?? status;
}
