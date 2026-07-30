import { IconButton } from "@/components/ui/IconButton";
import { files } from "@/features/workspace/model/workspace-data";
import { RepositoriesPanel } from "@/features/repositories/components/RepositoriesPanel";
import type { RepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";

interface WorkspaceSidebarProps {
  activeFile: string;
  onFileSelect: (fileId: string) => void;
  onClose: () => void;
  repositories: RepositoriesController;
}

export function WorkspaceSidebar({ activeFile, onFileSelect, onClose, repositories }: WorkspaceSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <span>ОБЗОР</span>
        <IconButton label="Свернуть панель" onClick={onClose}>‹</IconButton>
      </div>
      <button className="nav-item"><span>⌂</span> Рабочее пространство</button>
      <button className="nav-item"><span>▱</span> Репозитории <small>{repositories.repositories.length}</small></button>
      <button className="nav-item"><span>⌁</span> Git <b>4</b></button>

      <div className="sidebar-heading files-heading">
        <span>OPENSpec</span>
        <div><IconButton label="Новый файл">＋</IconButton><IconButton label="Обновить">↻</IconButton></div>
      </div>
      <div className="tree">
        <button className="tree-row root"><span>⌄</span><b>⌑</b> specs <small>12</small></button>
        <button className="tree-row root"><span>⌄</span><b>◇</b> changes <small>3</small></button>
        <button className="tree-row change"><span>⌄</span><i className="change-dot" /> add-sso-auth <em>2/3</em></button>
        {files.map((file) => (
          <button
            key={file.id}
            className={`tree-row file ${activeFile === file.id ? "active" : ""}`}
            onClick={() => onFileSelect(file.id)}
          >
            <span>{file.icon}</span>{file.name}{file.id === "proposal" && <i className="draft-dot" />}
          </button>
        ))}
        <button className="tree-row change collapsed"><span>›</span><i className="change-dot amber" /> improve-audit-log <em>1/4</em></button>
        <button className="tree-row change collapsed"><span>›</span><i className="change-dot blue" /> billing-webhooks <em>3/3</em></button>
        <button className="tree-row root archive"><span>›</span><b>□</b> archive <small>18</small></button>
      </div>

      <RepositoriesPanel controller={repositories} />
    </aside>
  );
}
