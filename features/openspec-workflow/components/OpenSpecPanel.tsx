"use client";

import { useCallback, useEffect, useState } from "react";
import type { OpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import type {
  OpenSpecAction,
  OpenSpecFileMutation,
} from "@/features/openspec-workflow/model/openspec-types";

interface OpenSpecPanelProps {
  controller: OpenSpecWorkflowController;
  createDialogOpen: boolean;
  onCreateDialogOpenChange: (open: boolean) => void;
}

const actionLabels: Record<string, string> = {
  explore: "Исследование задачи",
  create_change: "Создать изменение",
  prepare_artifact: "Подготовить",
  fix_artifact: "Исправить",
  archive: "Архивировать",
};

function actionLabel(action: OpenSpecAction): string {
  if ((action.kind === "prepare_artifact" || action.kind === "fix_artifact") &&
      ["spec", "specs"].includes(action.artifact ?? "")) {
    return "Обновить спецификацию";
  }
  if (action.kind === "prepare_artifact" && action.artifact === "proposal") {
    return "Подготовить proposal";
  }
  return actionLabels[action.kind] ?? action.kind;
}

const validationLabels = {
  idle: "Не проверена",
  checking: "Проверяем спецификацию…",
  valid: "Спецификация валидна",
  invalid: "Требует исправления",
  error: "Проверка недоступна",
} as const;

const operationStatusLabels = {
  queued: "В очереди",
  running: "Agent работает",
  validating: "Проверяем результат",
  awaiting_review: "Готово к проверке",
  accepted: "Принято",
  rejected: "Отклонено",
  cancelled: "Отменено",
  failed: "Ошибка",
} as const;

const mutationLabels: Record<OpenSpecFileMutation["type"], string> = {
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
  rename: "Переименование",
};

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

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function MutationReview({ mutation }: { mutation: OpenSpecFileMutation }) {
  return (
    <article className={`openspec-mutation mutation-${mutation.type}`}>
      <header>
        <b>{mutationLabels[mutation.type]}</b>
        <code>{mutation.previousPath ? `${mutation.previousPath} → ` : ""}{mutation.path}</code>
      </header>
      {mutation.type !== "create" && (
        <pre className="mutation-before" aria-label="До">{mutation.before || "∅"}</pre>
      )}
      {mutation.type !== "delete" && (
        <pre className="mutation-after" aria-label="После">{mutation.after || "∅"}</pre>
      )}
    </article>
  );
}

function ActionCard({
  action,
  goal,
  disabled,
  onRun,
}: {
  action: OpenSpecAction;
  goal: string;
  disabled: boolean;
  onRun: () => void;
}) {
  const needsAgent = action.kind !== "archive";
  return (
    <div className={`openspec-action ${action.available ? "" : "blocked"}`}>
      <div>
        <b>{actionLabel(action)}</b>
        {action.outputPaths?.length ? <small>Результат: {action.outputPaths.join(", ")}</small> : null}
        {action.inputPaths?.length ? <small>Контекст: {action.inputPaths.join(", ")}</small> : null}
        {!action.available && <small className="blocked-reason">{action.reason ?? "Действие заблокировано"}</small>}
      </div>
      <button
        type="button"
        disabled={disabled || !action.available || (needsAgent && !goal.trim())}
        onClick={onRun}
      >
        {actionLabel(action)}
      </button>
    </div>
  );
}

export function OpenSpecPanel({
  controller,
  createDialogOpen,
  onCreateDialogOpenChange,
}: OpenSpecPanelProps) {
  const [newChange, setNewChange] = useState("");
  const [goal, setGoal] = useState("");
  const [taskSummary, setTaskSummary] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const operationActive = !!controller.operation &&
    ["queued", "running", "validating"].includes(controller.operation.status);
  const needsAgent = !controller.agentAvailable;
  const changeName = controller.details?.summary.name ?? "";
  const exploreActive = controller.operation?.openspecAction === "explore" && operationActive;
  const exploreReady = controller.operation?.openspecAction === "explore" &&
    controller.operation.status === "awaiting_review" && !!controller.result?.finalResponse;
  const exploreFailure = controller.operation?.openspecAction === "explore" &&
    controller.operation.status === "failed"
    ? controller.operation.errorMessage || "Исследование не завершено. Повторите запрос."
    : "";
  const proposalReady = controller.details?.artifacts.some((artifact) =>
    artifact.id === "proposal" && artifact.status === "done",
  ) ?? false;
  const recommendedAction = controller.details?.actions.find((action) =>
    action.available && action.kind === "prepare_artifact" &&
    (proposalReady
      ? ["spec", "specs"].includes(action.artifact ?? "")
      : action.artifact === "proposal"),
  );

  const openCreateDialog = () => {
    if (operationActive) return;
    controller.resetOperation();
    setNewChange("");
    setTaskSummary("");
    onCreateDialogOpenChange(true);
  };

  const closeCreateDialog = useCallback(() => {
    if (exploreActive || controller.pending) return;
    onCreateDialogOpenChange(false);
  }, [controller.pending, exploreActive, onCreateDialogOpenChange]);

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

  useEffect(() => {
    if (!createDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCreateDialog();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeCreateDialog, createDialogOpen]);

  const submitExplore = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!taskSummary.trim()) return;
    try {
      await controller.explore(taskSummary.trim());
    } catch {
      // Controller exposes the recoverable error and keeps the description in the modal.
    }
  };

  const submitChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newChange.trim() || !taskSummary.trim() || !controller.result?.finalResponse) return;
    try {
      await controller.createChange(newChange.trim(), taskSummary.trim(), controller.result.finalResponse);
      onCreateDialogOpenChange(false);
    } catch {
      // The modal stays open so the analyst can fix the name or retry.
    }
  };

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
            onClick={openCreateDialog}
            disabled={operationActive}
          >
            <span>＋</span>
            <b>Добавить изменение</b>
            <small>Начните с исследования задачи</small>
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
            <span>Что нужно обновить в change</span>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Например: учесть правки proposal и обновить спецификацию…"
            />
            <small>Agent получает инструкции OpenSpec и только разрешённые зависимости текущего артефакта.</small>
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
                    <h4>{actionLabel(recommendedAction)}</h4>
                    <p>
                      {recommendedAction.artifact === "proposal"
                        ? "Agent подготовит proposal.md по результатам исследования. Вы увидите diff до записи."
                        : "После правок proposal.md попросите agent привести delta specs в соответствие. Вы увидите diff до записи."}
                    </p>
                    <button
                      type="button"
                      disabled={controller.pending || operationActive || needsAgent || !goal.trim()}
                      onClick={() => void controller.runAction(recommendedAction, goal)}
                    >
                      {actionLabel(recommendedAction)}
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
                    goal={goal}
                    disabled={controller.pending || operationActive || (action.kind !== "archive" && needsAgent)}
                    onRun={() => void controller.runAction(action, goal)}
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
                  disabled={!controller.agentAvailable || controller.pending || operationActive || !goal.trim()}
                  title={!controller.agentAvailable ? "Настройте доступный agent CLI" : undefined}
                  onClick={() => {
                    const artifact = artifactForDiagnostic(controller.validation?.diagnostics[0]?.path);
                    void controller.runAction({
                      kind: "fix_artifact",
                      artifact,
                      available: true,
                    }, goal);
                  }}
                >
                  Исправить через agent
                </button>
              )}
            </section>
          )}

          {controller.operation && (
            <section className={`openspec-operation status-${controller.operation.status}`}>
              <header>
                <div>
                  <small>ОПЕРАЦИЯ</small>
                  <h4>
                    {actionLabels[controller.operation.openspecAction]}
                    {controller.operation.openspecChange ? ` · ${controller.operation.openspecChange}` : ""}
                  </h4>
                </div>
                <b>{operationStatusLabels[controller.operation.status]}</b>
              </header>
              {operationActive && (
                <div className="openspec-operation-running">
                  <span className="operation-spinner" />
                  <div>
                    <b>{controller.operationProgress || "Agent работает…"}</b>
                    <p>Прошло {formatElapsedTime(controller.operationElapsedSeconds)} · реальные файлы не изменяются.</p>
                  </div>
                  <button type="button" onClick={() => void controller.cancel()}>Отменить</button>
                </div>
              )}
              {controller.operation.status === "failed" && (
                <div className="openspec-operation-error" role="alert">
                  <b>{controller.operation.errorCode}</b>
                  <p>{controller.operation.errorMessage}</p>
                  {controller.operation.correlationId && <small>Correlation ID: {controller.operation.correlationId}</small>}
                </div>
              )}
              {controller.operation.status === "cancelled" && <p>Операция отменена. Store не изменён.</p>}
              {controller.result && (
                <div className="openspec-review">
                  <p>{controller.result.finalResponse}</p>
                  {!!controller.result.diagnostics?.length && (
                    <div className="openspec-result-diagnostics">
                      {controller.result.diagnostics.map((diagnostic, index) => (
                        <p key={`${diagnostic.path}-${index}`}>
                          <b>{diagnostic.level}</b> {diagnostic.path && <code>{diagnostic.path}</code>} {diagnostic.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {controller.operation.openspecAction !== "explore" && (
                    <h4>Предпросмотр полного набора изменений ({controller.result.files.length})</h4>
                  )}
                  {controller.operation.openspecAction === "archive" && (
                    <div className="archive-warning">
                      Архивирование принимается только целиком. Частичный выбор файлов запрещён.
                    </div>
                  )}
                  {controller.operation.openspecAction !== "explore" && controller.result.files.map((mutation, index) => (
                    <MutationReview key={`${mutation.type}-${mutation.path}-${index}`} mutation={mutation} />
                  ))}
                  {controller.operation.status === "awaiting_review" && controller.operation.openspecAction !== "explore" && (
                    <div className="openspec-review-actions">
                      <button type="button" className="secondary-danger" onClick={() => void controller.reject()}>
                        Отклонить
                      </button>
                      <button type="button" onClick={() => void controller.accept()} disabled={controller.pending}>
                        Принять весь набор
                      </button>
                    </div>
                  )}
                </div>
              )}
              {controller.draft && (
                <div className="openspec-draft">
                  <b>{controller.draft.status === "written" ? "✓ Записано в Store" : "Результат принят как draft"}</b>
                  {controller.draft.status === "accepted" && (
                    <>
                      <p>Проверьте набор ещё раз. Только явная запись изменит Store.</p>
                      <button type="button" onClick={() => void controller.write()} disabled={controller.pending}>
                        Записать {controller.draft.mutations.length} изменений в Store
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {createDialogOpen && (
        <div className="openspec-create-backdrop">
          <form
            className="openspec-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="openspec-create-title"
            onSubmit={exploreReady ? submitChange : submitExplore}
          >
            <header>
              <div>
                <small>НОВОЕ ИЗМЕНЕНИЕ</small>
                <h3 id="openspec-create-title">{exploreReady ? "Создать изменение" : "Исследовать задачу"}</h3>
              </div>
              <button type="button" aria-label="Закрыть" onClick={closeCreateDialog} disabled={exploreActive}>×</button>
            </header>

            <div className="openspec-create-steps" aria-label="Этапы создания изменения">
              <span className={!exploreReady ? "active" : "done"}>1 · Исследование</span>
              <span className={exploreReady ? "active" : ""}>2 · Создание</span>
              <span>3 · Proposal и specs</span>
            </div>

            <div className="openspec-create-content">
              <label>
                <span>Суть задачи</span>
                <textarea
                  autoFocus
                  value={taskSummary}
                  onChange={(event) => setTaskSummary(event.target.value)}
                  disabled={exploreActive || exploreReady}
                  placeholder="Опишите проблему, ожидаемый результат и известные ограничения простыми словами…"
                />
                <small>Сначала agent исследует контекст без создания или изменения файлов.</small>
              </label>

              {exploreActive && (
                <div className="openspec-explore-progress" aria-live="polite">
                  <div className="openspec-explore-running">
                    <span className="operation-spinner" />
                    <div>
                      <b>{controller.operationProgress || "Исследуем задачу…"}</b>
                      <small>
                        Прошло {formatElapsedTime(controller.operationElapsedSeconds)} · без ограничения по времени. Store остаётся без изменений.
                      </small>
                    </div>
                  </div>
                  <section className="openspec-explore-activity">
                    <small>ХОД ИССЛЕДОВАНИЯ</small>
                    <ol>
                      {controller.operationActivity.map((message, index) => (
                        <li key={`${index}-${message}`}>{message}</li>
                      ))}
                    </ol>
                    <p>Показываются безопасные этапы работы — без скрытых рассуждений, команд и содержимого файлов.</p>
                  </section>
                </div>
              )}

              {exploreReady && (
                <>
                  <section className="openspec-explore-result">
                    <small>РЕЗУЛЬТАТ ИССЛЕДОВАНИЯ</small>
                    <p>{controller.result?.finalResponse}</p>
                  </section>
                  <label>
                    <span>Название изменения</span>
                    <input
                      value={newChange}
                      onChange={(event) => setNewChange(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                      placeholder="add-interview-report"
                      pattern="[a-z][a-z0-9-]*"
                      required
                    />
                    <small>Вы определяете название. Используйте английские буквы, цифры и дефисы.</small>
                  </label>
                </>
              )}

              {(controller.error || exploreFailure) && (
                <div className="openspec-create-error" role="alert">
                  {controller.error?.message || exploreFailure}
                </div>
              )}
              {needsAgent && (
                <div className="openspec-create-agent-warning" role="status">
                  Для исследования настройте доступный agent CLI в верхней панели. Описание задачи сохранится в окне.
                </div>
              )}
            </div>

            <footer>
              <button type="button" onClick={closeCreateDialog} disabled={exploreActive || controller.pending}>Отмена</button>
              {exploreActive ? (
                <button type="button" onClick={() => void controller.cancel()}>Остановить исследование</button>
              ) : (
                <button
                  type="submit"
                  className="primary-submit"
                  disabled={needsAgent || controller.pending || (exploreReady ? !newChange.trim() : !taskSummary.trim())}
                >
                  {exploreReady ? "Создать изменение" : "Исследовать задачу"}
                </button>
              )}
            </footer>
          </form>
        </div>
      )}

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
