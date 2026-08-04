"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentEditResult, AgentEditSelection } from "@/features/editor/model/agent-edit";
import { historyShortcut } from "@/features/system/model/platform-shortcuts";

interface RichMarkdownEditorProps {
  documentId: string;
  markdown: string;
  agentAvailable: boolean;
  agentPending: boolean;
  toolbarActions?: ReactNode;
  onBlur: () => void;
  onChange: (markdown: string) => void;
  onAgentEdit: (selection: AgentEditSelection, instruction: string) => Promise<AgentEditResult>;
}

interface AgentRequest {
  selection: string;
  prefix?: string;
  suffix?: string;
  from?: number;
  to?: number;
  top: number;
  left: number;
  selectionRect: { top: number; left: number; width: number; height: number };
}

const agentActionIcon = `
  <svg data-agent-action="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="editor-agent-gradient" x1="5" y1="4" x2="20" y2="21" gradientUnits="userSpaceOnUse">
        <stop stop-color="#168BFF"/>
        <stop offset=".38" stop-color="#7557F5"/>
        <stop offset=".7" stop-color="#E34BA9"/>
        <stop offset="1" stop-color="#F59B45"/>
      </linearGradient>
    </defs>
    <path d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4 12 3.5Z" stroke="url(#editor-agent-gradient)" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="m17.5 15 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" fill="url(#editor-agent-gradient)"/>
  </svg>`;

