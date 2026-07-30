"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { RepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";

export function RepositoriesPanel({ controller }: { controller: RepositoriesController }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const active = controller.operation && !["completed", "cancelled", "failed"].includes(controller.operation.status);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await controller.startClone(url.trim(), targetPath.trim());
      setOpen(false);
    } catch {
      // Safe API error is rendered below.
    }
  };

  return (
    <div className="repo-summary">
      <div className="sidebar-heading">
        <span>КОНТЕКСТ</span>
        <button type="button" onClick={() => setOpen((value) => !value)}>＋ Clone</button>
      </div>
      {open && (
        <form className="clone-form" role="dialog" aria-label="Клонирование Git-репозитория" onSubmit={submit}>
          <label>Git URL<input required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
          <label>Целевой каталог<input required value={targetPath} onChange={(event) => setTargetPath(event.target.value)} placeholder="/path/to/repository" /></label>
          <button type="submit" disabled={controller.loading}>Клонировать</button>
        </form>
      )}
      {controller.error && (
        <div className="repo-error" role="alert">
          {controller.error.message}
          {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
          <button type="button" onClick={controller.retry}>Повторить</button>
        </div>
      )}
      {active && (
        <div className="repo-progress">
          <span>{controller.operation?.status === "validating" ? "Проверка репозитория…" : "Клонирование…"}</span>
          <button type="button" onClick={() => void controller.cancel()}>Отменить</button>
        </div>
      )}
      {!controller.loading && controller.repositories.length === 0 && !active && <p className="repo-empty">Репозитории не подключены</p>}
      {controller.repositories.map((repository) => (
        <div className="repo-row" key={repository.id}>
          <i className="repo-icon">◆</i>
          <span><b>{repository.name}</b><small>{repository.available ? `${repository.branch || "detached"} · ${repository.dirty ? "изменён" : "чисто"}` : "недоступен"} · read-only</small></span>
          <em className={repository.available ? "" : "unavailable"} />
        </div>
      ))}
    </div>
  );
}
