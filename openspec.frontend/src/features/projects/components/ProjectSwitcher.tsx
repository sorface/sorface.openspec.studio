"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ProjectsController } from "@/features/projects/hooks/useProjectsController";

interface ProjectSwitcherProps {
  controller: ProjectsController;
}

type EditorMode = "list" | "create" | "rename" | "delete";

export function ProjectSwitcher({ controller }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>("list");
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const emptyPromptShown = useRef(false);

  useEffect(() => {
    if (controller.status === "empty" && !emptyPromptShown.current) {
      emptyPromptShown.current = true;
      setOpen(true);
    }
  }, [controller.status]);

  useEffect(() => {
    if (!open) return;
    const closePanel = () => {
      setOpen(false);
      setMode("list");
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePanel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mode, open]);

  const openEditor = (nextMode: EditorMode) => {
    setMode(nextMode);
    setName(nextMode === "rename" ? controller.activeProject?.name ?? "" : "");
    setGitUrl("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (mode === "create") {
        await controller.createFromGit({
          name: name.trim(),
          url: gitUrl.trim(),
        });
      } else if (mode === "rename" && controller.activeProject) {
        await controller.rename(controller.activeProject.id, name.trim());
      } else if (mode === "delete" && controller.activeProject) {
        await controller.remove(controller.activeProject.id);
      }
      setMode("list");
    } catch {
      // The controller exposes a safe ApiError inside the popover.
    }
  };

  const title = controller.status === "loading"
    ? "Загрузка проектов…"
    : controller.activeProject?.name ?? "Проекты не созданы";

  return (
    <div className="project-switcher-wrap" ref={rootRef}>
      <button
        className="project-switcher"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="project-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M8.5 7V5.75A1.75 1.75 0 0 1 10.25 4h3.5a1.75 1.75 0 0 1 1.75 1.75V7" />
            <path d="M5.25 7h13.5A2.25 2.25 0 0 1 21 9.25v8.5A2.25 2.25 0 0 1 18.75 20H5.25A2.25 2.25 0 0 1 3 17.75v-8.5A2.25 2.25 0 0 1 5.25 7Z" />
            <path d="M3 11.25c2.7 1.35 5.72 2.03 9 2.03s6.3-.68 9-2.03M10 12.9v1.6h4v-1.6" />
          </svg>
        </span>
        <b>{title}</b>
        <svg className={`project-chevron ${open ? "open" : ""}`} aria-hidden="true" viewBox="0 0 16 16">
          <path d="m4 6.5 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="project-popover" role="dialog" aria-label="Управление проектами" ref={panelRef}>
          {mode === "list" ? (
            <>
              <div className="project-popover-heading">
                <b>Проекты</b>
                <button type="button" aria-label="Закрыть управление проектами" onClick={() => setOpen(false)}>×</button>
              </div>

              {controller.status === "loading" && <p className="project-state">Загрузка проектов…</p>}
              {controller.status === "empty" && <p className="project-state">Проектов пока нет. Создайте первый проект.</p>}
              {controller.status === "unavailable" && (
                <div className="project-state error">
                  <p>Локальный backend недоступен.</p>
                  <button type="button" onClick={controller.retry}>Повторить</button>
                </div>
              )}
              {controller.status === "error" && (
                <div className="project-state error">
                  <p>{controller.error?.message}</p>
                  {controller.error?.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
                  <button type="button" onClick={controller.retry}>Повторить</button>
                </div>
              )}

              {controller.lastContextImport && (
                <div className={`project-state project-import-result ${controller.lastContextImport.failures.length ? "warning" : "success"}`} role="status">
                  <b>
                    {controller.lastContextImport.failures.length
                      ? "Контекст загружен частично"
                      : "Контекст проекта загружен"}
                  </b>
                  <p>
                    Подключено {controller.lastContextImport.imported} из {controller.lastContextImport.requested} репозиториев из <code>.openspec/context.yaml</code>.
                  </p>
                  {controller.lastContextImport.failures.map((failure) => (
                    <small key={`${failure.url}:${failure.code}`}>{failure.url}: {failure.message}</small>
                  ))}
                </div>
              )}

              {controller.projects.map((project) => (
                <button
                  type="button"
                  className={`project-option ${project.id === controller.activeProject?.id ? "active" : ""}`}
                  key={project.id}
                  onClick={() => {
                    controller.selectProject(project.id);
                    setOpen(false);
                  }}
                >
                  <span>{project.name.charAt(0).toUpperCase()}</span>
                  <b>{project.name}</b>
                  <small>OpenSpec Store</small>
                  {project.id === controller.activeProject?.id && <em>✓</em>}
                </button>
              ))}

              <div className="project-actions">
                <button type="button" onClick={() => openEditor("create")}>＋ Создать</button>
                <button type="button" disabled={!controller.activeProject} onClick={() => openEditor("rename")}>Переименовать</button>
                <button type="button" className="danger" disabled={!controller.activeProject} onClick={() => openEditor("delete")}>Удалить</button>
              </div>
            </>
          ) : (
            <form className="project-form" onSubmit={submit}>
              <div className="project-popover-heading">
                <b>{mode === "create" ? "Новый проект" : mode === "rename" ? "Переименовать проект" : "Удалить проект"}</b>
                <button type="button" aria-label="Назад к списку проектов" onClick={() => setMode("list")}>←</button>
              </div>

              {mode === "delete" ? (
                <p>Удалить «{controller.activeProject?.name}»? Каталоги Store и репозиториев останутся на диске.</p>
              ) : (
                <>
                  <label>
                    Название, если нет манифеста
                    <input autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Необязательное fallback-название" />
                    {mode === "create" && <small>Если в Store есть <code>.openspec/context.yaml</code>, название будет взято из поля <code>name</code>.</small>}
                  </label>
                  {mode === "create" && (
                    <label>
                      Клонировать Store из Git
                      <input required autoComplete="off" value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} placeholder="git@github.com:owner/store.git" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                      <small>Store и репозитории из <code>context.repositories</code> будут изолированы внутри ~/.osstudio.</small>
                    </label>
                  )}
                </>
              )}

              {controller.error && (
                <div className="form-error" role="alert">
                  {controller.error.message}
                  {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
                </div>
              )}
              <button
                className={mode === "delete" ? "danger-submit" : "primary-submit"}
                disabled={controller.mutationPending}
                type="submit"
              >
                {controller.mutationPending
                  ? mode === "create" ? "Загрузка проекта и контекста…" : "Выполняется…"
                  : mode === "delete" ? "Удалить только метаданные"
                    : mode === "create" ? "Загрузить проект"
                      : "Сохранить"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
