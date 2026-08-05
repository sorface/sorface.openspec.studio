"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { TaskContextController } from "@/features/task-context/hooks/useTaskContextController";

interface TaskContextSelectorProps {
  controller: TaskContextController;
  onPublish: () => void;
  onReceive: () => void;
  projectSelected: boolean;
}

export function TaskContextSelector({ controller, onPublish, onReceive, projectSelected }: TaskContextSelectorProps) {
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const active = controller.overview?.active;
  const triggerLabel = active
    ? `Задача: ${active.branch}${active.dirty ? ", есть локальные изменения" : ""}`
    : "Задача: выбрать";
  const actionDisabled = !active || controller.switching || controller.syncing || controller.preparing || controller.publishing;
  const { localChoices, remoteChoices } = useMemo(() => {
    const existing = new Map(controller.overview?.items.map((item) => [item.branch, item]) ?? []);
    const localNames = Array.from(new Set([
      ...(controller.overview?.items.map((item) => item.branch) ?? []),
      ...(controller.overview?.availableBranches ?? []),
    ]));
    const localSet = new Set(localNames);
    const remoteNames = Array.from(new Set(controller.overview?.remoteBranches ?? []))
      .filter((name) => name.startsWith("origin/") && !localSet.has(name.slice("origin/".length)));
    return {
      localChoices: localNames.map((name) => ({ name, workspace: existing.get(name) })),
      remoteChoices: remoteNames,
    };
  }, [controller.overview]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!branch.trim()) return;
    try {
      await controller.openTask(branch);
      setBranch("");
      setOpen(false);
    } catch {
      // The controller exposes a safe, actionable error inside this popover.
    }
  };

  const select = async (next: string) => {
    if (next === active?.branch) {
      setOpen(false);
      return;
    }
    try {
      await controller.openTask(next);
      setOpen(false);
    } catch {
      // Keep the popover open so the user can act on the controller error.
    }
  };

  const selectRemote = async (remoteBranch: string) => {
    try {
      await controller.openRemoteTask(remoteBranch);
      setOpen(false);
    } catch {
      // Keep the popover open so the user can refresh stale remote refs.
    }
  };

  return (
    <div className="task-context" ref={root}>
      <button
        className={`task-context-trigger ${active?.dirty ? "dirty" : ""}`}
        type="button"
        disabled={!projectSelected}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          controller.clearError();
          setOpen((current) => !current);
        }}
      >
        <svg className="task-branch-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="4" cy="3" r="1.5" />
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="4" cy="13" r="1.5" />
          <path d="M4 4.5v7M5.5 10h1A5.5 5.5 0 0 0 12 6.5" />
        </svg>
        <b className="task-context-branch">{controller.switching ? "Переключаем…" : active?.branch || "Выбрать задачу"}</b>
        {active?.dirty && <i className="task-dirty-dot" aria-hidden="true" />}
        <svg className={`task-context-chevron ${open ? "open" : ""}`} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>

      {open && (
        <div className="task-context-popover" role="dialog" aria-label="Выбор задачи">
          <form onSubmit={submit}>
            <label htmlFor="task-branch">Номер задачи или ветка</label>
            <div>
              <input
                id="task-branch"
                autoFocus
                autoComplete="off"
                placeholder="Номер задачи или ветка"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
              />
            </div>
          </form>
          {controller.error && (
            <div className="task-context-error" role="alert">
              {controller.error.message}
              {controller.error.correlationId && <small>Код: {controller.error.correlationId}</small>}
            </div>
          )}
          {(localChoices.length > 0 || remoteChoices.length > 0) && (
            <div className="task-context-list">
              {localChoices.length > 0 && <small>Локальные ветки</small>}
              {localChoices.map(({ name, workspace }) => (
                <button
                  key={name}
                  type="button"
                  className={name === active?.branch ? "active" : ""}
                  onClick={() => void select(name)}
                  disabled={controller.switching}
                >
                  <span>{name}</span>
                  {workspace?.dirty && <i title="Есть неопубликованные изменения" />}
                  {name === active?.branch && (
                    <svg viewBox="0 0 16 16" aria-label="Текущая задача"><path d="m3.5 8 3 3 6-6" /></svg>
                  )}
                </button>
              ))}
              {remoteChoices.length > 0 && <small>Удалённые ветки</small>}
              {remoteChoices.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => void selectRemote(name)}
                  disabled={controller.switching}
                >
                  <span>{name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="task-context-actions" aria-label="Действия текущей задачи">
            <button
              type="button"
              disabled={actionDisabled}
              title={controller.syncing ? "Получаем изменения…" : "Получить изменения текущей задачи из remote"}
              onClick={() => {
                setOpen(false);
                onReceive();
              }}
            >
              <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3.2v9.2m0 0 3.3-3.3M9 12.4 5.7 9.1M4 13v.5A1.5 1.5 0 0 0 5.5 15h7a1.5 1.5 0 0 0 1.5-1.5V13" /></svg>
              <span>Получить изменения</span>
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              title={controller.preparing ? "Готовим публикацию…" : "Опубликовать OpenSpec-артефакты текущей задачи"}
              onClick={() => {
                setOpen(false);
                onPublish();
              }}
            >
              <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 12.8V3.6m0 0L5.7 6.9M9 3.6l3.3 3.3M4 11.4v2.1A1.5 1.5 0 0 0 5.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-2.1" /></svg>
              <span>Опубликовать изменения</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
