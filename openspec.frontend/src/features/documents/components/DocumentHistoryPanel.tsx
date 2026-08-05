import { useMemo, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import type { DocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import { expandDocumentAnnotations } from "@/features/documents/model/document-annotations";

interface DocumentHistoryPanelProps {
  controller: DocumentHistoryController;
  path: string;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatAnnotationDate(value?: string): string {
  if (!value) return "Локально";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function DocumentHistoryPanel({ controller, path }: DocumentHistoryPanelProps) {
  const fileName = path.split("/").at(-1) ?? path;
  const [activeTab, setActiveTab] = useState<"annotations" | "commits">("annotations");
  const annotationsActive = activeTab === "annotations";
  const annotationLines = useMemo(
    () => expandDocumentAnnotations(controller.annotations),
    [controller.annotations],
  );

  return (
    <aside className={`file-history-panel ${annotationsActive ? "annotations-view" : "commits-view"}`} role="dialog" aria-label={`Git-аннотации и история файла ${fileName}`}>
      <header>
        <div>
          <span className="eyebrow">GIT INSIGHTS</span>
          <h2>{annotationsActive ? "Git-аннотации" : "История файла"}</h2>
          <p title={path}>{fileName}</p>
        </div>
        <IconButton label="Закрыть Git-панель файла" onClick={controller.close}>×</IconButton>
      </header>

      <nav className="file-history-tabs" aria-label="Режим Git-панели">
        <button
          type="button"
          className={annotationsActive ? "active" : ""}
          aria-pressed={annotationsActive}
          onClick={() => setActiveTab("annotations")}
        >
          Аннотации <span>{annotationLines.length}</span>
        </button>
        <button
          type="button"
          className={!annotationsActive ? "active" : ""}
          aria-pressed={!annotationsActive}
          onClick={() => setActiveTab("commits")}
        >
          Коммиты <span>{controller.items.length}</span>
        </button>
      </nav>

      <div className="file-history-body">
        {controller.status === "loading" && <p className="file-history-state">Загрузка Git-данных…</p>}
        {controller.status === "empty" && (
          <p className="file-history-state">В Git пока нет данных для этого файла.</p>
        )}
        {controller.status === "error" && (
          <div className="file-history-state error" role="alert">
            <p>{controller.error?.message ?? "Не удалось загрузить Git-данные файла"}</p>
            {controller.error?.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
            <button type="button" onClick={controller.retry}>Повторить</button>
          </div>
        )}
        {controller.status === "ready" && annotationsActive && annotationLines.length === 0 && (
          <p className="file-history-state">Для текущей версии нет аннотаций.</p>
        )}
        {controller.status === "ready" && annotationsActive && annotationLines.length > 0 && (
          <div className="file-annotation-table" role="table" aria-label={`Построчные Git-аннотации ${fileName}`}>
            <div className="file-annotation-table-head" role="row">
              <span role="columnheader">Дата</span>
              <span role="columnheader">Автор</span>
              <span role="columnheader">Строка</span>
              <span role="columnheader">Markdown</span>
            </div>
            {annotationLines.map((entry) => {
              const commitContext = entry.local
                ? "Локальные изменения · ещё не сохранено в Git"
                : `${entry.subject || "Коммит без сообщения"} · ${entry.hash ?? entry.shortHash ?? ""}`;
              return (
                <div
                  key={`${entry.lineNumber}-${entry.hash ?? "local"}`}
                  className={`file-annotation-row ${entry.local ? "local" : ""} ${entry.groupStart ? "group-start" : ""}`}
                  role="row"
                  title={commitContext}
                  aria-label={`Строка ${entry.lineNumber}, ${entry.author}, ${formatAnnotationDate(entry.authoredAt)}. ${commitContext}`}
                >
                  {entry.authoredAt ? (
                    <time role="cell" dateTime={entry.authoredAt}>{formatAnnotationDate(entry.authoredAt)}</time>
                  ) : (
                    <span role="cell" className="file-annotation-local">Локально</span>
                  )}
                  <strong role="cell" title={entry.authorEmail}>{entry.author}</strong>
                  <span role="cell" className="file-annotation-number">{entry.lineNumber}</span>
                  <code role="cell">{entry.content || " "}</code>
                </div>
              );
            })}
          </div>
        )}
        {controller.status === "ready" && !annotationsActive && controller.items.length === 0 && (
          <p className="file-history-state">В Git пока нет коммитов для этого файла.</p>
        )}
        {controller.status === "ready" && !annotationsActive && controller.items.length > 0 && (
          <ol className="file-history-list">
            {controller.items.map((entry) => (
              <li key={entry.hash}>
                <strong>{entry.subject || "Коммит без сообщения"}</strong>
                <div>
                  <span>{entry.author}</span>
                  <time dateTime={entry.committedAt}>{formatDate(entry.committedAt)}</time>
                </div>
                <code title={entry.hash}>{entry.shortHash}</code>
              </li>
            ))}
          </ol>
        )}
      </div>
      <footer>{annotationsActive ? "Только просмотр · git blame текущей версии" : "Только просмотр · последние 100 коммитов"}</footer>
    </aside>
  );
}
