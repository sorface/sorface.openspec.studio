"use client";

import { useMemo, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import type { DocumentsController } from "@/features/documents/hooks/useDocumentsController";
import type { RepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import type { WorkspaceMode } from "@/features/workspace/model/workspace-types";
import { isDeltaSpecPath, isMasterSpecPath } from "@/features/workspace/model/openspec-document";

interface WorkspaceSidebarProps {
  documents: DocumentsController;
  onClose: () => void;
  repositories: RepositoriesController;
  projectSelected: boolean;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  onAddOpenSpecChange: () => void;
}

type ArtifactRole = "analyst" | "developer";
type NavigationSectionId = "documentation" | "changes" | "archive";

interface NavigationSection {
  id: NavigationSectionId;
  label: string;
}

interface DocumentSectionLocation {
  id: NavigationSectionId;
  rootDepth: number;
}

interface DocumentScope {
  id: string;
  label: string;
  rootPath: string;
  sectionId: NavigationSectionId;
}

const navigationSections: NavigationSection[] = [
  { id: "documentation", label: "Документация" },
  { id: "changes", label: "Изменения" },
  { id: "archive", label: "Архив" },
];

const artifactRoleLabels: Record<ArtifactRole, string> = {
  analyst: "аналитик",
  developer: "разработчик",
};

function getDocumentSection(path: string): DocumentSectionLocation | null {
  const segments = path.split("/");
  if (segments[0] !== "openspec") return null;
  if (segments[1] === "changes" && segments[2] === "archive") {
    return { id: "archive", rootDepth: 3 };
  }
  if (segments[1] === "archive") return { id: "archive", rootDepth: 2 };
  if (segments[1] === "specs") return { id: "documentation", rootDepth: 2 };
  if (segments[1] === "changes") return { id: "changes", rootDepth: 2 };
  return null;
}

function collectDocumentScopes(items: DocumentsController["items"]): DocumentScope[] {
  const scopes: DocumentScope[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const location = getDocumentSection(item.path);
    if (!location) continue;
    const segments = item.path.split("/");
    if (segments.length <= location.rootDepth) continue;
    const rootPath = segments.slice(0, location.rootDepth + 1).join("/");
    const id = `${location.id}:${rootPath}`;
    if (seen.has(id)) continue;
    seen.add(id);
    scopes.push({ id, label: segments[location.rootDepth], rootPath, sectionId: location.id });
  }
  return scopes;
}

function getScopeArtifactRole(path: string, scope: DocumentScope): ArtifactRole | null {
  if (scope.sectionId === "documentation" || !path.startsWith(`${scope.rootPath}/`)) return null;
  const artifact = path.slice(scope.rootPath.length + 1).split("/")[0];
  if (["proposal.md", "spec", "specs"].includes(artifact)) return "analyst";
  if (["design.md", "tasks.md"].includes(artifact)) return "developer";
  return null;
}

function relativeSegments(path: string, scope: DocumentScope): string[] {
  if (path === scope.rootPath) return [scope.label];
  return path.slice(scope.rootPath.length + 1).split("/");
}

export function WorkspaceSidebar({
  documents,
  onClose,
  repositories,
  projectSelected,
  workspaceMode,
  onWorkspaceModeChange,
  onAddOpenSpecChange,
}: WorkspaceSidebarProps) {
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<NavigationSectionId>>(
    () => new Set<NavigationSectionId>(["documentation", "archive"]),
  );
  const [selectedScopeId, setSelectedScopeId] = useState("");
  const documentScopes = useMemo(() => collectDocumentScopes(documents.items), [documents.items]);
  const selectedChangeScopeId = useMemo(() => {
    const selectedPath = documents.selectedPath;
    if (!selectedPath) return "";
    return documentScopes.find((scope) =>
      scope.sectionId === "changes" &&
      (selectedPath === scope.rootPath || selectedPath.startsWith(`${scope.rootPath}/`)),
    )?.id ?? "";
  }, [documentScopes, documents.selectedPath]);
  const activeScope = documentScopes.find((scope) => scope.id === selectedScopeId) ??
    documentScopes.find((scope) => scope.id === selectedChangeScopeId) ?? null;

  const toggleDirectory = (path: string) => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSection = (section: NavigationSectionId) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const selectScope = (scope: DocumentScope) => {
    setSelectedScopeId(scope.id);
    setCollapsedDirectories(new Set());
    onWorkspaceModeChange("documents");
  };

  const closeSidebar = () => {
    if (activeScope?.sectionId !== "changes") setSelectedScopeId("");
    onClose();
  };

  const scopeItems = activeScope ? documents.items.filter((item) => {
    if (item.path !== activeScope.rootPath && !item.path.startsWith(`${activeScope.rootPath}/`)) return false;
    if (item.path === activeScope.rootPath && item.kind === "directory") return false;
    const segments = relativeSegments(item.path, activeScope);
    return !segments.slice(0, -1).some((_, index) =>
      collapsedDirectories.has(`${activeScope.rootPath}/${segments.slice(0, index + 1).join("/")}`),
    );
  }) : [];
  return (
    <>
    <aside className="sidebar">
      <div className="sidebar-heading">
        <span>ОБЗОР</span>
        <IconButton label="Свернуть панель" onClick={closeSidebar}>‹</IconButton>
      </div>
      <button className={`nav-item ${workspaceMode === "documents" ? "active" : ""}`} type="button" onClick={() => onWorkspaceModeChange("documents")}><span>⌂</span> Рабочее пространство</button>
      <button
        className={`nav-item ${projectSelected && workspaceMode === "context" ? "active" : ""}`}
        type="button"
        disabled={!projectSelected}
        title={projectSelected ? "Подключённые Git-репозитории и контекст проекта" : "Сначала выберите проект"}
        onClick={() => onWorkspaceModeChange("context")}
      ><span>▱</span> Контекст <small>{repositories.repositories.length}</small></button>
      {projectSelected && (
        <>
          <div className="sidebar-heading files-heading">
            <button
              type="button"
              className={workspaceMode === "openspec" ? "active-heading" : ""}
              onClick={() => onWorkspaceModeChange("openspec")}
              title="Открыть инструменты управления OpenSpec"
            >OpenSpec</button>
            <div>
              <IconButton
                label="Управление OpenSpec"
                onClick={() => onWorkspaceModeChange("openspec")}
                title="Создать change и управлять артефактами через agent"
              >＋</IconButton>
              <IconButton label="Обновить" onClick={documents.retry} disabled={documents.status === "loading"} title="Обновить дерево Store">↻</IconButton>
            </div>
          </div>
          <div className="tree" tabIndex={0} aria-label="Дерево OpenSpec">
            {documents.status === "loading" && <div className="tree-state">Загрузка документов…</div>}
            {documents.status === "empty" && <div className="tree-state">В Store нет OpenSpec Markdown-файлов.</div>}
            {(documents.status === "error" || documents.status === "unavailable") && (
              <div className="tree-state error" role="alert">
                <p>{documents.error?.message ?? "Не удалось загрузить документы"}</p>
                {documents.error?.correlationId && <small>Correlation ID: {documents.error.correlationId}</small>}
                <button type="button" onClick={documents.retry}>Повторить</button>
              </div>
            )}
            {documents.items.length > 0 && navigationSections.map((section) => {
              const sectionExpanded = !collapsedSections.has(section.id);
              const sectionScopes = documentScopes.filter((scope) => scope.sectionId === section.id);
              const sectionContentId = `document-section-${section.id}`;

              return (
                <section className="tree-section" key={section.id}>
                  <div className="tree-section-heading-row">
                    <button
                      type="button"
                      className="tree-section-heading"
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={sectionExpanded}
                      aria-controls={sectionContentId}
                    >
                      <svg className={sectionExpanded ? "expanded" : ""} viewBox="0 0 16 16" aria-hidden="true">
                        <path d="m5 3 5 5-5 5" />
                      </svg>
                      <span>{section.label}</span>
                      <span className="tree-section-count" aria-label={`Количество: ${sectionScopes.length}`}>
                        {sectionScopes.length}
                      </span>
                    </button>
                    {section.id === "changes" && (
                      <IconButton
                        className="tree-section-add"
                        label="Добавить изменение"
                        onClick={onAddOpenSpecChange}
                        title="Исследовать задачу и создать изменение"
                      >＋</IconButton>
                    )}
                  </div>
                  <div className="tree-section-items" id={sectionContentId} hidden={!sectionExpanded}>
                    {sectionScopes.length === 0 && (
                      <div className="tree-section-state">Нет документов</div>
                    )}
                    {sectionScopes.map((scope) => (
                      <button
                        key={scope.id}
                        type="button"
                        className={`tree-scope-row ${activeScope?.id === scope.id ? "active" : ""}`}
                        onClick={() => selectScope(scope)}
                        title={scope.rootPath}
                        aria-haspopup="tree"
                      >
                        <span>{scope.label}</span>
                        <i aria-hidden="true">›</i>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </aside>
    {activeScope && workspaceMode === "documents" && (
      <aside className="document-tree-panel" aria-label={`Документы: ${activeScope.label}`}>
        <header className="document-tree-heading">
          <div>
            <small>{activeScope.sectionId === "changes"
              ? "Изменение"
              : navigationSections.find((section) => section.id === activeScope.sectionId)?.label}</small>
            <strong title={activeScope.rootPath}>{activeScope.label}</strong>
          </div>
          {activeScope.sectionId !== "changes" && (
            <IconButton label="Закрыть дерево документов" onClick={() => setSelectedScopeId("")}>×</IconButton>
          )}
        </header>
        <div className="document-tree" role="tree" aria-label={`Дерево ${activeScope.label}`}>
          {scopeItems.length === 0 && <div className="tree-state">Нет Markdown-файлов.</div>}
          {scopeItems.map((item) => {
            const itemSegments = relativeSegments(item.path, activeScope);
            const relativeDepth = Math.max(0, itemSegments.length - 1);
            const directoryExpanded = item.kind === "directory" && !collapsedDirectories.has(item.path);
            const artifactRole = getScopeArtifactRole(item.path, activeScope);
            const masterSpec = isMasterSpecPath(item.path);
            const deltaSpec = isDeltaSpecPath(item.path);
            const isArtifactRoot = itemSegments.length === 1;
            return (
              <button
                key={item.path}
                type="button"
                role="treeitem"
                className={`tree-row ${item.kind === "file" ? "file" : "root"} ${masterSpec ? "master-spec" : artifactRole ? `artifact-${artifactRole}` : ""} ${documents.selectedPath === item.path ? "active" : ""}`}
                style={{ paddingLeft: `${10 + relativeDepth * 14}px` }}
                onClick={() => item.kind === "directory" ? toggleDirectory(item.path) : documents.select(item.path)}
                aria-expanded={item.kind === "directory" ? directoryExpanded : undefined}
                aria-selected={item.kind === "file" ? documents.selectedPath === item.path : false}
                aria-label={masterSpec ? `${item.name}, master spec, только просмотр` : deltaSpec ? `${item.name}, diff spec, только просмотр` : artifactRole ? `${item.name}, ${artifactRoleLabels[artifactRole]}` : undefined}
                title={masterSpec ? `${item.path} · master spec · только просмотр` : deltaSpec ? `${item.path} · diff spec · только просмотр` : artifactRole ? `${item.path} · создаёт ${artifactRoleLabels[artifactRole]}` : item.path}
              >
                <span className="tree-row-icon" aria-hidden="true">
                  {item.kind === "directory" ? (
                    <svg className={directoryExpanded ? "expanded" : ""} viewBox="0 0 16 16">
                      <path d="m5 3 5 5-5 5" />
                    </svg>
                  ) : "◇"}
                </span>
                <span className="tree-row-label">{item.name}</span>
                {masterSpec && (
                  <span className="master-spec-badge" aria-hidden="true">MASTER</span>
                )}
                {artifactRole && isArtifactRoot && (
                  <span className="artifact-role-badge" aria-hidden="true">
                    {artifactRole === "analyst" ? "АН" : "DEV"}
                  </span>
                )}
                {documents.selectedPath === item.path && documents.dirty && <i className="draft-dot" />}
              </button>
            );
          })}
        </div>
      </aside>
    )}
    </>
  );
}
