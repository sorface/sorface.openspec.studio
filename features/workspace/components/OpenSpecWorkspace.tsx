"use client";

import { useMemo, useState } from "react";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { MarkdownEditor } from "./MarkdownEditor";
import { WorkspaceFooter } from "./WorkspaceFooter";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { initialMarkdown } from "@/features/workspace/model/workspace-data";
import type { AssistantMode, ViewMode } from "@/features/workspace/model/workspace-types";

export function OpenSpecWorkspace() {
  const [activeFile, setActiveFile] = useState("proposal");
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [draftSaved, setDraftSaved] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("assistant");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
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
    setDraftSaved(true);
    notify("Черновик записан в working tree");
  };

  const sendPrompt = () => {
    if (!prompt.trim()) return;
    setMessages((current) => [...current, prompt.trim()]);
    setPrompt("");
    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        "Я уточнил критерии безопасности и подготовил предложение. Изменения доступны для review.",
      ]);
    }, 450);
  };

  return (
    <main className="app-shell">
      <WorkspaceHeader draftSaved={draftSaved} />

      <section className={`workspace ${leftOpen ? "" : "left-collapsed"} ${rightOpen ? "" : "right-collapsed"}`}>
        <WorkspaceSidebar activeFile={activeFile} onFileSelect={setActiveFile} onClose={() => setLeftOpen(false)} />
        {!leftOpen && <button className="open-panel left" onClick={() => setLeftOpen(true)}>›</button>}

        <MarkdownEditor
          activeFile={activeFile}
          lines={lines}
          markdown={markdown}
          viewMode={viewMode}
          onBlur={saveDraft}
          onChange={(event) => {
            setMarkdown(event.target.value);
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
        />
        {!rightOpen && <button className="open-panel right" onClick={() => setRightOpen(true)}>‹</button>}
      </section>

      <WorkspaceFooter onCommit={() => notify("Откройте Git-панель для commit")} />
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
