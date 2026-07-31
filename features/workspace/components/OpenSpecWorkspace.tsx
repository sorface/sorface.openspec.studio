"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDocumentsController } from "@/features/documents/hooks/useDocumentsController";
import { useDocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import { useProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useRepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import { useAiOperationsController } from "@/features/ai-operations/hooks/useAiOperationsController";
import { useGitStatusController } from "@/features/git/hooks/useGitStatusController";
import { useOpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import { OpenSpecPanel } from "@/features/openspec-workflow/components/OpenSpecPanel";
import {
  isSaveShortcut,
  primaryShortcutLabel,
} from "@/features/system/model/platform-shortcuts";
import { GitPanel } from "@/features/git/components/GitPanel";
import { RepositoriesPanel } from "@/features/repositories/components/RepositoriesPanel";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { MarkdownEditor } from "./MarkdownEditor";
import { WorkspaceFooter } from "./WorkspaceFooter";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import type { AssistantMode, ViewMode, WorkspaceMode } from "@/features/workspace/model/workspace-types";

export function OpenSpecWorkspace() {
  const projects = useProjectsController();
  const repositories = useRepositoriesController(projects.activeProject?.id);
  const documents = useDocumentsController(projects.activeProject?.id);
  const documentHistory = useDocumentHistoryController(projects.activeProject?.id, documents.selectedPath);
  const configuredProvider = projects.activeProject?.defaultAiProvider ?? undefined;
  const ai = useAiOperationsController(projects.activeProject?.id, configuredProvider, projects.activeProject?.defaultModel ?? undefined);
  const providerAvailable = !!configuredProvider && (projects.capabilities?.tools.some((tool) =>
    tool.name === configuredProvider.toLowerCase() && tool.available && tool.supported !== false && tool.nonInteractive !== false,
  ) ?? false);
  const gitAvailable = projects.capabilities?.tools.some((tool) => tool.name === "git" && tool.available) ?? false;
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("documents");
  const activeWorkspaceMode = projects.activeProject ? workspaceMode : "documents";
  const git = useGitStatusController(projects.activeProject?.id, activeWorkspaceMode === "git");
  const openSpec = useOpenSpecWorkflowController(
    projects.activeProject?.id,
    configuredProvider,
    projects.activeProject?.defaultModel ?? undefined,
    providerAvailable,
    documents.retry,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("assistant");
  const [prompt, setPrompt] = useState("");
  const [messages] = useState<string[]>([]);
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
      .then(() => notify("Файл записан в Store"))
      .catch(() => undefined);
  }, [documents, notify]);

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

  const sendPrompt = () => {
    if (!prompt.trim()) return;
    void ai.send(prompt).then(() => setPrompt("")).catch(() => undefined);
  };

  const editDocumentWithAgent = async (path: string, selection: string, instruction: string) => {
    await openSpec.editDocument(path, selection, instruction);
    setWorkspaceMode("openspec");
  };

  const addOpenSpecChange = useCallback(() => {
    setWorkspaceMode("openspec");
    setOpenSpecCreateDialogOpen(true);
  }, []);

  return (
    <main className="app-shell">
      <WorkspaceHeader draftSaved={!documents.dirty} projects={projects} />

      <section className={`workspace ${leftOpen ? "" : "left-collapsed"} ${rightOpen ? "" : "right-collapsed"}`}>
        <WorkspaceSidebar
          key={projects.activeProject?.id ?? "no-project"}
          documents={documents}
          onClose={() => setLeftOpen(false)}
          repositories={repositories}
          projectSelected={!!projects.activeProject}
          gitAvailable={gitAvailable}
          workspaceMode={activeWorkspaceMode}
          onWorkspaceModeChange={setWorkspaceMode}
          onAddOpenSpecChange={addOpenSpecChange}
        />
        {!leftOpen && <button className="open-panel left" onClick={() => setLeftOpen(true)}>›</button>}

        {activeWorkspaceMode === "git" ? (
          <GitPanel controller={git} />
        ) : activeWorkspaceMode === "context" ? (
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

        <AiAssistantPanel
          assistantMode={assistantMode}
          messages={messages}
          prompt={prompt}
          onClose={() => setRightOpen(false)}
          onModeChange={setAssistantMode}
          onPromptChange={setPrompt}
          onSend={sendPrompt}
          ai={ai}
          providerAvailable={providerAvailable}
        />
        {!rightOpen && <button className="open-panel right" onClick={() => setRightOpen(true)}>‹</button>}
      </section>

      <WorkspaceFooter
        workspaceMode={activeWorkspaceMode}
        gitAvailable={gitAvailable}
        projectSelected={!!projects.activeProject}
        onWorkspaceModeChange={setWorkspaceMode}
      />
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
