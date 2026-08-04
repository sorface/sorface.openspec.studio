"use client";

import { useId, useState } from "react";
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
import type { OpenSpecFileMutation } from "@/features/openspec-workflow/model/openspec-types";

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

function MutationReview({ mutation }: { mutation: OpenSpecFileMutation }) {
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

export function OpenSpecOperationPanel({ controller, onClose }: OpenSpecOperationPanelProps) {
  const operation = controller.operation;
  if (!operation) return null;
  const operationActive = ["queued", "running", "validating"].includes(operation.status);

  return (
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
          <span className="operation-spinner" />
          <div>
            <b className="openspec-operation-progress">
              <span>{controller.operationProgress || "Agent работает…"}</span>
              <time aria-label={`Время выполнения ${formatElapsedTime(controller.operationElapsedSeconds)}`}>
                {formatElapsedTime(controller.operationElapsedSeconds)}
              </time>
            </b>
          </div>
          <button
            type="button"
            className="openspec-operation-cancel"
            onClick={() => void controller.cancel()}
          >
            Отменить
          </button>
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
          {controller.result.finalResponse && (
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
          {operation.openspecAction !== "explore" && (
            <h4>Предпросмотр полного набора изменений ({controller.result.files.length})</h4>
          )}
          {operation.openspecAction === "archive" && (
            <div className="archive-warning">
              Архивирование принимается только целиком. Частичный выбор файлов запрещён.
            </div>
          )}
          {operation.openspecAction !== "explore" && controller.result.files.map((mutation, index) => (
            <MutationReview key={`${mutation.type}-${mutation.path}-${index}`} mutation={mutation} />
          ))}
          {operation.status === "awaiting_review" && operation.openspecAction !== "explore" && (
            <div className="openspec-review-actions">
              <button type="button" className="secondary-danger" onClick={() => void controller.reject()}>
                Отклонить
              </button>
              <button type="button" className="primary-submit" onClick={() => void controller.accept()} disabled={controller.pending}>
                Принять весь набор
              </button>
            </div>
          )}
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
  );
}
