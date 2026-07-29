import { IconButton } from "@/components/ui/IconButton";
import { LogoMark } from "@/components/ui/LogoMark";

interface WorkspaceHeaderProps {
  draftSaved: boolean;
}

export function WorkspaceHeader({ draftSaved }: WorkspaceHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark />
        <strong>OpenSpec</strong>
        <span>Studio</span>
      </div>

      <button className="project-switcher">
        <span className="project-avatar">P</span>
        <span><small>ПРОЕКТ</small><b>Platform specifications</b></span>
        <em>⌄</em>
      </button>

      <div className="workspace-status">
        <span className="branch-chip"><i /> main</span>
        <span className="divider" />
        <span className="store-id">Store <b>platform-core</b></span>
        <span className="sync-status">↻</span>
        <span className="saved-state"><i /> {draftSaved ? "Черновик сохранён" : "Есть изменения"}</span>
      </div>

      <div className="top-actions">
        <button className="provider-button"><span className="provider-icon">✣</span> Codex <small>GPT-5</small>⌄</button>
        <IconButton label="Уведомления">♧</IconButton>
        <IconButton label="Настройки">⚙</IconButton>
        <button className="user-avatar">PT</button>
      </div>
    </header>
  );
}
