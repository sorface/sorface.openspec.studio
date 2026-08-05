"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { OpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import { openSpecActionLabels } from "@/features/openspec-workflow/model/openspec-action-presentation";
import {
  createSplitLineDiff,
  summarizeSplitLineDiff,
  type SplitDiffRow,
} from "@/features/openspec-workflow/model/split-line-diff";
import {
  presentMarkdownDiff,
  type MarkdownDiffInlineToken,
  type MarkdownDiffLinePresentation,
} from "@/features/openspec-workflow/model/markdown-diff-presentation";
import type {
  OpenSpecExplorationQuestion,
  OpenSpecFileMutation,
} from "@/features/openspec-workflow/model/openspec-types";

interface OpenSpecOperationPanelProps {
  controller: OpenSpecWorkflowController;
  onClose?: () => void;
}

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

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function MarkdownDiffInline({ tokens }: { tokens: MarkdownDiffInlineToken[] }) {
  return tokens.map((token, index) => {
    const key = `${token.kind}-${index}`;
    if (token.kind === "code") return <code key={key}>{token.text}</code>;
    if (token.kind === "strong") return <strong key={key}>{token.text}</strong>;
    if (token.kind === "emphasis") return <em key={key}>{token.text}</em>;
    if (token.kind === "strike") return <del key={key}>{token.text}</del>;
    if (token.kind === "link") return <span className="markdown-inline-link" title={token.target} key={key}>{token.text}</span>;
    return token.text;
  });
}

function MarkdownDiffLine({ line }: { line?: MarkdownDiffLinePresentation }) {
  if (!line || line.kind === "blank") {
    return <div className="openspec-markdown-line kind-blank" aria-hidden="true">{"\u00a0"}</div>;
  }

  const content = <MarkdownDiffInline tokens={line.inline} />;
  const indent = { paddingInlineStart: `${12 + (line.indent ?? 0) * 7}px` };

  if (line.kind === "heading") {
    return (
      <div className={`openspec-markdown-line kind-heading level-${line.level}`} role="heading" aria-level={line.level}>
        <strong>{content}</strong>
      </div>
    );
  }
  if (line.kind === "task") {
    return (
      <div className="openspec-markdown-line kind-task" style={indent}>
        <span className={`markdown-task-box ${line.checked ? "checked" : ""}`} aria-hidden="true">{line.checked ? "✓" : ""}</span>
        <span>{content}</span>
      </div>
    );
  }
  if (line.kind === "unordered-list" || line.kind === "ordered-list") {
    return (
      <div className={`openspec-markdown-line kind-${line.kind}`} style={indent}>
        <span className="markdown-list-prefix" aria-hidden="true">{line.prefix ?? "•"}</span>
        <span>{content}</span>
      </div>
    );
  }
  if (line.kind === "quote") {
    return <div className="openspec-markdown-line kind-quote" style={indent}>{content}</div>;
  }
  if (line.kind === "code") {
    return <div className="openspec-markdown-line kind-code"><code>{line.text || "\u00a0"}</code></div>;
  }
  if (line.kind === "code-fence") {
    return <div className="openspec-markdown-line kind-code-fence">{line.language && <span>{line.language}</span>}</div>;
  }
  if (line.kind === "divider") {
    return <div className="openspec-markdown-line kind-divider" aria-hidden="true"><span /></div>;
  }
  return <div className="openspec-markdown-line kind-paragraph">{content}</div>;
}

function OperationConclusion({ markdown }: { markdown: string }) {
  const lines = presentMarkdownDiff(markdown);
  if (!lines.length) return null;

  return (
    <section className="openspec-operation-conclusion" aria-label="Заключение агента">
      <header>
        <span aria-hidden="true">✦</span>
        <div>
          <small>ЗАКЛЮЧЕНИЕ</small>
          <strong>Результат работы агента</strong>
        </div>
      </header>
      <div className="openspec-operation-conclusion-body">
        {lines.map((line, index) => (
          <MarkdownDiffLine line={line} key={`${line.kind}-${index}`} />
        ))}
      </div>
    </section>
  );
}

