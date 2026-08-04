"use client";

import { FormEvent, useEffect, useState } from "react";
import type { TaskContextController } from "@/features/task-context/hooks/useTaskContextController";

interface PublicationDialogProps {
  controller: TaskContextController;
  onPublished: (task: string) => void;
}

export function PublicationDialog({ controller, onPublished }: PublicationDialogProps) {
  const preview = controller.preview;
  const [draft, setDraft] = useState({ token: "", message: "", body: "" });
  const message = preview && draft.token === preview.token ? draft.message : preview?.message ?? "";
  const body = preview && draft.token === preview.token ? draft.body : preview?.body ?? "";

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") controller.dismissPublication();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, preview]);

  if (!preview) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await controller.publish(message, body);
      onPublished(result.task);
    } catch {
      // The dialog keeps the exact preview visible and renders the safe API error.
    }
  };

  const generate = async () => {
    try {
      const generated = await controller.generatePublicationMessage();
      setDraft({ token: generated.token, message: generated.message, body: generated.body ?? "" });
    } catch {
      // Keep the user's exact draft and show the recoverable controller error.
    }
  };

  return (
    <div className="publication-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) controller.dismissPublication();
    }}>
      <section className="publication-dialog" role="dialog" aria-modal="true" aria-labelledby="publication-title">
        <header>
          <div className="publication-task-mark" aria-hidden="true">◇</div>
          <div>
            <small>ЗАДАЧА {preview.task}</small>
            <h2 id="publication-title">Опубликовать артефакты</h2>
            <p>Проверьте состав и название публикации перед отправкой.</p>
          </div>
          <button type="button" aria-label="Закрыть публикацию" onClick={controller.dismissPublication}>×</button>
        </header>

        <div className="publication-content">
          <div className="publication-files">
            <div className="publication-section-title">
              <b>OpenSpec-файлы</b>
              <span>{preview.paths.length}</span>
            </div>
            <ul>
              {preview.paths.map((path) => <li key={path}>{path.replace(/^openspec\//, "")}</li>)}
            </ul>
            {preview.excludedCount > 0 && (
              <p>Ещё {preview.excludedCount} {preview.excludedCount === 1 ? "изменение останется" : "изменения останутся"} в задаче и не попадут в публикацию.</p>
            )}
          </div>

          <form onSubmit={submit}>
            <div className="publication-field">
              <div className="publication-message-heading">
                <label htmlFor="publication-message">Название публикации</label>
                <em>{preview.generatedBy === "agent" ? "предложено агентом" : "можно изменить"}</em>
                <button
                  type="button"
                  disabled={controller.generating || controller.publishing}
                  onClick={() => void generate()}
                >{controller.generating ? "Генерируем…" : "Сгенерировать"}</button>
              </div>
              <input id="publication-message" autoFocus value={message} onChange={(event) => setDraft({ token: preview.token, message: event.target.value, body })} required />
            </div>
            <label>
              <span>Список изменений <small>необязательно при ручном вводе</small></span>
              <textarea rows={6} value={body} onChange={(event) => setDraft({ token: preview.token, message, body: event.target.value })} placeholder="- Кратко опишите изменение" />
            </label>
            {preview.diffTruncated && <p className="publication-note">Агент получил сокращённый diff; полный набор файлов будет опубликован.</p>}
            {controller.error && <p className="publication-error" role="alert">{controller.error.message}</p>}
            <footer>
              <span>Только артефакты задачи <b>{preview.task}</b></span>
              <div>
                <button type="button" onClick={controller.dismissPublication} disabled={controller.generating || controller.publishing}>Отмена</button>
                <button className="publication-primary" type="submit" disabled={!message.trim() || controller.generating || controller.publishing}>
                  {controller.publishing ? "Публикуем…" : "Опубликовать"}
                </button>
              </div>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
