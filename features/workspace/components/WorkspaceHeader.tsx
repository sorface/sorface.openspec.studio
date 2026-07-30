import { IconButton } from "@/components/ui/IconButton";
import { LogoMark } from "@/components/ui/LogoMark";
import { ProjectSwitcher } from "@/features/projects/components/ProjectSwitcher";
import type { ProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useSystemStatus } from "@/features/system/hooks/useSystemStatus";

interface WorkspaceHeaderProps {
  draftSaved: boolean;
  projects: ProjectsController;
}

export function WorkspaceHeader({ draftSaved, projects }: WorkspaceHeaderProps) {
  const serverStatus = useSystemStatus();
  const activeProject = projects.activeProject;
  const provider = activeProject?.defaultAiProvider;
  const model = activeProject?.defaultModel;
  const providerTool = projects.capabilities?.tools.find((tool) => tool.name === provider?.toLowerCase());

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
        <span className="saved-state"><i /> {draftSaved ? "Черновик сохранён" : "Есть изменения"}</span>
      </div>

      <div className="top-actions">
        <button className="provider-button" disabled={!provider || providerTool?.available === false}>
          <span className="provider-icon">✣</span>
          {provider || "AI не настроен"}
          {model && <small>{model}</small>}
          {provider && providerTool?.available === false ? " недоступен" : "⌄"}
        </button>
        <IconButton label="Уведомления">♧</IconButton>
        <IconButton label="Настройки">⚙</IconButton>
        <button className="user-avatar">PT</button>
      </div>
    </header>
  );
}
