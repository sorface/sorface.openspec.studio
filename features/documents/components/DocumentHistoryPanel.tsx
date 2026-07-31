import { IconButton } from "@/components/ui/IconButton";
import type { DocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";

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

export function DocumentHistoryPanel({ controller, path }: DocumentHistoryPanelProps) {
  const fileName = path.split("/").at(-1) ?? path;

  return (
    <aside className="file-history-panel" role="dialog" aria-label={`История файла ${fileName}`}>
      <header>
        <div>
          <span className="eyebrow">GIT HISTORY</span>
          <h2>История файла</h2>
          <p title={path}>{fileName}</p>
        </div>
        <IconButton label="Закрыть историю файла" onClick={controller.close}>×</IconButton>
      </header>

      <div className="file-history-body">
        {controller.status === "loading" && <p className="file-history-state">Загрузка истории…</p>}
        {controller.status === "empty" && (
          <p className="file-history-state">В Git пока нет коммитов для этого файла.</p>
        )}
        {controller.status === "error" && (
          <div className="file-history-state error" role="alert">
            <p>{controller.error?.message ?? "Не удалось загрузить историю файла"}</p>
            {controller.error?.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
            <button type="button" onClick={controller.retry}>Повторить</button>
          </div>
        )}
        {controller.status === "ready" && (
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
      <footer>Только просмотр · последние 100 коммитов</footer>
    </aside>
  );
}
