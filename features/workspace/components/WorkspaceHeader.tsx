"use client";

import { useMemo } from "react";
import { LogoMark } from "@/components/ui/LogoMark";
import { ProjectSwitcher } from "@/features/projects/components/ProjectSwitcher";
import type { ProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useSystemStatus } from "@/features/system/hooks/useSystemStatus";

interface WorkspaceHeaderProps {
  agentSettingsOpen: boolean;
  draftSaved: boolean;
  onAgentSettingsToggle: () => void;
  projects: ProjectsController;
}

export function WorkspaceHeader({ agentSettingsOpen, draftSaved, onAgentSettingsToggle, projects }: WorkspaceHeaderProps) {
  const serverStatus = useSystemStatus();
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

      <div className="workspace-status">
        <span className="store-id">Store <b>{activeProject?.storePath || "не выбран"}</b></span>
        <span className={`server-status ${serverStatus}`}>
          <i /> {serverStatus === "ready" ? "Локальный server" : serverStatus === "checking" ? "Подключение…" : "Backend недоступен"}
        </span>
        <span className="saved-state"><i /> {draftSaved ? "Файл сохранён" : "Есть изменения"}</span>
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
