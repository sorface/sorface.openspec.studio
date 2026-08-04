"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { EditorFragmentComment, EditorTextSelection } from "@/features/editor/model/fragment-comment";
import { historyShortcut } from "@/features/system/model/platform-shortcuts";

interface RichMarkdownEditorProps {
  documentId: string;
  markdown: string;
  comments?: EditorFragmentComment[];
  toolbarActions?: ReactNode;
  onBlur: () => void;
  onChange: (markdown: string) => void;
  onAddComment?: (selection: EditorTextSelection, comment: string) => void;
  onDeleteComment?: (commentId: string) => void;
}

interface SelectionCandidate extends EditorTextSelection {
  top: number;
  left: number;
  selectionRect: { top: number; left: number; width: number; height: number };
}

export function RichMarkdownEditor({
  documentId, markdown, comments = [], toolbarActions, onBlur, onChange, onAddComment, onDeleteComment,
}: RichMarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onBlurRef = useRef(onBlur);
  const onChangeRef = useRef(onChange);
  const commentsRef = useRef(comments);
  const showCommentsRef = useRef<(comments: EditorFragmentComment[]) => void>(() => undefined);
  const initialMarkdownRef = useRef(markdown);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [commentRequest, setCommentRequest] = useState<SelectionCandidate | null>(null);
  const [selectionCandidate, setSelectionCandidate] = useState<SelectionCandidate | null>(null);
  const [commentText, setCommentText] = useState("");
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    onBlurRef.current = onBlur;
    onChangeRef.current = onChange;
    initialMarkdownRef.current = markdown;
  }, [markdown, onBlur, onChange]);

  useEffect(() => {
    commentsRef.current = comments;
    showCommentsRef.current(comments);
  }, [comments]);

  const submitComment = (event: FormEvent) => {
    event.preventDefault();
    if (!commentRequest || !commentText.trim() || !onAddComment) return;
    onAddComment({
      text: commentRequest.text,
      prefix: commentRequest.prefix,
      suffix: commentRequest.suffix,
      from: commentRequest.from,
      to: commentRequest.to,
    }, commentText.trim());
    setCommentRequest(null);
    setCommentText("");
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
          { Crepe }, { editorViewCtx }, { redo, undo }, { $prose },
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

        const commentsKey = new PluginKey("editor-fragment-comments");
        const commentsPlugin = $prose(() => new Plugin({
          key: commentsKey,
          state: {
            init: () => DecorationSet.empty,
            apply: (transaction, current) => {
              const ranges = transaction.getMeta(commentsKey) as Array<{ id: string; from: number; to: number }> | undefined;
              if (ranges === undefined) return current.map(transaction.mapping, transaction.doc);
              return DecorationSet.create(transaction.doc, ranges.map((range) => Decoration.inline(
                range.from,
                range.to,
                { class: "editor-comment-highlight", "data-comment-id": range.id },
              )));
            },
          },
          props: {
            decorations: (state) => commentsKey.getState(state),
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
        editor.editor.use(commentsPlugin);

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
        showCommentsRef.current = (nextComments) => editor.editor.action((context) => {
          const view = context.get(editorViewCtx);
          const ranges = nextComments.flatMap((comment) => {
            const { from, to, text } = comment.selection;
            if (from === undefined || to === undefined || from >= to || to > view.state.doc.content.size) return [];
            return view.state.doc.textBetween(from, to, "\n").trim() === text.trim()
              ? [{ id: comment.id, from, to }]
              : [];
          });
          view.dispatch(view.state.tr.setMeta(commentsKey, ranges));
        });
        showCommentsRef.current(commentsRef.current);

        const captureSelection = () => {
          const nativeSelection = window.getSelection();
          if (!nativeSelection || nativeSelection.isCollapsed || !nativeSelection.rangeCount) {
            setSelectionCandidate(null);
            return;
          }
          const selection = nativeSelection.toString().trim();
          const range = nativeSelection.getRangeAt(0);
          const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer as Element
            : range.commonAncestorContainer.parentElement;
          if (!selection || !container || !root.contains(container)) {
            setSelectionCandidate(null);
            return;
          }
          const rect = range.getBoundingClientRect();
          if (!rect.width && !rect.height) return;
          const candidate: SelectionCandidate = {
            text: selection,
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
          setSelectionCandidate(candidate);
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
          showCommentsRef.current = () => undefined;
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
      {comments.length > 0 && (
        <aside className="editor-fragment-comments" aria-label={`Комментарии к фрагментам: ${comments.length}`}>
          <header><b>Комментарии</b><span>{comments.length}</span></header>
          {comments.map((comment) => (
            <article key={comment.id}>
              <button
                type="button"
                className="editor-comment-link"
                onClick={() => document.querySelector(`[data-comment-id="${comment.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                title="Перейти к фрагменту"
              >
                <small>«{comment.selection.text.replace(/\s+/g, " ").slice(0, 74)}{comment.selection.text.length > 74 ? "…»" : "»"}</small>
                <span>{comment.text}</span>
              </button>
              <button type="button" className="editor-comment-delete" onClick={() => onDeleteComment?.(comment.id)} aria-label="Удалить комментарий">×</button>
            </article>
          ))}
        </aside>
      )}
      {typeof document !== "undefined" && createPortal(<>
        {selectionCandidate && !commentRequest && onAddComment && (
          <button
            type="button"
            className="editor-comment-action"
            style={{
              top: Math.max(76, Math.min(selectionCandidate.selectionRect.top - 38, window.innerHeight - 44)),
              left: Math.max(8, Math.min(selectionCandidate.selectionRect.left + selectionCandidate.selectionRect.width - 32, window.innerWidth - 40)),
            }}
            aria-label="Добавить комментарий к выделенному фрагменту"
            title="Добавить комментарий"
            data-testid="editor-comment-action"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setCommentRequest(selectionCandidate);
              setSelectionCandidate(null);
              setCommentText("");
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12v8.2H9l-3.8 3v-3H4Z" /><path d="M7 8.5h6M10 5.8v5.4" /></svg>
          </button>
        )}
        {commentRequest && (
          <form
            className="editor-comment-prompt"
            style={{ top: commentRequest.top, left: commentRequest.left }}
            onSubmit={submitComment}
            onKeyDown={(event) => {
              if (event.key === "Escape") setCommentRequest(null);
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.requestSubmit();
              }
            }}
          >
            <textarea
              autoFocus
              aria-label="Комментарий к выделенному фрагменту"
              placeholder="Оставьте комментарий к фрагменту…"
              rows={2}
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
            />
            <button
              type="submit"
              aria-label="Сохранить комментарий"
              title="Сохранить комментарий"
              disabled={!commentText.trim()}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 3.5 3.5L16 5" /></svg>
            </button>
          </form>
        )}
      </>, document.body)}
    </div>
  );
}