export function RichMarkdownEditor({
  documentId, markdown, agentAvailable, agentPending, toolbarActions, onBlur, onChange, onAgentEdit,
}: RichMarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onBlurRef = useRef(onBlur);
  const onChangeRef = useRef(onChange);
  const applyAgentEditRef = useRef<(result: AgentEditResult, range: { from: number; to: number } | null) => void>(() => undefined);
  const showProcessingRef = useRef<(range: { from: number; to: number } | null) => void>(() => undefined);
  const initialMarkdownRef = useRef(markdown);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [agentRequest, setAgentRequest] = useState<AgentRequest | null>(null);
  const [agentCandidate, setAgentCandidate] = useState<AgentRequest | null>(null);
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentError, setAgentError] = useState("");
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    onBlurRef.current = onBlur;
    onChangeRef.current = onChange;
    initialMarkdownRef.current = markdown;
  }, [markdown, onBlur, onChange]);

  const submitAgentEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!agentRequest || !agentInstruction.trim() || agentSubmitting || agentPending) return;
    if (!agentAvailable) {
      setAgentError("Сначала выберите доступный agent CLI в верхней панели.");
      return;
    }
    setAgentSubmitting(true);
    setAgentError("");
    if (agentRequest.from !== undefined && agentRequest.to !== undefined) {
      showProcessingRef.current({ from: agentRequest.from, to: agentRequest.to });
    }
    try {
      const result = await onAgentEdit({
        text: agentRequest.selection,
        prefix: agentRequest.prefix,
        suffix: agentRequest.suffix,
      }, agentInstruction.trim());
      const range = agentRequest.from !== undefined && agentRequest.to !== undefined
        ? { from: agentRequest.from, to: agentRequest.to }
        : null;
      applyAgentEditRef.current(result, range);
      // Persist the exact backend-scoped Markdown even if the visual editor normalizes
      // the transaction differently. The editor transaction remains the immediate UI update.
      onChangeRef.current(result.markdown);
      setAgentRequest(null);
      setAgentInstruction("");
    } catch (cause) {
      setAgentError(cause instanceof Error ? cause.message : "Не удалось изменить выделенный фрагмент");
    } finally {
      showProcessingRef.current(null);
      setAgentSubmitting(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;
    let removeSelectionListener: (() => void) | undefined;
    let headingSelectorObserver: MutationObserver | undefined;

    async function initialize() {
      const root = rootRef.current;
      if (!root) return;

      try {
        let editorReady = false;
        const initialMarkdown = initialMarkdownRef.current;
        let normalizedInitialMarkdown = initialMarkdown;

        const [
          { Crepe }, { editorViewCtx }, { redo, undo }, { replaceAll, $prose },
          { Plugin, PluginKey }, { Decoration, DecorationSet },
        ] = await Promise.all([
          import("@milkdown/crepe"),
          import("@milkdown/kit/core"),
          import("@milkdown/kit/prose/history"),
          import("@milkdown/kit/utils"),
          import("@milkdown/kit/prose/state"),
          import("@milkdown/kit/prose/view"),
        ]);
        if (disposed) return;

        const processingKey = new PluginKey("agent-selection-processing");
        const processingPlugin = $prose(() => new Plugin({
          key: processingKey,
          state: {
            init: () => DecorationSet.empty,
            apply: (transaction, current) => {
              const range = transaction.getMeta(processingKey) as { from: number; to: number } | null | undefined;
              if (range === undefined) return current.map(transaction.mapping, transaction.doc);
              if (range === null) return DecorationSet.empty;
              return DecorationSet.create(transaction.doc, [
                Decoration.inline(range.from, range.to, { class: "agent-selection-processing" }),
              ]);
            },
          },
          props: {
            decorations: (state) => processingKey.getState(state),
          },
        }));

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
            [Crepe.Feature.Placeholder]: {
              text: "Начните писать или нажмите «/», чтобы добавить блок…",
              mode: "doc",
            },
            [Crepe.Feature.LinkTooltip]: {
              inputPlaceholder: "Вставьте ссылку",
            },
          },
        });
        editor.editor.use(processingPlugin);

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
        const nextToolbarTarget = root.querySelector<HTMLElement>(".milkdown-top-bar .top-bar-inner");
        if (nextToolbarTarget) {
          const syncHeadingSelectorWeight = () => {
            const button = nextToolbarTarget.querySelector<HTMLElement>(".top-bar-heading-button");
            const label = button?.querySelector<HTMLElement>(".top-bar-heading-label");
            button?.classList.toggle("heading-active", /^Heading [1-6]$/.test(label?.textContent?.trim() ?? ""));
          };
          headingSelectorObserver = new MutationObserver(syncHeadingSelectorWeight);
          headingSelectorObserver.observe(nextToolbarTarget, { childList: true, characterData: true, subtree: true });
          syncHeadingSelectorWeight();
          setToolbarTarget(nextToolbarTarget);
        }
        applyAgentEditRef.current = (result, range) => {
          if (!range || result.replacement.includes("\n")) {
            editor.editor.action(replaceAll(result.markdown));
            return;
          }
          editor.editor.action((context) => {
            const view = context.get(editorViewCtx);
            view.dispatch(view.state.tr.insertText(result.replacement, range.from, range.to));
          });
        };
        showProcessingRef.current = (range) => editor.editor.action((context) => {
          const view = context.get(editorViewCtx);
          view.dispatch(view.state.tr.setMeta(processingKey, range));
        });

        const captureSelection = () => {
          const nativeSelection = window.getSelection();
          if (!nativeSelection || nativeSelection.isCollapsed || !nativeSelection.rangeCount) {
            setAgentCandidate(null);
            return;
          }
          const selection = nativeSelection.toString().trim();
          const range = nativeSelection.getRangeAt(0);
          const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer as Element
            : range.commonAncestorContainer.parentElement;
          if (!selection || !container || !root.contains(container)) {
            setAgentCandidate(null);
            return;
          }
          const rect = range.getBoundingClientRect();
          if (!rect.width && !rect.height) return;
          const candidate: AgentRequest = {
            selection,
            top: Math.min(rect.bottom + 12, window.innerHeight - 92),
            left: Math.max(12, Math.min(rect.left, window.innerWidth - 402)),
            selectionRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          };
          if (!container.closest(".cm-content")) {
            editor.editor.action((context) => {
              const view = context.get(editorViewCtx);
              const { from, to } = view.state.selection;
              if (from !== to && view.state.doc.textBetween(from, to, "\n").trim() === selection) {
                candidate.from = from;
                candidate.to = to;
                candidate.prefix = view.state.doc.textBetween(0, from, "\n").slice(-160);
                candidate.suffix = view.state.doc.textBetween(to, view.state.doc.content.size, "\n").slice(0, 160);
              }
            });
          }
          setAgentCandidate(candidate);
        };
        document.addEventListener("selectionchange", captureSelection);
        removeSelectionListener = () => document.removeEventListener("selectionchange", captureSelection);
        normalizedInitialMarkdown = editor.getMarkdown();
        editorReady = true;
        if (disposed) {
          removeSelectionListener();
          headingSelectorObserver?.disconnect();
          editor.destroy();
          return;
        }
        destroy = () => {
          removeSelectionListener?.();
          headingSelectorObserver?.disconnect();
          root.removeEventListener("keydown", handleHistoryShortcut, true);
          applyAgentEditRef.current = () => undefined;
          showProcessingRef.current = () => undefined;
          setToolbarTarget((current) => current === nextToolbarTarget ? null : current);
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
      {toolbarTarget && toolbarActions && createPortal(
        <div className="rich-editor-context-actions">{toolbarActions}</div>,
        toolbarTarget,
      )}
      {typeof document !== "undefined" && createPortal(<>
        {agentCandidate && !agentRequest && (
          <button
            type="button"
            className="agent-selection-action"
            style={{
              top: Math.max(76, Math.min(agentCandidate.selectionRect.top - 38, window.innerHeight - 44)),
              left: Math.max(8, Math.min(agentCandidate.selectionRect.left + agentCandidate.selectionRect.width - 32, window.innerWidth - 40)),
            }}
            aria-label="Редактировать изменение через agent"
            title="Редактировать через agent"
            data-testid="editor-agent-action"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setAgentRequest(agentCandidate);
              setAgentCandidate(null);
              setAgentInstruction("");
              setAgentError("");
            }}
            dangerouslySetInnerHTML={{ __html: agentActionIcon }}
          />
        )}
        {agentSubmitting && agentRequest && agentRequest.from === undefined && (
          <div
            className="agent-selection-processing-overlay"
            style={agentRequest.selectionRect}
            aria-hidden="true"
          />
        )}
        {agentRequest && (
          <form
            className="agent-inline-prompt"
            style={{ top: agentRequest.top, left: agentRequest.left }}
            onSubmit={submitAgentEdit}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !agentSubmitting) setAgentRequest(null);
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.requestSubmit();
              }
            }}
          >
            <textarea
              autoFocus
              aria-label="Как изменить выделенный текст?"
              placeholder="Как изменить выделенный текст?"
              rows={2}
              value={agentInstruction}
              onChange={(event) => setAgentInstruction(event.target.value)}
              disabled={agentSubmitting || agentPending}
            />
            <button
              type="submit"
              aria-label="Отправить инструкцию agent"
              title="Отправить"
              disabled={!agentInstruction.trim() || agentSubmitting || agentPending}
            >
              {agentSubmitting || agentPending ? <span className="agent-inline-spinner" /> : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Zm3.4 7h8.4L6.5 6.6 7.4 11Zm0 2-.9 4.4 9.3-4.4H7.4Z" /></svg>
              )}
            </button>
            {agentError && <small role="alert">{agentError}</small>}
          </form>
        )}
      </>, document.body)}
    </div>
  );
}
