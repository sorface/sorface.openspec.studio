"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocumentsController } from "@/features/documents/hooks/useDocumentsController";
import { useDocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import type { EditorFragmentComment, EditorTextSelection } from "@/features/editor/model/fragment-comment";
import { proposalCommentsStorageKey } from "@/features/editor/model/fragment-comment";
import { useGitStatusController } from "@/features/git/hooks/useGitStatusController";
import { useProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useRepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import { useOpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import { isOpenSpecOperationBusy } from "@/features/openspec-workflow/model/openspec-state";
import { OpenSpecChangeCreationPage } from "@/features/openspec-workflow/components/OpenSpecChangeCreationPage";
import {
  OpenSpecDocumentAction,
  OpenSpecDocumentReview,
} from "@/features/openspec-workflow/components/OpenSpecDocumentActions";
import { PublicationDialog } from "@/features/task-context/components/PublicationDialog";
import { useTaskContextController } from "@/features/task-context/hooks/useTaskContextController";
import {
  isSaveShortcut,
} from "@/features/system/model/platform-shortcuts";
import { RepositoriesPanel } from "@/features/repositories/components/RepositoriesPanel";
import { AgentCliPanel } from "./AgentCliPanel";
import { MarkdownEditor } from "./MarkdownEditor";
import { ProjectLoadingLanding } from "./ProjectLoadingLanding";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import type { ViewMode, WorkRole, WorkspaceMode } from "@/features/workspace/model/workspace-types";
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
const WORK_ROLE_STORAGE_KEY = "openspec-studio-work-role";

type WorkspaceRouteView = "documents" | "context" | "create";

interface WorkspaceRouteState {
  view: WorkspaceRouteView;
  path: string;
}

function readStoredWorkRole(): WorkRole {
  if (typeof window === "undefined") return "analyst";
  return window.localStorage.getItem(WORK_ROLE_STORAGE_KEY) === "developer" ? "developer" : "analyst";
}

function readWorkspaceRoute(): WorkspaceRouteState {
  if (typeof window === "undefined") return { view: "documents", path: "" };
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  return {
    view: view === "context" || view === "create" ? view : "documents",
    path: params.get("path") ?? "",
  };
}

function writeWorkspaceRoute(route: WorkspaceRouteState) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", route.view);
  if (route.view === "documents" && route.path) {
    url.searchParams.set("path", route.path);
  } else {
    url.searchParams.delete("path");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function changeDocumentContextFromPath(path: string | null): ChangeDocumentContext | null {
  const match = path?.match(/^openspec\/changes\/([^/]+)\/(proposal|design|tasks)\.md$/);
  if (!match) return null;
  return { change: match[1], artifact: match[2] as ChangeDocumentContext["artifact"] };
}

export function OpenSpecWorkspace() {
  const initialRoute = useMemo(() => readWorkspaceRoute(), []);
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
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(initialRoute.view === "context" ? "context" : "documents");
  const [workRole, setWorkRole] = useState<WorkRole>(() => readStoredWorkRole());
  const activeWorkspaceMode = projects.activeProject ? workspaceMode : "documents";
  const taskWorkspaceSelected = !!tasks.overview?.active && workspaceContext !== "base";
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
  const [openSpecCreationPageOpen, setOpenSpecCreationPageOpen] = useState(initialRoute.view === "create");
  const [pendingDocumentPath, setPendingDocumentPath] = useState("");
  const [pendingArchivedChange, setPendingArchivedChange] = useState("");
  const [pendingOperationChange, setPendingOperationChange] = useState("");
  const [routeDocumentPath, setRouteDocumentPath] = useState(initialRoute.path);

  useEffect(() => {
    window.localStorage.setItem(WORK_ROLE_STORAGE_KEY, workRole);
  }, [workRole]);

  useEffect(() => {
    const onPopState = () => {
      const route = readWorkspaceRoute();
      setWorkspaceMode(route.view === "context" ? "context" : "documents");
      setOpenSpecCreationPageOpen(route.view === "create");
      setRouteDocumentPath(route.path);
      if (route.view === "documents" && route.path) {
        const target = documents.items.find((item) => item.kind === "file" && item.path === route.path);
        if (target) documents.select(target.path);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [documents]);

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
  const openSpecOperationActive = changeDocument
    ? openSpec.operations.some((operation) =>
      operation.openspecChange === changeDocument.change && isOpenSpecOperationBusy(operation.status),
    )
    : false;
  const openSpecArtifactRefreshActive = !!changeDocument &&
    openSpec.artifactRefresh?.change === changeDocument.change &&
    openSpec.artifactRefresh.status === "active";
  const openSpecOperationStarting = !!changeDocument && pendingOperationChange === changeDocument.change;
  const openSpecToolbarLoading = openSpec.detailsLoading || openSpec.operationsLoading || openSpec.pending ||
    openSpecOperationActive || openSpecArtifactRefreshActive || openSpecOperationStarting;

  useEffect(() => {
    if (!pendingOperationChange) return;
    const operationStillActive = openSpec.operations.some((operation) =>
      operation.openspecChange === pendingOperationChange && isOpenSpecOperationBusy(operation.status),
    );
    const cascadeStillActive = openSpec.artifactRefresh?.change === pendingOperationChange &&
      openSpec.artifactRefresh.status === "active";
    if (!openSpec.pending && !operationStillActive && !cascadeStillActive) {
      setPendingOperationChange("");
    }
  }, [openSpec.artifactRefresh, openSpec.operations, openSpec.pending, pendingOperationChange]);

  useEffect(() => {
    if (!routeDocumentPath || activeWorkspaceMode !== "documents" || openSpecCreationPageOpen || documents.status === "loading") return;
    const target = documents.items.find((item) => item.kind === "file" && item.path === routeDocumentPath);
    if (!target) {
      setRouteDocumentPath("");
      return;
    }
    if (documents.selectedPath !== target.path) {
      documents.select(target.path);
      return;
    }
    setRouteDocumentPath("");
  }, [activeWorkspaceMode, documents, openSpecCreationPageOpen, routeDocumentPath]);

  useEffect(() => {
    if (routeDocumentPath && activeWorkspaceMode === "documents" && !openSpecCreationPageOpen) return;
    const route: WorkspaceRouteState = openSpecCreationPageOpen
      ? { view: "create", path: "" }
      : activeWorkspaceMode === "context"
        ? { view: "context", path: "" }
        : { view: "documents", path: documents.selectedPath ?? "" };
    writeWorkspaceRoute(route);
  }, [activeWorkspaceMode, documents.selectedPath, openSpecCreationPageOpen, routeDocumentPath]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const archiveOpenSpecChange = useCallback((change: string) => {
    if (workRole === "developer") {
      notify("В режиме разработчика архивирование недоступно");
      return;
    }
    notify(`Архивация запущена: ${change}`);
    void openSpec.archiveChange(change).then(() => {
      setPendingArchivedChange(change);
      retryDocuments();
      refreshTasks();
      notify(`Изменение архивировано: ${change}`);
    }).catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Не удалось архивировать изменение");
    });
  }, [notify, openSpec, refreshTasks, retryDocuments, workRole]);

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
      || openSpecOperationActive
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
    openSpecOperationActive,
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
    if (!taskWorkspaceSelected) {
      notify("Сначала выберите задачу в верхней панели, чтобы изменение создавалось в нужной ветке");
      return;
    }
    setWorkspaceMode("documents");
    setOpenSpecCreationPageOpen(true);
  }, [notify, taskWorkspaceSelected]);

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
        onWorkRoleChange={setWorkRole}
        git={git}
        projects={projects}
        tasks={tasks}
        workRole={workRole}
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
          canAddOpenSpecChange={taskWorkspaceSelected}
          onArchiveOpenSpecChange={archiveOpenSpecChange}
          workRole={workRole}
        />
        {!leftOpen && <button className="open-panel left" onClick={() => setLeftOpen(true)}>›</button>}

        {activeWorkspaceMode === "context" ? (
          <RepositoriesPanel controller={repositories} enabled={!!projects.activeProject} />
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
            viewMode={viewMode}
            userReadOnly={userReadOnlySpec}
            hideHeaderActions={masterSpecReadOnly}
            readOnlyLabel={masterSpecReadOnly ? "Master spec · только просмотр" : "Diff spec · только просмотр"}
            comments={changeDocument ? activeFragmentComments : undefined}
            toolbarLoading={openSpecToolbarLoading}
            toolbarActions={changeDocument ? (
              <OpenSpecDocumentAction
                controller={openSpec}
                change={changeDocument.change}
                documentArtifact={changeDocument.artifact}
                hasSpecs={changeHasSpecs}
                documentDirty={documents.dirty}
                documentSaving={documents.saving}
                documentComments={activeFragmentComments}
                workRole={workRole}
                onSave={writeFile}
                onActionPendingChange={(pending) => setPendingOperationChange(pending ? changeDocument.change : "")}
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
              <OpenSpecDocumentReview
                controller={openSpec}
                change={changeDocument.change}
                onReviewFeedback={notify}
              />
            ) : undefined}
            onBlur={() => undefined}
            onAddComment={changeDocument ? addFragmentComment : undefined}
            onUpdateComment={changeDocument ? updateFragmentComment : undefined}
            onDeleteComment={changeDocument ? deleteFragmentComment : undefined}
            onChange={userReadOnlySpec ? () => undefined : documents.change}
            onViewModeChange={setViewMode}
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
