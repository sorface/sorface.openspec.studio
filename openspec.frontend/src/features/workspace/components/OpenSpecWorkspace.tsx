"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocumentsController } from "@/features/documents/hooks/useDocumentsController";
import { useDocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import type { EditorFragmentComment, EditorTextSelection } from "@/features/editor/model/fragment-comment";
import { proposalCommentsStorageKey } from "@/features/editor/model/fragment-comment";
import { GitPanel } from "@/features/git/components/GitPanel";
import { useGitStatusController } from "@/features/git/hooks/useGitStatusController";
import { useProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useRepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import { useOpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import { OpenSpecChangeCreationPage } from "@/features/openspec-workflow/components/OpenSpecChangeCreationPage";
import {
  OpenSpecDocumentAction,
  OpenSpecDocumentReview,
} from "@/features/openspec-workflow/components/OpenSpecDocumentActions";
import { PublicationDialog } from "@/features/task-context/components/PublicationDialog";
import { useTaskContextController } from "@/features/task-context/hooks/useTaskContextController";
import {
  isSaveShortcut,
  primaryShortcutLabel,
} from "@/features/system/model/platform-shortcuts";
import { RepositoriesPanel } from "@/features/repositories/components/RepositoriesPanel";
import { AgentCliPanel } from "./AgentCliPanel";
import { MarkdownEditor } from "./MarkdownEditor";
import { ProjectLoadingLanding } from "./ProjectLoadingLanding";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import type { ViewMode, WorkspaceMode } from "@/features/workspace/model/workspace-types";
import {
  isDeltaSpecPath,
  isMasterSpecPath,
  isUserReadOnlySpecPath,
} from "@/features/workspace/model/openspec-document";
import {
  isOpenSpecTasksPath,
  taskProgressFromMarkdown,
} from "@/features/workspace/model/task-progress";

interface ChangeDocumentContext {
  change: string;
  artifact: "proposal" | "design" | "tasks";
}

const DOCUMENT_AUTOSAVE_DELAY_MS = 3_000;

function changeDocumentContextFromPath(path: string | null): ChangeDocumentContext | null {
  const match = path?.match(/^openspec\/changes\/([^/]+)\/(proposal|design|tasks)\.md$/);
  if (!match) return null;
  return { change: match[1], artifact: match[2] as ChangeDocumentContext["artifact"] };
}

export function OpenSpecWorkspace() {
  const projects = useProjectsController();
  const repositories = useRepositoriesController(projects.activeProject?.id);
  const tasks = useTaskContextController(projects.activeProject?.id);
  const workspaceContext = tasks.overview?.active?.id ?? projects.activeProject?.activeTask ?? "base";
  const documents = useDocumentsController(projects.activeProject?.id, workspaceContext);
  const documentHistory = useDocumentHistoryController(projects.activeProject?.id, documents.selectedPath, workspaceContext);
  const [fragmentCommentsByPath, setFragmentCommentsByPath] = useState<Record<string, EditorFragmentComment[]>>({});
  const [commentsProjectId, setCommentsProjectId] = useState("");
  const pendingCommentUpdatePath = useRef("");
  const retryDocuments = documents.retry;
  const saveDocument = documents.save;
  const selectedDocumentPath = documents.selectedPath;
  const refreshTasks = tasks.refresh;
  useEffect(() => {
    const projectId = projects.activeProject?.id ?? "";
    if (!projectId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore project-scoped state after the external storage key changes.
      setFragmentCommentsByPath({});
      setCommentsProjectId("");
      return;
    }
    try {
      const saved = window.localStorage.getItem(proposalCommentsStorageKey(projectId));
      setFragmentCommentsByPath(saved ? JSON.parse(saved) as Record<string, EditorFragmentComment[]> : {});
    } catch {
      setFragmentCommentsByPath({});
    }
    setCommentsProjectId(projectId);
  }, [projects.activeProject?.id]);

  useEffect(() => {
    const projectId = projects.activeProject?.id;
    if (!projectId || commentsProjectId !== projectId) return;
    window.localStorage.setItem(proposalCommentsStorageKey(projectId), JSON.stringify(fragmentCommentsByPath));
  }, [commentsProjectId, fragmentCommentsByPath, projects.activeProject?.id]);

  const clearFragmentComments = useCallback((path: string) => {
    setFragmentCommentsByPath((current) => {
      if (!current[path]?.length) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, []);

  const refreshStoreState = useCallback((operation?: { openspecChange?: string; openspecArtifact?: string }) => {
    const operationArtifact = ["spec", "specs"].includes(operation?.openspecArtifact ?? "")
      ? "proposal"
      : operation?.openspecArtifact;
    const expectedPath = operation?.openspecChange && operationArtifact
      ? `openspec/changes/${operation.openspecChange}/${operationArtifact}.md`
      : "";
    if (pendingCommentUpdatePath.current && expectedPath === pendingCommentUpdatePath.current) {
      clearFragmentComments(pendingCommentUpdatePath.current);
      pendingCommentUpdatePath.current = "";
    }
    retryDocuments();
    refreshTasks();
  }, [clearFragmentComments, refreshTasks, retryDocuments]);
  const configuredProvider = projects.activeProject?.defaultAiProvider ?? undefined;
  const providerAvailable = !!configuredProvider && (projects.capabilities?.tools.some((tool) =>
    tool.name === configuredProvider.toLowerCase() && tool.available && tool.supported !== false && tool.nonInteractive !== false,
  ) ?? false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("documents");
  const activeWorkspaceMode = projects.activeProject ? workspaceMode : "documents";
  const git = useGitStatusController(projects.activeProject?.id, !!projects.activeProject);
  const openSpec = useOpenSpecWorkflowController(
    projects.activeProject?.id,
    configuredProvider,
    projects.activeProject?.defaultModel ?? undefined,
    providerAvailable,
    refreshStoreState,
    workspaceContext,
  );
  const projectInitializationComplete = projects.status !== "loading" && (
    !projects.activeProject || (
      tasks.status !== "idle"
      && tasks.status !== "loading"
      && documents.status !== "idle"
      && documents.status !== "loading"
      && !documents.loadingDocument
      && openSpec.status !== "idle"
      && openSpec.status !== "loading"
    )
  );
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [leftOpen, setLeftOpen] = useState(true);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [saveShortcutLabel, setSaveShortcutLabel] = useState("Ctrl+S");
  const [openSpecCreationPageOpen, setOpenSpecCreationPageOpen] = useState(false);
  const [pendingDocumentPath, setPendingDocumentPath] = useState("");
  const [pendingArchivedChange, setPendingArchivedChange] = useState("");

  const lines = useMemo(() => documents.markdown.split("\n"), [documents.markdown]);
  const changeDocument = useMemo(
    () => changeDocumentContextFromPath(documents.selectedPath),
    [documents.selectedPath],
  );
  const activeFragmentComments = documents.selectedPath
    ? fragmentCommentsByPath[documents.selectedPath] ?? []
    : [];
  const masterSpecReadOnly = isMasterSpecPath(documents.selectedPath);
  const deltaSpecReadOnly = isDeltaSpecPath(documents.selectedPath);
  const userReadOnlySpec = masterSpecReadOnly || deltaSpecReadOnly;
  const taskDocumentProgress = useMemo(
    () => isOpenSpecTasksPath(documents.selectedPath)
      ? taskProgressFromMarkdown(documents.markdown)
      : null,
    [documents.markdown, documents.selectedPath],
  );
  const changeHasSpecs = useMemo(() => {
    if (!changeDocument) return false;
    const changeRoot = `openspec/changes/${changeDocument.change}`;
    return documents.items.some((item) =>
      item.path.startsWith(`${changeRoot}/spec/`) || item.path.startsWith(`${changeRoot}/specs/`),
    );
  }, [changeDocument, documents.items]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const archiveOpenSpecChange = useCallback((change: string) => {
    notify(`Архивация запущена: ${change}`);
    void openSpec.archiveChange(change).then(() => {
      setPendingArchivedChange(change);
      retryDocuments();
      refreshTasks();
      notify(`Изменение архивировано: ${change}`);
    }).catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Не удалось архивировать изменение");
    });
  }, [notify, openSpec, refreshTasks, retryDocuments]);

  useEffect(() => {
    if (!pendingArchivedChange || documents.status === "loading") return;
    const archiveRootFragment = `-${pendingArchivedChange}/`;
    const archivedFile = documents.items.find((item) =>
      item.kind === "file" &&
      item.path.startsWith("openspec/changes/archive/") &&
      item.path.includes(archiveRootFragment) &&
      item.path.endsWith("/proposal.md"),
    ) ?? documents.items.find((item) =>
      item.kind === "file" &&
      item.path.startsWith("openspec/changes/archive/") &&
      item.path.includes(archiveRootFragment),
    );
    if (!archivedFile) return;
    documents.select(archivedFile.path);
    void Promise.resolve().then(() => setPendingArchivedChange(""));
  }, [documents, pendingArchivedChange]);

  const persistFile = useCallback(async (announce: boolean): Promise<boolean> => {
    if (isUserReadOnlySpecPath(selectedDocumentPath)) return false;
    try {
      await saveDocument();
      refreshTasks();
      if (announce) notify("Файл сохранён в задаче");
      return true;
    } catch {
      return false;
    }
  }, [notify, refreshTasks, saveDocument, selectedDocumentPath]);

  const writeFile = useCallback(
    (): Promise<boolean> => persistFile(true),
    [persistFile],
  );

  useEffect(() => {
    if (
      userReadOnlySpec
      || documents.status !== "ready"
      || !documents.dirty
      || documents.saving
      || documents.conflict
    ) return;
    const timer = window.setTimeout(() => {
      void persistFile(false);
    }, DOCUMENT_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    documents.conflict,
    documents.dirty,
    documents.markdown,
    documents.saving,
    documents.selectedPath,
    documents.status,
    persistFile,
    userReadOnlySpec,
  ]);

  const preparePublication = useCallback(() => {
    void tasks.preparePublication().catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Не удалось подготовить публикацию");
    });
  }, [notify, tasks]);

  const receiveRemoteChanges = useCallback(() => {
    void tasks.receiveRemoteChanges().then((result) => {
      if (result.updated) retryDocuments();
      notify(result.updated ? `Получены изменения задачи ${result.task}` : `Задача ${result.task} уже актуальна`);
    }).catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Не удалось получить изменения из remote");
    });
  }, [notify, retryDocuments, tasks]);

  useEffect(() => {
    void Promise.resolve().then(() => setSaveShortcutLabel(primaryShortcutLabel("S")));
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      void writeFile();
    };
    window.addEventListener("keydown", handleSaveShortcut, true);
    return () => window.removeEventListener("keydown", handleSaveShortcut, true);
  }, [writeFile]);

  const addFragmentComment = useCallback((path: string, selection: EditorTextSelection, text: string) => {
    const comment: EditorFragmentComment = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      selection,
      text,
      createdAt: new Date().toISOString(),
    };
    setFragmentCommentsByPath((current) => ({
      ...current,
      [path]: [...(current[path] ?? []), comment],
    }));
  }, []);

  const deleteFragmentComment = useCallback((path: string, commentId: string) => {
    setFragmentCommentsByPath((current) => ({
      ...current,
      [path]: (current[path] ?? []).filter((comment) => comment.id !== commentId),
    }));
  }, []);

  const updateFragmentComment = useCallback((path: string, commentId: string, text: string) => {
    setFragmentCommentsByPath((current) => ({
      ...current,
      [path]: (current[path] ?? []).map((comment) => comment.id === commentId ? { ...comment, text } : comment),
    }));
  }, []);

  const addOpenSpecChange = useCallback(() => {
    setWorkspaceMode("documents");
    setOpenSpecCreationPageOpen(true);
  }, []);

  const changeWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    setOpenSpecCreationPageOpen(false);
    setWorkspaceMode(mode);
  }, []);

  const openCreatedChange = useCallback((proposalPath: string) => {
    setPendingDocumentPath(proposalPath);
    setOpenSpecCreationPageOpen(false);
    setWorkspaceMode("documents");
  }, []);

  const documentItems = documents.items;
  const selectDocument = documents.select;
  useEffect(() => {
    if (!pendingDocumentPath || !documentItems.some((item) => item.path === pendingDocumentPath)) return;
    selectDocument(pendingDocumentPath);
    void Promise.resolve().then(() => setPendingDocumentPath(""));
  }, [documentItems, pendingDocumentPath, selectDocument]);

  return (
    <main className="app-shell">
      <ProjectLoadingLanding initializationComplete={projectInitializationComplete} />
      <WorkspaceHeader
        agentSettingsOpen={agentSettingsOpen}
        onAgentSettingsToggle={() => setAgentSettingsOpen((open) => !open)}
        onPublish={preparePublication}
        onReceive={receiveRemoteChanges}
        git={git}
        projects={projects}
        tasks={tasks}
      />

      <section className={`workspace ${agentSettingsOpen ? "agent-settings-open" : ""} ${leftOpen ? "" : "left-collapsed"}`}>
        <WorkspaceSidebar
          key={projects.activeProject?.id ?? "no-project"}
          documents={documents}
          hideDocumentTree={openSpecCreationPageOpen}
          onClose={() => setLeftOpen(false)}
          repositories={repositories}
          openSpec={openSpec}
          projectSelected={!!projects.activeProject}
          workspaceMode={activeWorkspaceMode}
          onWorkspaceModeChange={changeWorkspaceMode}
          onAddOpenSpecChange={addOpenSpecChange}
          onArchiveOpenSpecChange={archiveOpenSpecChange}
        />
        {!leftOpen && <button className="open-panel left" onClick={() => setLeftOpen(true)}>›</button>}

        {activeWorkspaceMode === "context" ? (
          <RepositoriesPanel controller={repositories} enabled={!!projects.activeProject} />
        ) : activeWorkspaceMode === "git" ? (
          <GitPanel controller={git} />
        ) : openSpecCreationPageOpen ? (
          <OpenSpecChangeCreationPage
            controller={openSpec}
            projectId={projects.activeProject?.id}
            onClose={() => setOpenSpecCreationPageOpen(false)}
            onChangeCreated={openCreatedChange}
          />
        ) : (
          <MarkdownEditor
            activeFile={documents.selectedPath}
            lines={lines}
            markdown={documents.markdown}
            documentStatus={documents.status}
            loadingDocument={documents.loadingDocument}
            saving={documents.saving}
            dirty={documents.dirty}
            conflict={documents.conflict}
            error={documents.error}
            history={documentHistory}
            saveShortcutLabel={saveShortcutLabel}
            viewMode={viewMode}
            userReadOnly={userReadOnlySpec}
            hideHeaderActions={masterSpecReadOnly}
            readOnlyLabel={masterSpecReadOnly ? "Master spec · только просмотр" : "Diff spec · только просмотр"}
            comments={changeDocument ? activeFragmentComments : undefined}
            toolbarActions={changeDocument ? (
              <OpenSpecDocumentAction
                controller={openSpec}
                change={changeDocument.change}
                documentArtifact={changeDocument.artifact}
                hasSpecs={changeHasSpecs}
                documentDirty={documents.dirty}
                documentSaving={documents.saving}
                documentComments={activeFragmentComments}
                onSave={writeFile}
                onCommentsSubmitted={() => {
                  if (documents.selectedPath && activeFragmentComments.length) {
                    pendingCommentUpdatePath.current = documents.selectedPath;
                  }
                }}
              />
            ) : taskDocumentProgress ? (
              <span
                className="openspec-task-progress"
                aria-label={`Выполнено задач: ${taskDocumentProgress.completed} из ${taskDocumentProgress.total}`}
                title="Выполненные задачи"
              >
                <b>{taskDocumentProgress.completed}</b>
                <span>/</span>
                <b>{taskDocumentProgress.total}</b>
              </span>
            ) : undefined}
            contextPanel={changeDocument ? (
              <OpenSpecDocumentReview controller={openSpec} change={changeDocument.change} />
            ) : undefined}
            onBlur={() => undefined}
            onAddComment={changeDocument ? addFragmentComment : undefined}
            onUpdateComment={changeDocument ? updateFragmentComment : undefined}
            onDeleteComment={changeDocument ? deleteFragmentComment : undefined}
            onChange={userReadOnlySpec ? () => undefined : documents.change}
            onViewModeChange={setViewMode}
            onWrite={writeFile}
            onRetry={documents.retry}
          />
        )}

        {agentSettingsOpen && <AgentCliPanel onClose={() => setAgentSettingsOpen(false)} projects={projects} />}
      </section>

      <PublicationDialog controller={tasks} onPublished={(task) => notify(`Артефакты задачи ${task} отправляются`)} />
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
