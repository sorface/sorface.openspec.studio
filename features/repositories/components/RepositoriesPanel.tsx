"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { RepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import { cloneRecoveryHint } from "@/features/repositories/model/repository-operation";

export function RepositoriesPanel({ controller, enabled }: { controller: RepositoriesController; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const active = controller.operation && !["completed", "cancelled", "failed"].includes(controller.operation.status);

  const closeDialog = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDialog, open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await controller.startClone(url.trim());
      setUrl("");
      closeDialog();
    } catch {
      // Safe API error is rendered below.
    }
  };

  return (
    <section className="repositories-panel">
      <header className="repositories-panel-header">
        <div>
          <small>КОНТЕКСТ ПРОЕКТА</small>
          <h2>Контекст</h2>
          <p>Подключайте Git-репозитории, которые agent сможет использовать только для чтения.</p>
        </div>
        <button
          type="button"
          disabled={!enabled}
          title={enabled ? "Клонировать Git-репозиторий" : "Сначала создайте или выберите проект"}
          onClick={() => setOpen(true)}
        >
          ＋ Подключить репозиторий
        </button>
      </header>

      <div className="repositories-panel-body">
        {!enabled ? (
          <div className="repositories-state">
            <b>Проект не выбран</b>
            <p>Создайте или выберите проект, чтобы подключать репозитории контекста.</p>
          </div>
        ) : (
          <>
            <section className="repositories-list">
              <header>
                <div>
                  <h3>Подключённые репозитории</h3>
                  <span>{controller.repositories.length}</span>
                </div>
                <button type="button" onClick={controller.retry} disabled={controller.loading}>↻ Обновить</button>
              </header>

              {controller.loading && !active && <div className="repositories-state">Загрузка репозиториев…</div>}
              {!controller.loading && controller.repositories.length === 0 && !active && (
                <div className="repositories-state">
                  <b>Репозитории не подключены</b>
                  <p>Добавьте Git URL, чтобы расширить доступный agent контекст.</p>
                </div>
              )}
              <div className="repositories-grid">
                {controller.repositories.map((repository) => (
                  <article className="repository-card" key={repository.id}>
                    <i className="repo-icon">◆</i>
                    <div>
                      <b>{repository.name}</b>
                      <code>{repository.remoteUrl}</code>
                      <small>
                        {repository.available
                          ? `${repository.branch || "detached"} · ${repository.dirty ? "есть локальные изменения" : "чисто"}`
                          : "Репозиторий недоступен"}
                      </small>
                    </div>
                    <span className={repository.available ? "available" : "unavailable"}>
                      {repository.available ? "read-only" : "offline"}
                    </span>
                  </article>
                ))}
              </div>
              {controller.error && (
                <div className="repo-error" role="alert">
                  <b>{controller.error.message}</b>
                  <small>{cloneRecoveryHint(controller.error.code)}</small>
                  {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
                  <button type="button" onClick={() => setOpen(true)}>Исправить и повторить</button>
                </div>
              )}
              {active && (
                <div className="repo-progress">
                  <span>{controller.operation?.status === "validating" ? "Проверка репозитория…" : "Клонирование…"}</span>
                  <button type="button" onClick={() => void controller.cancel()}>Отменить</button>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {open && enabled && (
        <div
          className="repository-connect-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className="repository-connect-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="repository-connect-title"
          >
            <header>
              <div>
                <small>НОВЫЙ ИСТОЧНИК</small>
                <h3 id="repository-connect-title">Подключить Git-репозиторий</h3>
              </div>
              <button type="button" aria-label="Закрыть" onClick={closeDialog}>×</button>
            </header>
            <p>Введите SSH Git URL. Репозиторий будет клонирован и подключён как контекст только для чтения.</p>
            <form className="clone-form" aria-label="Клонирование Git-репозитория" onSubmit={submit}>
              <label>
                Git URL (SSH)
                <input
                  autoFocus
                  required
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="git@github.com:owner/repository.git"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              {controller.error && (
                <div className="repo-error" role="alert">
                  <b>{controller.error.message}</b>
                  <small>{cloneRecoveryHint(controller.error.code)}</small>
                  {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
                </div>
              )}
              <footer>
                <button type="button" className="secondary" onClick={closeDialog}>Отмена</button>
                <button type="submit" disabled={controller.loading || !url.trim()}>Клонировать</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