function ClarificationQuestion({
  question,
  values,
  onChange,
}: {
  question: OpenSpecExplorationQuestion;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  if (question.kind === "text") {
    return (
      <label className="openspec-clarification-question">
        <strong>{question.prompt}</strong>
        {question.why && <small>{question.why}</small>}
        <input
          type="text"
          value={values[0] ?? ""}
          onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
          placeholder="Введите уточнение…"
        />
      </label>
    );
  }
  return (
    <fieldset className="openspec-clarification-question">
      <legend>{question.prompt}</legend>
      {question.why && <small>{question.why}</small>}
      <div className="openspec-clarification-options">
        {(question.options ?? []).map((option) => {
          const checked = values.includes(option);
          return (
            <label key={option}>
              <input
                type={question.kind === "single_choice" ? "radio" : "checkbox"}
                name={`operation-question-${question.id}`}
                checked={checked}
                onChange={() => onChange(question.kind === "single_choice"
                  ? [option]
                  : checked ? values.filter((value) => value !== option) : [...values, option])}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function OperationClarification({ controller }: { controller: OpenSpecWorkflowController }) {
  const questions = controller.result?.exploration?.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  if (!questions.length) return null;
  const complete = questions.every((question) => (answers[question.id]?.length ?? 0) > 0);

  return (
    <section className="openspec-operation-clarification" aria-labelledby="operation-clarification-title">
      <header>
        <span aria-hidden="true">?</span>
        <div>
          <small>НУЖНО УТОЧНЕНИЕ</small>
          <strong id="operation-clarification-title">Agent ожидает ваш выбор</strong>
        </div>
      </header>
      {controller.result?.exploration?.summary && <p>{controller.result.exploration.summary}</p>}
      <div className="openspec-clarification-list">
        {questions.map((question) => (
          <ClarificationQuestion
            key={question.id}
            question={question}
            values={answers[question.id] ?? []}
            onChange={(values) => setAnswers((current) => ({ ...current, [question.id]: values }))}
          />
        ))}
      </div>
      <footer>
        <button
          type="button"
          className="primary-submit"
          disabled={!complete || controller.pending}
          onClick={() => void controller.respondToClarification(answers)}
        >
          Ответить и продолжить
        </button>
      </footer>
    </section>
  );
}

function SplitDiffCell({
  row,
  side,
  markdown,
}: {
  row: SplitDiffRow;
  side: "before" | "after";
  markdown: MarkdownDiffLinePresentation[];
}) {
  const cell = row[side];
  const tone = side === "before" && (row.kind === "remove" || row.kind === "change")
    ? "removed"
    : side === "after" && (row.kind === "add" || row.kind === "change")
      ? "added"
      : cell ? "unchanged" : "placeholder";
  const changeLabel = tone === "removed" ? `Удалено: ${cell?.text ?? ""}`
    : tone === "added" ? `Добавлено: ${cell?.text ?? ""}` : undefined;

  return (
    <div className={`openspec-split-diff-cell ${side} ${tone}`} role="cell" aria-label={changeLabel}>
      <MarkdownDiffLine line={cell ? markdown[cell.lineNumber - 1] : undefined} />
    </div>
  );
}

function MutationReview({ mutation, onOpenFinal }: { mutation: OpenSpecFileMutation; onOpenFinal: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const rows = createSplitLineDiff(mutation.before ?? "", mutation.after ?? "");
  const beforeMarkdown = presentMarkdownDiff(mutation.before ?? "");
  const afterMarkdown = presentMarkdownDiff(mutation.after ?? "");
  const summary = summarizeSplitLineDiff(rows);

  return (
    <article className={`openspec-mutation mutation-${mutation.type} ${collapsed ? "is-collapsed" : ""}`}>
      <header>
        <button
          type="button"
          className="openspec-mutation-toggle"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          aria-label={`${collapsed ? "Показать" : "Свернуть"} изменения ${mutation.path}`}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className="openspec-mutation-chevron" aria-hidden="true">
            <svg viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5" /></svg>
          </span>
          <b>{mutationLabels[mutation.type]}</b>
          <code>{mutation.previousPath ? `${mutation.previousPath} → ` : ""}{mutation.path}</code>
          <span className="openspec-mutation-summary" aria-label={`${summary.deletions} удалено, ${summary.additions} добавлено`}>
            <i className="removed">−{summary.deletions}</i>
            <i className="added">+{summary.additions}</i>
          </span>
        </button>
        {mutation.type !== "delete" && mutation.after !== undefined && (
          <button type="button" className="openspec-mutation-open-final" onClick={onOpenFinal}>
            <span aria-hidden="true">↗</span>
            Открыть итоговый Markdown
          </button>
        )}
      </header>
      {!collapsed && (
        <div id={contentId} className="openspec-split-diff" role="table" aria-label={`Сравнение ${mutation.path}`}>
          <div className="openspec-split-diff-head" role="row">
            <div role="columnheader"><b>До</b><span>Markdown</span></div>
            <div role="columnheader"><b>После</b><span>Markdown</span></div>
          </div>
          <div className="openspec-split-diff-body" role="rowgroup">
            {rows.length > 0 ? rows.map((row, index) => (
              <div className={`openspec-split-diff-row kind-${row.kind}`} role="row" key={`${row.kind}-${index}`}>
                <SplitDiffCell row={row} side="before" markdown={beforeMarkdown} />
                <SplitDiffCell row={row} side="after" markdown={afterMarkdown} />
              </div>
            )) : (
              <div className="openspec-split-diff-empty">Изменений содержимого нет</div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

interface ReviewComment {
  id: string;
  text: string;
}

function ResultMarkdownDialog({
  mutation,
  comments,
  pending,
  reviewable,
  canRepeat,
  onCommentsChange,
  onClose,
  onRepeat,
  onAccept,
}: {
  mutation: OpenSpecFileMutation;
  comments: ReviewComment[];
  pending: boolean;
  reviewable: boolean;
  canRepeat: boolean;
  onCommentsChange: (comments: ReviewComment[]) => void;
  onClose: () => void;
  onRepeat: () => Promise<boolean>;
  onAccept: () => Promise<boolean>;
}) {
  const titleId = useId();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState("");
  const markdown = presentMarkdownDiff(mutation.after ?? "");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const saveComment = () => {
    const text = draft.trim().slice(0, 1000);
    if (!text) return;
    if (editingId) {
      onCommentsChange(comments.map((comment) => comment.id === editingId ? { ...comment, text } : comment));
    } else if (comments.length < 8) {
      onCommentsChange([...comments, { id: `${Date.now()}-${comments.length}`, text }]);
    }
    setDraft("");
    setEditingId("");
  };

  return createPortal(
    <div className="openspec-result-dialog-backdrop">
      <section className="openspec-result-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div>
            <small>ИТОГОВЫЙ MARKDOWN</small>
            <h3 id={titleId}>{mutation.path}</h3>
          </div>
          <button type="button" aria-label="Закрыть полноэкранный просмотр" onClick={onClose}>×</button>
        </header>
        <div className={`openspec-result-dialog-content ${reviewable ? "" : "view-only"}`}>
          <main className="openspec-result-markdown" aria-label={`Итоговый Markdown ${mutation.path}`}>
            {markdown.length ? markdown.map((line, index) => (
              <MarkdownDiffLine line={line} key={`${line.kind}-${index}`} />
            )) : <p>Итоговый Markdown пуст.</p>}
          </main>
          {reviewable && <aside className="openspec-result-comments" aria-label="Замечания к итоговому Markdown">
            <header>
              <div><small>ПРОВЕРКА</small><h4>Комментарии</h4></div>
              <span>{comments.length}/8</span>
            </header>
            <div className="openspec-result-comments-list">
              {comments.length === 0 && <p>Добавьте замечания, чтобы повторить этот этап с их учётом.</p>}
              {comments.map((comment, index) => (
                <article key={comment.id}>
                  <strong>Комментарий {index + 1}</strong>
                  <p>{comment.text}</p>
                  <div>
                    <button type="button" onClick={() => { setEditingId(comment.id); setDraft(comment.text); }}>Редактировать</button>
                    <button type="button" onClick={() => onCommentsChange(comments.filter((item) => item.id !== comment.id))}>Удалить</button>
                  </div>
                </article>
              ))}
            </div>
            <label className="openspec-result-comment-editor">
              <span>{editingId ? "Редактировать комментарий" : "Новый комментарий"}</span>
              <textarea
                value={draft}
                maxLength={1000}
                rows={5}
                placeholder="Опишите, что нужно изменить в итоговом Markdown…"
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <div className="openspec-result-comment-editor-actions">
              {editingId && <button type="button" onClick={() => { setEditingId(""); setDraft(""); }}>Отменить</button>}
              <button type="button" onClick={saveComment} disabled={!draft.trim() || (!editingId && comments.length >= 8)}>
                {editingId ? "Сохранить" : "Добавить комментарий"}
              </button>
            </div>
          </aside>}
        </div>
        <footer>
          <button type="button" className="secondary-action" onClick={onClose}>Вернуться к сравнению</button>
          {reviewable && <div>
            {canRepeat && (
              <button type="button" className="secondary-action" disabled={pending || comments.length === 0} onClick={() => void onRepeat()}>
                {pending ? "Запускаем…" : "Повторить этап с комментариями"}
              </button>
            )}
            <button type="button" className="primary-submit" disabled={pending} onClick={() => void onAccept()}>
              {pending ? "Принимаем…" : "Принять исправления"}
            </button>
          </div>}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function OpenSpecOperationPanel({ controller, onClose }: OpenSpecOperationPanelProps) {
  const operation = controller.operation;
  const [reviewState, setReviewState] = useState<{
    operationId: string;
    selectedMutationIndex: number | null;
    comments: ReviewComment[];
  } | null>(null);

  if (!operation) return null;
  const operationActive = ["queued", "running", "validating"].includes(operation.status);
  const currentReviewState = reviewState?.operationId === operation.id ? reviewState : null;
  const selectedMutationIndex = currentReviewState?.selectedMutationIndex ?? null;
  const reviewComments = currentReviewState?.comments ?? [];
  const selectedMutation = selectedMutationIndex === null
    ? undefined
    : controller.result?.files[selectedMutationIndex];
  const reviewable = operation.status === "awaiting_review";
  const canRepeat = reviewable && ["prepare_artifact", "fix_artifact"].includes(operation.openspecAction);

  const closeResultDialog = () => setReviewState((current) => current?.operationId === operation.id
    ? { ...current, selectedMutationIndex: null }
    : current);
  const changeReviewComments = (comments: ReviewComment[]) => setReviewState((current) => ({
    operationId: operation.id,
    selectedMutationIndex: current?.operationId === operation.id ? current.selectedMutationIndex : null,
    comments,
  }));
  const repeatWithFeedback = async () => {
    const repeated = await controller.repeatWithFeedback(reviewComments.map((comment) => comment.text));
    if (repeated) {
      changeReviewComments([]);
      closeResultDialog();
    }
    return repeated;
  };
  const acceptResult = async () => {
    const accepted = await controller.accept();
    if (accepted) closeResultDialog();
    return accepted;
  };

  return (
    <>
    <section className={`openspec-operation status-${operation.status}`} aria-live="polite">
      <header>
        <div>
          <small>ОПЕРАЦИЯ</small>
          <h4>
            {openSpecActionLabels[operation.openspecAction] ?? operation.openspecAction}
            {operation.openspecChange ? ` · ${operation.openspecChange}` : ""}
          </h4>
        </div>
        <div className="openspec-operation-heading-actions">
          <b>{operationStatusLabels[operation.status]}</b>
          {onClose && (
            <button type="button" aria-label="Закрыть результат операции" onClick={onClose}>×</button>
          )}
        </div>
      </header>
      <div className="openspec-operation-scroll">
        {controller.artifactRefresh?.change === operation.openspecChange && (
        <div className={`artifact-refresh-operation-status status-${controller.artifactRefresh.status}`}>
          <ol aria-label="Этапы пересогласования">
            {controller.artifactRefresh.steps.map((step, index) => (
              <li
                key={step}
                className={controller.artifactRefresh!.completed.includes(step as "specs" | "design" | "tasks")
                  ? "complete"
                  : controller.artifactRefresh!.current === step ? "current" : ""}
              >
                <i>{index + 1}</i><span>{step === "specs" ? "diff specs" : `${step}.md`}</span>
              </li>
            ))}
          </ol>
        </div>
        )}
        {operationActive && (
        <div className="openspec-operation-running">
          <div className="openspec-operation-running-header">
            <span className="operation-spinner" />
            <b className="openspec-operation-progress">
              <span>{controller.operationProgress || "Agent работает…"}</span>
            </b>
            <time aria-label={`Время выполнения ${formatElapsedTime(controller.operationElapsedSeconds)}`}>
              {formatElapsedTime(controller.operationElapsedSeconds)}
            </time>
            <button
              type="button"
              className="openspec-operation-cancel"
              onClick={() => void controller.cancel()}
            >
              Отменить
            </button>
          </div>
          {controller.operationActivity.length > 0 && (
            <div className="openspec-operation-activity" aria-label="Ход работы агента">
              <small>ХОД РАБОТЫ АГЕНТА</small>
              <ol>
                {controller.operationActivity.map((message, index) => (
                  <li className={index === controller.operationActivity.length - 1 ? "current" : ""} key={`${index}-${message}`}>
                    <i aria-hidden="true" />
                    <span>{message}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        )}
        {operation.status === "failed" && (
        <div className="openspec-operation-error" role="alert">
          <b>{operation.errorCode}</b>
          <p>{operation.errorMessage}</p>
          {operation.correlationId && <small>Correlation ID: {operation.correlationId}</small>}
        </div>
        )}
        {operation.status === "cancelled" && <p>Операция отменена. Store не изменён.</p>}
        {controller.result && (
        <div className="openspec-review">
          {controller.result.exploration?.state === "needs_input" && (
            <OperationClarification key={operation.id} controller={controller} />
          )}
          {controller.result.finalResponse && controller.result.exploration?.state !== "needs_input" && (
            <OperationConclusion markdown={controller.result.finalResponse} />
          )}
          {!!controller.result.diagnostics?.length && (
            <div className="openspec-result-diagnostics">
              {controller.result.diagnostics.map((diagnostic, index) => (
                <p key={`${diagnostic.path}-${index}`}>
                  <b>{diagnostic.level}</b> {diagnostic.path && <code>{diagnostic.path}</code>} {diagnostic.message}
                </p>
              ))}
            </div>
          )}
          {operation.openspecAction !== "explore" && controller.result.exploration?.state !== "needs_input" && (
            <h4>Предпросмотр полного набора изменений ({controller.result.files.length})</h4>
          )}
          {operation.openspecAction === "archive" && (
            <div className="archive-warning">
              Архивирование принимается только целиком. Частичный выбор файлов запрещён.
            </div>
          )}
          {operation.openspecAction !== "explore" && controller.result.files.map((mutation, index) => (
            <MutationReview
              key={`${mutation.type}-${mutation.path}-${index}`}
              mutation={mutation}
              onOpenFinal={() => setReviewState((current) => ({
                operationId: operation.id,
                selectedMutationIndex: index,
                comments: current?.operationId === operation.id && current.selectedMutationIndex === index
                  ? current.comments
                  : [],
              }))}
            />
          ))}
        </div>
        )}
      </div>
      {operation.status === "awaiting_review" && operation.openspecAction !== "explore" &&
        controller.result?.exploration?.state !== "needs_input" && (
        <div className="openspec-operation-footer">
          {controller.error && (
            <div className="openspec-review-action-error" role="alert">
              <b>Не удалось принять результат</b>
              <span>{controller.error.message}</span>
              {controller.error.code && <small>Код: {controller.error.code}</small>}
            </div>
          )}
          <div className="openspec-review-actions">
            <button type="button" className="secondary-danger" onClick={() => void controller.reject()} disabled={controller.pending}>
              Отклонить
            </button>
            <button type="button" className="primary-submit" onClick={() => void controller.accept()} disabled={controller.pending}>
              {controller.pending ? "Принимаем…" : "Принять весь набор"}
            </button>
          </div>
        </div>
      )}
      {controller.draft && (
        <div className={`openspec-draft status-${controller.draft.status}`}>
          <div className="openspec-draft-card">
            <span className="openspec-draft-status-icon" aria-hidden="true">✓</span>
            <div className="openspec-draft-copy">
              <b>{controller.draft.status === "written" ? "Записано в Store" : "Результат принят как draft"}</b>
              {controller.draft.status === "accepted" && (
                <p>Проверьте набор ещё раз — только явная запись изменит Store.</p>
              )}
            </div>
            {controller.draft.status === "accepted" && (
              <button
                type="button"
                className="openspec-draft-write-button"
                onClick={() => void controller.write()}
                disabled={controller.pending}
              >
                Записать {controller.draft.mutations.length} изменений в Store
              </button>
            )}
          </div>
        </div>
      )}
    </section>
    {selectedMutation && (
      <ResultMarkdownDialog
        mutation={selectedMutation}
        comments={reviewComments}
        pending={controller.pending}
        reviewable={reviewable}
        canRepeat={canRepeat}
        onCommentsChange={changeReviewComments}
        onClose={closeResultDialog}
        onRepeat={repeatWithFeedback}
        onAccept={acceptResult}
      />
    )}
    </>
  );
}
