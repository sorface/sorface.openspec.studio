import type { WorkspaceMode } from "@/features/workspace/model/workspace-types";

interface WorkspaceFooterProps {
  workspaceMode: WorkspaceMode;
  projectSelected: boolean;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
}

export function WorkspaceFooter({ workspaceMode, projectSelected, onWorkspaceModeChange }: WorkspaceFooterProps) {
  return (
    <nav className="bottom-bar">
      <button
        className={workspaceMode === "openspec" ? "active" : ""}
        type="button"
        disabled={!projectSelected}
        title="Управление OpenSpec через agent"
        onClick={() => onWorkspaceModeChange("openspec")}
      ><span>◇</span><b>OpenSpec</b></button>
      <div className="bottom-spacer" />
    </nav>
  );
}
