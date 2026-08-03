"use client";

import { useMemo, useState } from "react";
import type { GitStatusController } from "@/features/git/hooks/useGitStatusController";
import type { GitChange, GitStatus } from "@/features/git/model/git-types";

function stateLabel(value: string): string {
  if (value === " " || value === "") return "Не изменён";
  if (value === "?") return "Unversioned";
  if (value === "M") return "Modified";
  if (value === "A") return "Added";
  if (value === "D") return "Deleted";
  if (value === "R") return "Renamed";
  return value;
}

function changeKind(change: GitChange, stage: "staged" | "unstaged"): string {
  return stage === "staged" ? stateLabel(change.index) : stateLabel(change.worktree);
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function parentPath(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
}

interface GitChangesPanelProps {
  activePath: string | null;
  busy: boolean;
  controller: GitStatusController;
  dirty: boolean;
  onActivePathChange: (path: string) => void;
  status: GitStatus;
}

interface ChangeGroupProps {
  activePath: string | null;
  busy: boolean;
  changes: GitChange[];
  collapsed: boolean;
  excludedStaged: string[];
  onActivePathChange: (path: string) => void;
  onCollapsedChange: () => void;
  onStage: (paths: string[]) => void;
  onToggleCommitPath: (path: string) => void;
  onUnstage: (paths: string[]) => void;
  stage: "staged" | "unstaged";
}

function ChangeGroup(props: ChangeGroupProps) {
  const { activePath, busy, changes, collapsed, excludedStaged, onActivePathChange,
    onCollapsedChange, onStage, onToggleCommitPath, onUnstage, stage } = props;
  const title = stage === "staged" ? "Staged" : "Unstaged";

  return (
    <section className="git-change-group" aria-label={`${title} changes`}>
      <header>
        <button className="git-group-toggle" type="button" onClick={onCollapsedChange} aria-expanded={!collapsed}>
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          <b>{title}</b>
          <small>{changes.length}</small>
        </button>
        {changes.length > 0 && (
          <button
            className="git-group-action"
            type="button"
            disabled={busy}
            onClick={() => stage === "staged" ? onUnstage(changes.map((item) => item.path)) : onStage(changes.map((item) => item.path))}
            title={stage === "staged" ? "Unstage all" : "Stage all"}
          >{stage === "staged" ? "− All" : "+ All"}</button>
        )}
      </header>
      {!collapsed && (
        <div className="git-change-tree">
          {changes.length === 0 && <p>No changes</p>}
          {changes.map((change) => {
            const selectedForCommit = !excludedStaged.includes(change.path);
            return (
              <div className={`git-change-row ${activePath === change.path ? "active" : ""}`} key={`${stage}:${change.path}`}>
                {stage === "staged"
                  ? <input type="checkbox" aria-label={`Include ${change.path} in commit`} checked={selectedForCommit} onChange={() => onToggleCommitPath(change.path)} disabled={busy} />
                  : <span className="git-change-dot" aria-hidden="true" />}
                <button className="git-change-file" type="button" onClick={() => onActivePathChange(change.path)} title={change.path}>
                  <span><b>{fileName(change.path)}</b><small>{parentPath(change.path)}</small></span>
                </button>
                <em className={`git-change-kind ${changeKind(change, stage).toLowerCase()}`}>{changeKind(change, stage)}</em>
                <button
                  className="git-row-action"
                  type="button"
                  disabled={busy}
                  onClick={() => stage === "staged" ? onUnstage([change.path]) : onStage([change.path])}
                  aria-label={`${stage === "staged" ? "Unstage" : "Stage"} ${change.path}`}
                  title={stage === "staged" ? "Unstage file" : "Stage file"}
                >{stage === "staged" ? "−" : "+"}</button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function GitChangesPanel({ activePath, busy, controller, dirty, onActivePathChange, status }: GitChangesPanelProps) {
  const [excludedStaged, setExcludedStaged] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [filter, setFilter] = useState("");
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [unstagedCollapsed, setUnstagedCollapsed] = useState(false);
  const query = filter.trim().toLowerCase();
  const staged = useMemo(() => status.changes
    .filter((item) => item.index !== " " && item.index !== "?")
    .filter((item) => !query || item.path.toLowerCase().includes(query)), [query, status]);
  const unstaged = useMemo(() => status.changes
    .filter((item) => item.worktree !== " ")
    .filter((item) => !query || item.path.toLowerCase().includes(query)), [query, status]);
  const allStagedPaths = status.changes
    .filter((item) => item.index !== " " && item.index !== "?")
    .map((item) => item.path);
  const selectedStaged = allStagedPaths.filter((path) => !excludedStaged.includes(path));

  const toggleCommitPath = (path: string) => setExcludedStaged((current) => current.includes(path)
    ? current.filter((item) => item !== path)
    : [...current, path]);
  const commit = async () => {
    if (await controller.commit(message, selectedStaged)) {
      setMessage("");
      setExcludedStaged([]);
    }
  };

  return (
    <aside className="git-changes-panel" aria-label="Изменения Git">
      <header className="git-changes-panel-header">
        <div className="git-tool-window-title">
          <div><span className="eyebrow">VERSION CONTROL</span><h2>Commit</h2></div>
          <span className="git-total-badge">{status.changes.length}</span>
        </div>
        <div className="git-changes-toolbar">
          <label className="git-filter-field">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Фильтр Git-изменений" placeholder="Search changes" value={filter} onChange={(event) => setFilter(event.target.value)} />
            {filter && <button type="button" onClick={() => setFilter("")} aria-label="Очистить фильтр">×</button>}
          </label>
          <button type="button" onClick={controller.refresh} disabled={controller.loading || busy} aria-label="Обновить Git-изменения" title="Refresh changes">↻</button>
        </div>
        <details className="git-new-branch">
          <summary>New branch</summary>
          <div className="git-branch-create">
            <input aria-label="Имя новой ветки" placeholder="feature/new-branch" value={newBranch} onChange={(event) => setNewBranch(event.target.value)} disabled={dirty || busy} />
            <button type="button" disabled={!newBranch.trim() || dirty || busy} onClick={() => void controller.createBranch(newBranch).then((ok) => { if (ok) setNewBranch(""); })}>Create</button>
            {dirty && <small>Commit changes before creating or switching branches.</small>}
          </div>
        </details>
      </header>

      <div className="git-changes-list">
        <ChangeGroup activePath={activePath} busy={busy} changes={staged} collapsed={stagedCollapsed} excludedStaged={excludedStaged} onActivePathChange={onActivePathChange} onCollapsedChange={() => setStagedCollapsed((value) => !value)} onStage={(paths) => void controller.stage(paths)} onToggleCommitPath={toggleCommitPath} onUnstage={(paths) => void controller.unstage(paths)} stage="staged" />
        <ChangeGroup activePath={activePath} busy={busy} changes={unstaged} collapsed={unstagedCollapsed} excludedStaged={excludedStaged} onActivePathChange={onActivePathChange} onCollapsedChange={() => setUnstagedCollapsed((value) => !value)} onStage={(paths) => void controller.stage(paths)} onToggleCommitPath={toggleCommitPath} onUnstage={(paths) => void controller.unstage(paths)} stage="unstaged" />
        {status.changes.length === 0 && <div className="git-clean-inline"><span>✓</span><b>Рабочее дерево чистое</b><small>Локальных изменений нет.</small></div>}
      </div>

      <footer className="git-changes-panel-footer">
        <label htmlFor="git-commit-message">Commit message</label>
        <textarea
          id="git-commit-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && message.trim() && selectedStaged.length) void commit(); }}
          placeholder="Describe your changes…"
          disabled={busy}
        />
        <div className="git-commit-summary"><span>{selectedStaged.length} files selected</span><span>{message.length}/16384</span></div>
        <button className="git-commit-button" type="button" onClick={() => void commit()} disabled={!message.trim() || !selectedStaged.length || busy} title="Commit selected files (Ctrl+Enter)">Commit</button>
      </footer>
    </aside>
  );
}
