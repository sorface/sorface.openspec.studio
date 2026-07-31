import type { GitStatusController } from "@/features/git/hooks/useGitStatusController";
import {
  parseUnifiedDiff,
  type DiffFile,
} from "@/features/git/model/unified-diff";

function stateLabel(value: string): string {
  if (value === " " || value === "") return "—";
  if (value === "?") return "untracked";
  if (value === "M") return "modified";
  if (value === "A") return "added";
  if (value === "D") return "deleted";
  if (value === "R") return "renamed";
  return value;
}

function DiffFileView({ file }: { file: DiffFile }) {
  return (
    <article className="git-diff-file">
      <header>
        <span className={`git-stage-badge ${file.stage}`}>
          {file.stage === "staged" ? "Подготовлено" : "Не подготовлено"}
        </span>
        <strong>{file.path}</strong>
      </header>
      {file.hunks.map((hunk, hunkIndex) => (
        <section className="git-diff-hunk" key={`${file.path}-${hunkIndex}`}>
          <div className="git-hunk-heading">
            Изменённый фрагмент{hunk.label ? ` · ${hunk.label}` : ""}
          </div>
          <div className="git-diff-lines">
            {hunk.lines.map((line, lineIndex) => (
              <div
                className={`git-diff-line ${line.kind}`}
                key={`${line.oldLine ?? "-"}-${line.newLine ?? "-"}-${lineIndex}`}
              >
                <span className="old-line">{line.oldLine ?? ""}</span>
                <span className="new-line">{line.newLine ?? ""}</span>
                <span className="diff-marker" aria-hidden="true">
                  {line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : ""}
                </span>
                <code>{line.content || " "}</code>
              </div>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

export function GitPanel({ controller }: { controller: GitStatusController }) {
  const diffFiles = parseUnifiedDiff(controller.status?.diff ?? "");

  return (
    <section className="git-panel" aria-label="Git-панель">
      <header className="git-panel-header">
        <div>
          <span className="eyebrow">STORE GIT</span>
          <h2>{controller.status?.branch || "detached HEAD"}</h2>
          {controller.status?.head && <code>{controller.status.head.slice(0, 12)}</code>}
        </div>
        <button type="button" onClick={controller.refresh} disabled={controller.loading}>
          {controller.loading ? "Обновление…" : "↻ Обновить"}
        </button>
      </header>

      {controller.loading && !controller.status && <div className="git-panel-state">Загрузка Git status…</div>}
      {controller.error && (
        <div className="git-panel-state error" role="alert">
          <b>{controller.error.message}</b>
          {controller.error.code === "INVALID_STORE" && <p>Создайте проект заново с локальным Store или через «Клонировать Store».</p>}
          {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
          <button type="button" onClick={controller.refresh}>Повторить</button>
        </div>
      )}
      {!controller.loading && !controller.error && controller.status?.changes.length === 0 && (
        <div className="git-panel-state clean"><span>✓</span><b>Изменений нет</b><p>Рабочее дерево Store совпадает с HEAD.</p></div>
      )}
      {!controller.error && controller.status && controller.status.changes.length > 0 && (
        <div className="git-panel-body">
          <aside className="git-changes">
            <h3>Изменения <b>{controller.status.changes.length}</b></h3>
            {controller.status.changes.map((change) => (
              <div className="git-change" key={`${change.index}:${change.worktree}:${change.path}`}>
                <span>{change.path}</span>
                <small>{stateLabel(change.index)} / {stateLabel(change.worktree)}</small>
              </div>
            ))}
          </aside>
          <div className="git-diff">
            <div className="git-diff-heading">
              <b>Изменения по строкам</b>
              <span className="git-diff-legend">
                <i className="addition" /> добавлено
                <i className="deletion" /> удалено
              </span>
              {controller.status.diffTruncated && <span>Ответ усечён сервером</span>}
            </div>
            <div className="git-diff-content">
              {diffFiles.length
                ? diffFiles.map((file, index) => (
                  <DiffFileView file={file} key={`${file.stage}-${file.path}-${index}`} />
                ))
                : <p className="git-diff-empty">Для новых файлов сравнение появится после добавления в индекс.</p>}
            </div>
          </div>
        </div>
      )}
      <footer className="git-panel-footer">Только просмотр · commit и push в этом режиме не выполняются</footer>
    </section>
  );
}
