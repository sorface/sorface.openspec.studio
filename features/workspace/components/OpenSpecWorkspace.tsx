"use client";

import { useMemo, useState } from "react";
import { useProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useRepositoriesController } from "@/features/repositories/hooks/useRepositoriesController";
import { useAiOperationsController } from "@/features/ai-operations/hooks/useAiOperationsController";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { MarkdownEditor } from "./MarkdownEditor";
import { WorkspaceFooter } from "./WorkspaceFooter";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { initialMarkdown } from "@/features/workspace/model/workspace-data";
import type { AssistantMode, ViewMode } from "@/features/workspace/model/workspace-types";

export function OpenSpecWorkspace() {
  const projects = useProjectsController();
  const repositories = useRepositoriesController(projects.activeProject?.id);
  const configuredProvider = projects.activeProject?.defaultAiProvider ?? "codex";
  const ai = useAiOperationsController(projects.activeProject?.id, configuredProvider, projects.activeProject?.defaultModel ?? undefined);
  const providerAvailable = projects.capabilities?.tools.some((tool) =>
    tool.name === configuredProvider.toLowerCase() && tool.available && tool.supported !== false && tool.nonInteractive !== false,
  ) ?? false;
  const [activeFile, setActiveFile] = useState("proposal");
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [draftSaved, setDraftSaved] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("assistant");
  const [prompt, setPrompt] = useState("");
  const [messages] = useState<string[]>([]);
  const [toast, setToast] = useState("");

  const lines = useMemo(() => markdown.split("\n"), [markdown]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const saveDraft = () => {
    setDraftSaved(true);
    notify("Черновик сохранён");
  };

  const writeFile = () => {
    notify("API записи Markdown пока не реализован");
  };

  const sendPrompt = () => {
    if (!prompt.trim()) return;
    void ai.send(prompt).then(() => setPrompt("")).catch(() => undefined);
  };

  return (
    <main className="app-shell">
      <WorkspaceHeader draftSaved={draftSaved} projects={projects} />

      <section className={`workspace ${leftOpen ? "" : "left-collapsed"} ${rightOpen ? "" : "right-collapsed"}`}>
        <WorkspaceSidebar activeFile={activeFile} onFileSelect={setActiveFile} onClose={() => setLeftOpen(false)} repositories={repositories} />
        {!leftOpen && <button className="open-panel left" onClick={() => setLeftOpen(true)}>›</button>}

        <MarkdownEditor
          activeFile={activeFile}
          lines={lines}
          markdown={markdown}
          viewMode={viewMode}
          onBlur={saveDraft}
          onChange={(nextMarkdown) => {
            setMarkdown(nextMarkdown);
            setDraftSaved(false);
          }}
          onViewModeChange={setViewMode}
          onWrite={writeFile}
        />

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

      <WorkspaceFooter onCommit={() => notify("Откройте Git-панель для commit")} />
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
