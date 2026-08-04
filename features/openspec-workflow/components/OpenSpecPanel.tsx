"use client";

import { useCallback, useEffect, useState } from "react";
import { ChangeCreationWizard } from "@/features/openspec-workflow/components/ChangeCreationWizard";
import { OpenSpecOperationPanel } from "@/features/openspec-workflow/components/OpenSpecOperationPanel";
import { useChangeCreationController } from "@/features/openspec-workflow/hooks/useChangeCreationController";
import type { OpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import {
  defaultOpenSpecActionGoal,
  openSpecActionLabel,
} from "@/features/openspec-workflow/model/openspec-action-presentation";
import type { OpenSpecAction } from "@/features/openspec-workflow/model/openspec-types";

interface OpenSpecPanelProps {
  controller: OpenSpecWorkflowController;
  projectId?: string;
  creationPageOpen: boolean;
  onCreationPageOpenChange: (open: boolean) => void;
  onChangeCreated: (proposalPath: string) => void;
}

const validationLabels = {
  idle: "Не проверена",
  checking: "Проверяем спецификацию…",
  valid: "Спецификация валидна",
  invalid: "Требует исправления",
  error: "Проверка недоступна",
} as const;

function artifactForDiagnostic(path = ""): string {
  if (/(^|\/)proposal\.md$/.test(path)) return "proposal";
  if (/(^|\/)design\.md$/.test(path)) return "design";
  if (/(^|\/)tasks\.md$/.test(path)) return "tasks";
  return "specs";
}

function Progress({ completed, total }: { completed: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div className="openspec-progress" aria-label={`Выполнено ${completed} из ${total}`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function ActionCard({
  action,
  disabled,
  onRun,
}: {
  action: OpenSpecAction;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <div className={`openspec-action ${action.available ? "" : "blocked"}`}>
      <div>
        <b>{openSpecActionLabel(action)}</b>
        {action.outputPaths?.length ? <small>Результат: {action.outputPaths.join(", ")}</small> : null}
        {action.inputPaths?.length ? <small>Контекст: {action.inputPaths.join(", ")}</small> : null}
        {!action.available && <small className="blocked-reason">{action.reason ?? "Действие заблокировано"}</small>}
      </div>
      <button
        type="button"
        disabled={disabled || !action.available}
        onClick={onRun}
      >
        {openSpecActionLabel(action)}
      </button>
    </div>
  );
}

export function OpenSpecPanel({
  controller,
  projectId,
  creationPageOpen,
  onCreationPageOpenChange,
  onChangeCreated,
}: OpenSpecPanelProps) {
  const [goal, setGoal] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const creation = useChangeCreationController(projectId);
  const operationActive = !!controller.operation &&
    ["queued", "running", "validating"].includes(controller.operation.status);
  const needsAgent = !controller.agentAvailable;
  const changeName = controller.details?.summary.name ?? "";
  const proposalReady = controller.details?.artifacts.some((artifact) =>
    artifact.id === "proposal" && artifact.status === "done",
  ) ?? false;
  const recommendedAction = controller.details?.actions.find((action) =>
    action.available && action.kind === "prepare_artifact" &&
    (proposalReady
      ? ["spec", "specs"].includes(action.artifact ?? "")
      : action.artifact === "proposal"),
  );

  const openCreationPage = () => {
    if (operationActive) return;
    onCreationPageOpenChange(true);
  };

  const closeDeleteDialog = useCallback(() => {
    if (controller.pending) return;
    setDeleteDialogOpen(false);
    setDeleteConfirmation("");
  }, [controller.pending]);

  useEffect(() => {
    if (!deleteDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDeleteDialog();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeDeleteDialog, deleteDialogOpen]);


  if (controller.status === "idle") {
    return <section className="openspec-panel"><div className="openspec-state">Выберите проект для управления OpenSpec.</div></section>;
  }
  if (controller.status === "loading") {
    return <section className="openspec-panel"><div className="openspec-state">Загрузка OpenSpec workflow…</div></section>;
  }
  if (controller.status === "unavailable") {
    return (
      <section className="openspec-panel">
        <div className="openspec-state error" role="alert">
          <b>OpenSpec CLI недоступен или не поддерживается</b>
          <p>{controller.error?.message}</p>
          <button type="button" onClick={controller.refresh}>Повторить</button>
        </div>
      </section>
    );
  }

  if (creationPageOpen) {
    return (
      <ChangeCreationWizard
        agentAvailable={controller.agentAvailable}
        creation={creation}
        workflow={controller}
        onClose={() => onCreationPageOpenChange(false)}
        onCreated={onChangeCreated}
      />
    );
  }

  return (
    <section className="openspec-panel">
      <header className="openspec-panel-header">
        <div>
          <small>OPENSPEC WORKFLOW</small>
          <h2>Управление изменениями</h2>
        </div>
        <div>
          <button type="button" onClick={() => void controller.validate(true)} disabled={controller.pending}>
            Проверить всё
          </button>
          <button type="button" onClick={controller.refresh}>↻ Обновить</button>
        </div>
      </header>

      <div className="openspec-panel-body">
        <aside className="openspec-change-list">
          <button
            type="button"
            className="openspec-create-entry"
            onClick={openCreationPage}
            disabled={operationActive}
          >
            <span>＋</span>
            <b>Создать change</b>
            <small>Опишите замысел и подготовьте proposal с AI</small>
          </button>
          {needsAgent && (
            <p className="openspec-agent-warning">
              Agent CLI не настроен. Обзор и проверка доступны, генерация артефактов — нет.
            </p>
          )}
          <div className="openspec-change-items">
            {controller.overview?.changes.map((change) => (
              <button
                key={change.name}
                type="button"
                className={controller.selectedChange === change.name ? "active" : ""}
                onClick={() => controller.selectChange(change.name)}
              >
                <span>
                  <b>{change.name}</b>
                  <small>{change.status}</small>
                </span>
                <em>{change.completedTasks}/{change.totalTasks}</em>
                <Progress completed={change.completedTasks} total={change.totalTasks} />
              </button>
            ))}
            {controller.status === "empty" && <p>Активных changes нет. Создайте первый change через agent.</p>}
          </div>
        </aside>

        <div className="openspec-change-details">
          {controller.error && (
            <div className="openspec-alert" role="alert">
              <b>{controller.status === "stale" ? "Состояние change изменилось" : "Ошибка OpenSpec"}</b>
              <span>{controller.error.message}</span>
              {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
              <button type="button" onClick={controller.refresh}>Обновить</button>
            </div>
          )}

          <label className="openspec-goal">
            <span>Дополнительные указания для agent</span>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Например: учесть правки proposal и обновить спецификацию…"
            />
            <small>Необязательно. Без текста Agent использует актуальный proposal и инструкции OpenSpec.</small>
          </label>

          {controller.detailsLoading && <div className="openspec-state">Загрузка change…</div>}
          {!controller.detailsLoading && controller.details && (
            <>
              <div className="openspec-change-title">
                <div>
                  <small>CHANGE</small>
                  <h3>{controller.details.summary.name}</h3>
                </div>
                <span>{controller.details.schema}</span>
                <span className={`openspec-validation-badge status-${controller.validationStatus}`}>
                  {validationLabels[controller.validationStatus]}
                </span>
                <button
                  type="button"
                  onClick={() => void controller.validate(false)}
                  disabled={controller.validationStatus === "checking"}
                >
                  Проверить спецификацию
                </button>
              </div>
              <Progress
                completed={controller.details.summary.completedTasks}
                total={controller.details.summary.totalTasks}
              />

              <section className="openspec-next-step">
                <small>СЛЕДУЮЩИЙ ШАГ</small>
                {recommendedAction ? (
                  <>
                    <h4>{openSpecActionLabel(recommendedAction)}</h4>
                    <p>
                      {recommendedAction.artifact === "proposal"
                        ? "Agent подготовит proposal.md по вашему замыслу. Вы увидите diff до записи."
                        : "После правок proposal.md сформируйте или обновите specs изменения. Вы увидите diff до записи."}
                    </p>
                    <button
                      type="button"
                      disabled={controller.pending || operationActive || needsAgent}
                      onClick={() => void controller.runAction(recommendedAction, goal.trim() || defaultOpenSpecActionGoal(recommendedAction))}
                    >
                      {openSpecActionLabel(recommendedAction)}
                    </button>
                  </>
                ) : (
                  <>
                    <h4>Откройте proposal.md и проверьте спецификацию</h4>
                    <p>Правки сохраняются только по вашей команде. После записи снова запустите проверку.</p>
                  </>
                )}
              </section>

              <section className="openspec-artifacts">
                <h4>Артефакты и зависимости</h4>
                {controller.details.artifacts.map((artifact) => (
                  <div key={artifact.id} className={`openspec-artifact status-${artifact.status}`}>
                    <span>{artifact.status === "done" ? "✓" : artifact.missingDeps?.length ? "⊘" : "○"}</span>
                    <div>
                      <b>{artifact.id}</b>
                      <code>{artifact.outputPath}</code>
                      {!!artifact.requires.length && <small>Зависит от: {artifact.requires.join(", ")}</small>}
                      {!!artifact.missingDeps?.length && <small className="blocked-reason">Не готовы: {artifact.missingDeps.join(", ")}</small>}
                    </div>
                  </div>
                ))}
              </section>

              <section className="openspec-actions">
                <h4>Другие действия</h4>
                {controller.details.actions.map((action, index) => (
                  <ActionCard
                    key={`${action.kind}-${action.artifact ?? index}`}
                    action={action}
                    disabled={controller.pending || operationActive || (action.kind !== "archive" && needsAgent)}
                    onRun={() => void controller.runAction(action, goal.trim() || defaultOpenSpecActionGoal(action))}
                  />
                ))}
              </section>

              <section className="openspec-danger-zone">
                <div>
                  <h4>Опасная зона</h4>
                  <p>
                    Удаление безвозвратно удалит каталог change и все {controller.details.deletion.totalFiles} файлов
                    внутри него.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-danger"
                  disabled={controller.pending || operationActive}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  Удалить change…
                </button>
              </section>
            </>
          )}

          {controller.validationStatus !== "idle" && (
            <section className={`openspec-validation ${controller.validationStatus}`} aria-live="polite">
              <h4>{validationLabels[controller.validationStatus]}</h4>
              {controller.validationStatus === "checking" && <p>OpenSpec проверяет актуальные артефакты выбранного change.</p>}
              {controller.validation && !controller.validation.diagnostics.length && <p>Диагностик нет.</p>}
              {controller.validation?.diagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.path}-${index}`}>
                  <b>{diagnostic.level}</b>
                  {diagnostic.path && <code>{diagnostic.path}</code>}
                  <span>{diagnostic.message}</span>
                </div>
              ))}
              {controller.validationStatus === "invalid" && controller.details && (
                <button
                  type="button"
                  disabled={!controller.agentAvailable || controller.pending || operationActive}
                  title={!controller.agentAvailable ? "Настройте доступный agent CLI" : undefined}
                  onClick={() => {
                    const artifact = artifactForDiagnostic(controller.validation?.diagnostics[0]?.path);
                    const action: OpenSpecAction = {
                      kind: "fix_artifact",
                      artifact,
                      available: true,
                    };
                    void controller.runAction(action, goal.trim() || defaultOpenSpecActionGoal(action));
                  }}
                >
                  Исправить через agent
                </button>
              )}
            </section>
          )}

          <OpenSpecOperationPanel controller={controller} />
        </div>
      </div>

      {deleteDialogOpen && controller.details && (
        <div className="openspec-delete-backdrop">
          <form
            className="openspec-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="openspec-delete-title"
            onSubmit={async (event) => {
              event.preventDefault();
              if (deleteConfirmation !== changeName) return;
              try {
                await controller.deleteChange(deleteConfirmation);
                setDeleteDialogOpen(false);
                setDeleteConfirmation("");
              } catch {
                // Ошибка отображается в диалоге; пользователь может обновить snapshot и повторить.
              }
            }}
          >
            <header>
              <div>
                <small>НЕОБРАТИМОЕ ДЕЙСТВИЕ</small>
                <h3 id="openspec-delete-title">Удалить change?</h3>
              </div>
              <button type="button" aria-label="Закрыть" onClick={closeDeleteDialog}>×</button>
            </header>

            <p className="openspec-delete-warning">
              Change <code>{changeName}</code> будет удалён из OpenSpec Store. Отменить это действие через Studio
              нельзя.
            </p>

            <div className="openspec-delete-summary">
              <b>Будут удалены файлы ({controller.details.deletion.totalFiles})</b>
              {controller.details.deletion.files.length ? (
                <ul>
                  {controller.details.deletion.files.map((path) => <li key={path}><code>{path}</code></li>)}
                </ul>
              ) : (
                <p>Каталог change пуст.</p>
              )}
            </div>

            <label className="openspec-delete-confirmation">
              <span>Для подтверждения введите <code>{changeName}</code></span>
              <input
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                aria-describedby="openspec-delete-match"
              />
              <small id="openspec-delete-match">
                Имя должно совпадать полностью, с учётом регистра.
              </small>
            </label>

            {controller.error && (
              <div className="openspec-delete-error" role="alert">
                <b>Change не удалён</b>
                <span>{controller.error.message}</span>
                {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
              </div>
            )}

            <footer>
              <button type="button" onClick={closeDeleteDialog} disabled={controller.pending}>Отмена</button>
              <button
                type="submit"
                className="danger-submit"
                disabled={controller.pending || deleteConfirmation !== changeName}
              >
                {controller.pending ? "Удаление…" : "Удалить безвозвратно"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
