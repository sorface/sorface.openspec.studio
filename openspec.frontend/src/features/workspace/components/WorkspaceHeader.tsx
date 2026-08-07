"use client";

import { useMemo } from "react";
import { LogoMark } from "@/components/ui/LogoMark";
import { ProjectSwitcher } from "@/features/projects/components/ProjectSwitcher";
import type { GitStatusController } from "@/features/git/hooks/useGitStatusController";
import type { ProjectsController } from "@/features/projects/hooks/useProjectsController";
import { TaskContextSelector } from "@/features/task-context/components/TaskContextSelector";
import type { TaskContextController } from "@/features/task-context/hooks/useTaskContextController";
import type { WorkRole } from "@/features/workspace/model/workspace-types";

interface WorkspaceHeaderProps {
  agentSettingsOpen: boolean;
  onAgentSettingsToggle: () => void;
  onPublish: () => void;
  onReceive: () => void;
  onWorkRoleChange: (role: WorkRole) => void;
  git: GitStatusController;
  projects: ProjectsController;
  tasks: TaskContextController;
  workRole: WorkRole;
}

export function WorkspaceHeader({ agentSettingsOpen, git, onAgentSettingsToggle, onPublish, onReceive, onWorkRoleChange, projects, tasks, workRole }: WorkspaceHeaderProps) {
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
      <div className="top-actions">
        <div className="task-context-publish-group">
          <TaskContextSelector
            controller={tasks}
            git={git}
            onPublish={onPublish}
            onReceive={onReceive}
            projectSelected={!!activeProject}
          />
        </div>
        <div className="work-role-toggle" role="group" aria-label="Режим работы">
          <button
            type="button"
            className={workRole === "analyst" ? "active" : ""}
            onClick={() => onWorkRoleChange("analyst")}
            aria-pressed={workRole === "analyst"}
            title="Аналитик работает с proposal.md и diff specs"
          >Аналитик</button>
          <button
            type="button"
            className={workRole === "developer" ? "active" : ""}
            onClick={() => onWorkRoleChange("developer")}
            aria-pressed={workRole === "developer"}
            title="Разработчик работает с design.md и tasks.md"
          >Разработчик</button>
        </div>
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
