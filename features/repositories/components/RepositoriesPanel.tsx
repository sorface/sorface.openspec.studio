"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { RepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import { cloneRecoveryHint } from "@/features/repositories/model/repository-operation";
import type { RepositoryLink } from "@/features/repositories/model/repository-types";

function RepositoryCard({ repository, controller }: {
  repository: RepositoryLink;
  controller: RepositoriesController;
}) {
  const [target, setTarget] = useState(`local:${repository.branch ?? ""}`);
  const busy = controller.busyRepositoryId === repository.id;
  const remote = target.startsWith("remote:");
  const branch = target.slice(target.indexOf(":") + 1);
  const currentTarget = `local:${repository.branch ?? ""}`;
  const selectableRemoteBranches = repository.remoteBranches.filter((item) => {
    const localName = item.slice(item.indexOf("/") + 1);
    return !repository.localBranches.includes(localName);
  });

  const switchBranch = async () => {
    try {
      await controller.switchBranch(repository.id, branch, remote);
      const localBranch = remote ? branch.slice(branch.indexOf("/") + 1) : branch;
      setTarget(`local:${localBranch}`);
    } catch {
      // Safe API error is rendered by the parent panel.
    }
  };

  return (
    <article className="repository-card">
      <i className="repo-icon">◆</i>
      <div className="repository-card-info">
        <b>{repository.name}</b>
        <code>{repository.remoteUrl}</code>
        <small>
          {repository.available
            ? `${repository.branch || "detached"} · ${repository.dirty ? "есть локальные изменения" : "чисто"}`
            : "Репозиторий недоступен"}
          {repository.upstream && ` · ${repository.upstream}`}
          {(repository.ahead > 0 || repository.behind > 0) && ` · ↑${repository.ahead} ↓${repository.behind}`}
        </small>
      </div>
      <span className={`repository-access ${repository.available ? "available" : "unavailable"}`}>
        {repository.available ? "AI: read-only" : "offline"}
      </span>
      {repository.available && (
        <div className="repository-card-controls">
          <label>
            <span>Ветка</span>
            <select
              aria-label={`Ветка репозитория ${repository.name}`}
              value={target}
              disabled={busy || repository.dirty}
              onChange={(event) => setTarget(event.target.value)}
            >
              <optgroup label="Локальные ветки">
                {repository.localBranches.map((item) => (
                  <option key={`local:${item}`} value={`local:${item}`}>{item}</option>
                ))}
              </optgroup>
              {selectableRemoteBranches.length > 0 && (
                <optgroup label="Remote branches">
                  {selectableRemoteBranches.map((item) => (
                    <option key={`remote:${item}`} value={`remote:${item}`}>{item}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || repository.dirty || !branch || target === currentTarget}
            title={repository.dirty ? "Сначала сохраните локальные изменения" : "Переключить существующую ветку"}
            onClick={() => void switchBranch()}
          >
            {busy && controller.busyAction === "switch" ? "Переключение…" : "Перейти"}
          </button>
          <button
            type="button"
            className="repository-update-button"
            disabled={busy || repository.dirty || !repository.upstream}
            title={repository.upstream ? `Получить обновления из ${repository.upstream}` : "Для ветки не настроен upstream"}
            onClick={() => void controller.update(repository.id)}
          >
            {busy && controller.busyAction === "update" ? "Получение…" : "↓ Получить обновления"}
          </button>
        </div>
      )}
    </article>
  );
}

export function RepositoriesPanel({ controller, enabled }: { controller: RepositoriesController; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const active = controller.operation && !["completed", "cancelled", "failed"].includes(controller.operation.status);
  const repositoryActionError = controller.error && [
    "WORKTREE_DIRTY", "GIT_BRANCH_NOT_FOUND", "GIT_BRANCH_EXISTS", "GIT_UPSTREAM_MISSING",
    "GIT_FAST_FORWARD_REQUIRED", "GIT_TIMEOUT", "GIT_OPERATION_FAILED",
  ].includes(controller.error.code);

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
                <button type="button" onClick={controller.retry} disabled={controller.loading}>↻ Перечитать</button>
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
                  <RepositoryCard key={repository.id} repository={repository} controller={controller} />
                ))}
              </div>
              {controller.error && (
                <div className="repo-error" role="alert">
                  <b>{controller.error.message}</b>
                  <small>{cloneRecoveryHint(controller.error.code)}</small>
                  {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
                  <button type="button" onClick={repositoryActionError ? controller.retry : () => setOpen(true)}>
                    {repositoryActionError ? "Перечитать состояние" : "Исправить и повторить"}
                  </button>
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
