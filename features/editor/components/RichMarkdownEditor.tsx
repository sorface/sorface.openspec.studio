"use client";

import { useEffect, useRef, useState } from "react";
import { historyShortcut } from "@/features/system/model/platform-shortcuts";

interface RichMarkdownEditorProps {
  documentId: string;
  markdown: string;
  onBlur: () => void;
  onChange: (markdown: string) => void;
  onAskAgent: (selection: string) => void;
}

const agentActionIcon = `
  <svg data-agent-action="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4 12 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="m17.5 15 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" fill="currentColor"/>
  </svg>`;

export function RichMarkdownEditor({ documentId, markdown, onBlur, onChange, onAskAgent }: RichMarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onBlurRef = useRef(onBlur);
  const onChangeRef = useRef(onChange);
  const onAskAgentRef = useRef(onAskAgent);
  const initialMarkdownRef = useRef(markdown);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    onBlurRef.current = onBlur;
    onChangeRef.current = onChange;
    onAskAgentRef.current = onAskAgent;
    initialMarkdownRef.current = markdown;
  }, [markdown, onAskAgent, onBlur, onChange]);

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;
    let toolbarObserver: MutationObserver | undefined;

    async function initialize() {
      const root = rootRef.current;
      if (!root) return;

      try {
        let editorReady = false;
        const initialMarkdown = initialMarkdownRef.current;
        let normalizedInitialMarkdown = initialMarkdown;

        const [{ Crepe }, { editorViewCtx }, { redo, undo }] = await Promise.all([
          import("@milkdown/crepe"),
          import("@milkdown/kit/core"),
          import("@milkdown/kit/prose/history"),
        ]);
        if (disposed) return;

        const editor = new Crepe({
          root,
          defaultValue: initialMarkdown,
          features: {
            [Crepe.Feature.Cursor]: false,
            [Crepe.Feature.TopBar]: true,
            [Crepe.Feature.ImageBlock]: false,
            [Crepe.Feature.Latex]: false,
            [Crepe.Feature.AI]: false,
          },
          featureConfigs: {
            [Crepe.Feature.Toolbar]: {
              buildToolbar: (builder) => {
                builder.addGroup("agent", "Agent").addItem("ask-agent", {
                  icon: agentActionIcon,
                  active: () => false,
                  onRun: (context) => {
                    const view = context.get(editorViewCtx);
                    const { from, to } = view.state.selection;
                    const selection = view.state.doc.textBetween(from, to, "\n").trim();
                    if (selection) onAskAgentRef.current(selection);
                  },
                });
              },
            },
            [Crepe.Feature.Placeholder]: {
              text: "Начните писать или нажмите «/», чтобы добавить блок…",
              mode: "doc",
            },
            [Crepe.Feature.LinkTooltip]: {
              inputPlaceholder: "Вставьте ссылку",
            },
          },
        });

        const handleHistoryShortcut = (event: KeyboardEvent) => {
          const action = historyShortcut(event);
          if (!action) return;
          const handled = editor.editor.action((context) => {
            const view = context.get(editorViewCtx);
            return (action === "undo" ? undo : redo)(view.state, view.dispatch);
          });
          if (!handled) return;
          event.preventDefault();
          event.stopPropagation();
        };
        root.addEventListener("keydown", handleHistoryShortcut, true);

        editor.on((listener) => {
          listener.markdownUpdated((_context, nextMarkdown, previousMarkdown) => {
            if (!editorReady) return;
            if (nextMarkdown !== previousMarkdown) {
              onChangeRef.current(nextMarkdown === normalizedInitialMarkdown ? initialMarkdown : nextMarkdown);
            }
          });
          listener.blur(() => onBlurRef.current());
        });

        await editor.create();
        const labelAgentActions = () => {
          root.querySelectorAll<SVGElement>("[data-agent-action]").forEach((icon) => {
            const button = icon.closest("button");
            button?.setAttribute("aria-label", "Редактировать изменение через agent");
            button?.setAttribute("title", "Редактировать изменение через agent");
            button?.setAttribute("data-testid", "editor-agent-action");
          });
        };
        labelAgentActions();
        toolbarObserver = new MutationObserver(labelAgentActions);
        toolbarObserver.observe(root, { childList: true, subtree: true });
        normalizedInitialMarkdown = editor.getMarkdown();
        editorReady = true;
        if (disposed) {
          toolbarObserver.disconnect();
          editor.destroy();
          return;
        }
        destroy = () => {
          toolbarObserver?.disconnect();
          root.removeEventListener("keydown", handleHistoryShortcut, true);
          editor.destroy();
        };
        setStatus("ready");
      } catch {
        if (!disposed) setStatus("failed");
      }
    }

    void initialize();
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [documentId]);

  return (
    <div className="rich-editor-shell" data-editor-status={status}>
      <div
        ref={rootRef}
        className="rich-editor-root"
        role="textbox"
        aria-label="Визуальный Markdown-редактор"
        aria-multiline="true"
      />
      {status === "loading" && <div className="editor-loading">Подготавливаем визуальный редактор…</div>}
      {status === "failed" && (
        <div className="editor-error" role="alert">
          Редактор не загрузился. Обновите страницу — черновик не потерян.
        </div>
      )}
    </div>
  );
}
