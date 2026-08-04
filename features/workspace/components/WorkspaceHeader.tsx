"use client";

import { useMemo } from "react";
import { LogoMark } from "@/components/ui/LogoMark";
import { ProjectSwitcher } from "@/features/projects/components/ProjectSwitcher";
import type { ProjectsController } from "@/features/projects/hooks/useProjectsController";
import { TaskContextSelector } from "@/features/task-context/components/TaskContextSelector";
import type { TaskContextController } from "@/features/task-context/hooks/useTaskContextController";

interface WorkspaceHeaderProps {
  agentSettingsOpen: boolean;
  onAgentSettingsToggle: () => void;
  onPublish: () => void;
  onReceive: () => void;
  projects: ProjectsController;
  tasks: TaskContextController;
}

export function WorkspaceHeader({ agentSettingsOpen, onAgentSettingsToggle, onPublish, onReceive, projects, tasks }: WorkspaceHeaderProps) {
  const activeProject = projects.activeProject;
  const provider = activeProject?.defaultAiProvider;
  const model = activeProject?.defaultModel;
  const modelLabel = provider ? model?.trim() || "По умолчанию CLI" : "";
  const providerTool = projects.capabilities?.tools.find((tool) => tool.name === provider?.toLowerCase());
  const availableProviders = useMemo(() => projects.capabilities?.tools.filter((tool) =>
    ["codex", "gigacode"].includes(tool.name)
    && tool.available
    && tool.supported !== false
    && tool.nonInteractive !== false,
  ) ?? [], [projects.capabilities]);
  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark />
        <strong>OpenSpec</strong>
        <span>Studio</span>
      </div>

      <ProjectSwitcher controller={projects} />
      <div className="task-context-publish-group">
        <TaskContextSelector controller={tasks} projectSelected={!!activeProject} />
        <button
          className="publish-icon-button receive-icon-button"
          type="button"
          aria-label={tasks.syncing ? "Получаем remote-изменения" : "Получить изменения текущей задачи из remote"}
          disabled={!activeProject || !tasks.overview?.active || tasks.switching || tasks.syncing || tasks.preparing || tasks.publishing}
          title={!activeProject ? "Сначала выберите проект" : !tasks.overview?.active ? "Сначала откройте задачу" : tasks.syncing ? "Получаем изменения…" : "Получить remote-изменения текущей задачи"}
          onClick={onReceive}
        >
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3.2v9.2m0 0 3.3-3.3M9 12.4 5.7 9.1M4 13v.5A1.5 1.5 0 0 0 5.5 15h7a1.5 1.5 0 0 0 1.5-1.5V13" /></svg>
          <span>{tasks.syncing ? "Получаем…" : "Получить обновления"}</span>
        </button>
        <button
          className="publish-icon-button publication-icon-button"
          type="button"
          aria-label={tasks.preparing ? "Готовим публикацию" : "Опубликовать артефакты текущей задачи"}
          disabled={!activeProject || !tasks.overview?.active || tasks.switching || tasks.syncing || tasks.preparing || tasks.publishing}
          title={!activeProject ? "Сначала выберите проект" : !tasks.overview?.active ? "Сначала откройте задачу" : tasks.preparing ? "Готовим публикацию…" : "Опубликовать OpenSpec-артефакты текущей задачи"}
          onClick={onPublish}
        >
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 12.8V3.6m0 0L5.7 6.9M9 3.6l3.3 3.3M4 11.4v2.1A1.5 1.5 0 0 0 5.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-2.1" /></svg>
          <span>{tasks.preparing ? "Готовим…" : "Публикация изменений"}</span>
        </button>
      </div>

      <div className="top-actions">
        <div className="provider-settings">
          <button
            className="provider-button"
            disabled={!activeProject || availableProviders.length === 0}
            title={!activeProject ? "Сначала выберите проект" : availableProviders.length === 0 ? "Поддерживаемый agent CLI не обнаружен" : "Настроить agent CLI"}
            aria-controls={agentSettingsOpen ? "agent-cli-panel" : undefined}
            aria-expanded={agentSettingsOpen}
            onClick={onAgentSettingsToggle}
          >
            <span className="provider-icon" aria-hidden="true">✦</span>
            <span className="provider-label">{provider || "Настроить AI"}</span>
            {modelLabel && <small title={`Выбранная модель: ${modelLabel}`}>{modelLabel}</small>}
            {provider && providerTool?.available === false && <span className="provider-unavailable">недоступен</span>}
            <svg className={`provider-chevron ${agentSettingsOpen ? "open" : ""}`} aria-hidden="true" viewBox="0 0 16 16">
              <path d="m4 6.5 4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
