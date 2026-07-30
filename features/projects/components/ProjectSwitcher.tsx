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
  const [storePath, setStorePath] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setMode("list");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, open]);

  const openEditor = (nextMode: EditorMode) => {
    setMode(nextMode);
    setName(nextMode === "rename" ? controller.activeProject?.name ?? "" : "");
    setStorePath("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (mode === "create") {
        await controller.create({ name: name.trim(), storePath: storePath.trim() });
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
    <div className="project-switcher-wrap">
      <button
        className="project-switcher"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="project-avatar">{controller.activeProject?.name.charAt(0).toUpperCase() || "P"}</span>
        <span><small>ПРОЕКТ</small><b>{title}</b></span>
        <em>⌄</em>
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
                  <small>{project.storePath || "Store path не задан"}</small>
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
                    Название
                    <input required autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                  {mode === "create" && (
                    <label>
                      Путь к Store
                      <input required autoComplete="off" value={storePath} onChange={(event) => setStorePath(event.target.value)} placeholder="/path/to/store" />
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
                {controller.mutationPending ? "Выполняется…" : mode === "delete" ? "Удалить только метаданные" : "Сохранить"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
