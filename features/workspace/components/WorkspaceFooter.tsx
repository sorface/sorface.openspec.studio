import type { WorkspaceMode } from "@/features/workspace/model/workspace-types";

interface WorkspaceFooterProps {
  workspaceMode: WorkspaceMode;
  gitAvailable: boolean;
  projectSelected: boolean;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
}

export function WorkspaceFooter({ workspaceMode, gitAvailable, projectSelected, onWorkspaceModeChange }: WorkspaceFooterProps) {
  return (
    <nav className="bottom-bar">
      <button
        className={workspaceMode === "git" ? "active" : ""}
        type="button"
        disabled={!projectSelected || !gitAvailable}
        title={gitAvailable ? "Управлять Git-репозиторием Store" : "Git не обнаружен backend"}
        onClick={() => onWorkspaceModeChange("git")}
      ><span>⌁</span><b>Git</b></button>
      <button
        className={workspaceMode === "openspec" ? "active" : ""}
        type="button"
        disabled={!projectSelected}
        title="Управление OpenSpec через agent"
        onClick={() => onWorkspaceModeChange("openspec")}
      ><span>◇</span><b>OpenSpec</b></button>
      <div className="bottom-spacer" />
      <span className="validation"><i /> Локальный режим · Git управляет только Store</span>
    </nav>
  );
}
