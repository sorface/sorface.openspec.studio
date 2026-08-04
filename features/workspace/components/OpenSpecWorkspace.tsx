"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDocumentsController } from "@/features/documents/hooks/useDocumentsController";
import { useDocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import type { AgentEditSelection } from "@/features/editor/model/agent-edit";
import { useProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useRepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import { useOpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import { OpenSpecPanel } from "@/features/openspec-workflow/components/OpenSpecPanel";
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
import { WorkspaceFooter } from "./WorkspaceFooter";
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
  artifact: "proposal" | "design";
}

const DOCUMENT_AUTOSAVE_DELAY_MS = 3_000;

function changeDocumentContextFromPath(path: string | null): ChangeDocumentContext | null {
  const match = path?.match(/^openspec\/changes\/([^/]+)\/(proposal|design)\.md$/);
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
  const retryDocuments = documents.retry;
  const saveDocument = documents.save;
  const selectedDocumentPath = documents.selectedPath;
  const refreshTasks = tasks.refresh;
  const refreshStoreState = useCallback(() => {
    retryDocuments();
    refreshTasks();
  }, [refreshTasks, retryDocuments]);
  const configuredProvider = projects.activeProject?.defaultAiProvider ?? undefined;
  const providerAvailable = !!configuredProvider && (projects.capabilities?.tools.some((tool) =>
    tool.name === configuredProvider.toLowerCase() && tool.available && tool.supported !== false && tool.nonInteractive !== false,
  ) ?? false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("documents");
  const activeWorkspaceMode = projects.activeProject ? workspaceMode : "documents";
  const openSpec = useOpenSpecWorkflowController(
    projects.activeProject?.id,
    configuredProvider,
    projects.activeProject?.defaultModel ?? undefined,
    providerAvailable,
    refreshStoreState,
    workspaceContext,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [leftOpen, setLeftOpen] = useState(true);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [saveShortcutLabel, setSaveShortcutLabel] = useState("Ctrl+S");
  const [openSpecCreationPageOpen, setOpenSpecCreationPageOpen] = useState(false);
  const [pendingDocumentPath, setPendingDocumentPath] = useState("");

  const lines = useMemo(() => documents.markdown.split("\n"), [documents.markdown]);
  const changeDocument = useMemo(
    () => changeDocumentContextFromPath(documents.selectedPath),
    [documents.selectedPath],
  );
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

  const editDocumentWithAgent = async (path: string, selection: AgentEditSelection, instruction: string) => {
    return openSpec.editDocument(path, selection, instruction);
  };

  const addOpenSpecChange = useCallback(() => {
    setWorkspaceMode("openspec");
    setOpenSpecCreationPageOpen(true);
  }, []);

  const openCreatedChange = useCallback((proposalPath: string) => {
    setPendingDocumentPath(proposalPath);
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
      <WorkspaceHeader
        agentSettingsOpen={agentSettingsOpen}
        draftSaved={!documents.dirty}
        onAgentSettingsToggle={() => setAgentSettingsOpen((open) => !open)}
        onPublish={preparePublication}
        onReceive={receiveRemoteChanges}
        projects={projects}
        tasks={tasks}
      />

      <section className={`workspace ${agentSettingsOpen ? "agent-settings-open" : ""} ${leftOpen ? "" : "left-collapsed"}`}>
        <WorkspaceSidebar
          key={projects.activeProject?.id ?? "no-project"}
          documents={documents}
          onClose={() => setLeftOpen(false)}
          repositories={repositories}
          projectSelected={!!projects.activeProject}
          workspaceMode={activeWorkspaceMode}
          onWorkspaceModeChange={setWorkspaceMode}
          onAddOpenSpecChange={addOpenSpecChange}
        />
        {!leftOpen && <button className="open-panel left" onClick={() => setLeftOpen(true)}>›</button>}

        {activeWorkspaceMode === "context" ? (
          <RepositoriesPanel controller={repositories} enabled={!!projects.activeProject} />
        ) : activeWorkspaceMode === "openspec" ? (
          <OpenSpecPanel
            controller={openSpec}
            projectId={projects.activeProject?.id}
            creationPageOpen={openSpecCreationPageOpen}
            onCreationPageOpenChange={setOpenSpecCreationPageOpen}
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
            agentAvailable={providerAvailable}
            agentPending={openSpec.pending}
            toolbarActions={changeDocument ? (
              <OpenSpecDocumentAction
                controller={openSpec}
                change={changeDocument.change}
                documentArtifact={changeDocument.artifact}
                hasSpecs={changeHasSpecs}
                documentDirty={documents.dirty}
                documentSaving={documents.saving}
                onSave={writeFile}
                onCreateChange={addOpenSpecChange}
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
            onAgentEdit={editDocumentWithAgent}
            onChange={userReadOnlySpec ? () => undefined : documents.change}
            onViewModeChange={setViewMode}
            onWrite={writeFile}
            onRetry={documents.retry}
          />
        )}

        {agentSettingsOpen && <AgentCliPanel onClose={() => setAgentSettingsOpen(false)} projects={projects} />}
      </section>

      <WorkspaceFooter
        workspaceMode={activeWorkspaceMode}
        projectSelected={!!projects.activeProject}
        onWorkspaceModeChange={setWorkspaceMode}
      />
      <PublicationDialog controller={tasks} onPublished={(task) => notify(`Артефакты задачи ${task} отправляются`)} />
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
