"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDocumentsController } from "@/features/documents/hooks/useDocumentsController";
import { useDocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import { useProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useRepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import { useOpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import { OpenSpecPanel } from "@/features/openspec-workflow/components/OpenSpecPanel";
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

export function OpenSpecWorkspace() {
  const projects = useProjectsController();
  const repositories = useRepositoriesController(projects.activeProject?.id);
  const tasks = useTaskContextController(projects.activeProject?.id);
  const workspaceContext = tasks.overview?.active?.id ?? projects.activeProject?.activeTask ?? "base";
  const documents = useDocumentsController(projects.activeProject?.id, workspaceContext);
  const documentHistory = useDocumentHistoryController(projects.activeProject?.id, documents.selectedPath, workspaceContext);
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
    documents.retry,
    workspaceContext,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [leftOpen, setLeftOpen] = useState(true);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [saveShortcutLabel, setSaveShortcutLabel] = useState("Ctrl+S");
  const [openSpecCreateDialogOpen, setOpenSpecCreateDialogOpen] = useState(false);

  const lines = useMemo(() => documents.markdown.split("\n"), [documents.markdown]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const writeFile = useCallback(() => {
    void documents.save()
      .then(() => {
        tasks.refresh();
        notify("Файл сохранён в задаче");
      })
      .catch(() => undefined);
  }, [documents, notify, tasks]);

  const preparePublication = useCallback(() => {
    void tasks.preparePublication().catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Не удалось подготовить публикацию");
    });
  }, [notify, tasks]);

  useEffect(() => {
    void Promise.resolve().then(() => setSaveShortcutLabel(primaryShortcutLabel("S")));
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      writeFile();
    };
    window.addEventListener("keydown", handleSaveShortcut, true);
    return () => window.removeEventListener("keydown", handleSaveShortcut, true);
  }, [writeFile]);

  const editDocumentWithAgent = async (path: string, selection: string, instruction: string) => {
    return openSpec.editDocument(path, selection, instruction);
  };

  const addOpenSpecChange = useCallback(() => {
    setWorkspaceMode("openspec");
    setOpenSpecCreateDialogOpen(true);
  }, []);

  return (
    <main className="app-shell">
      <WorkspaceHeader
        agentSettingsOpen={agentSettingsOpen}
        draftSaved={!documents.dirty}
        onAgentSettingsToggle={() => setAgentSettingsOpen((open) => !open)}
        onPublish={preparePublication}
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
            createDialogOpen={openSpecCreateDialogOpen}
            onCreateDialogOpenChange={setOpenSpecCreateDialogOpen}
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
            agentAvailable={providerAvailable}
            agentPending={openSpec.pending}
            onBlur={() => undefined}
            onAgentEdit={editDocumentWithAgent}
            onChange={documents.change}
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
