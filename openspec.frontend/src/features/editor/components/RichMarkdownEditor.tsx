"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { EditorFragmentComment, EditorTextSelection } from "@/features/editor/model/fragment-comment";
import { historyShortcut } from "@/features/system/model/platform-shortcuts";

interface RichMarkdownEditorProps {
  documentId: string;
  markdown: string;
  comments?: EditorFragmentComment[];
  readOnly?: boolean;
  toolbarActions?: ReactNode;
  onBlur: () => void;
  onChange: (markdown: string) => void;
  onAddComment?: (selection: EditorTextSelection, comment: string) => void;
  onUpdateComment?: (commentId: string, comment: string) => void;
  onDeleteComment?: (commentId: string) => void;
}

interface SelectionCandidate extends EditorTextSelection {
  top: number;
  left: number;
  selectionRect: { top: number; left: number; width: number; height: number };
}

export function RichMarkdownEditor({
  documentId, markdown, comments = [], readOnly = false, toolbarActions, onBlur, onChange, onAddComment, onUpdateComment, onDeleteComment,
}: RichMarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onBlurRef = useRef(onBlur);
  const onChangeRef = useRef(onChange);
  const commentsRef = useRef(comments);
  const draftSelectionRef = useRef<EditorTextSelection | null>(null);
  const showCommentsRef = useRef<(comments: EditorFragmentComment[]) => void>(() => undefined);
  const initialMarkdownRef = useRef(markdown);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [commentRequest, setCommentRequest] = useState<SelectionCandidate | null>(null);
  const [selectionCandidate, setSelectionCandidate] = useState<SelectionCandidate | null>(null);
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentSlotTargets, setCommentSlotTargets] = useState<Record<string, HTMLElement>>({});
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  const [selectionToolbarTarget, setSelectionToolbarTarget] = useState<HTMLElement | null>(null);

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
    if (!commentRequest || !commentText.trim()) return;
    if (editingCommentId) {
      onUpdateComment?.(editingCommentId, commentText.trim());
    } else {
      if (!onAddComment) return;
      onAddComment({
        text: commentRequest.text,
        prefix: commentRequest.prefix,
        suffix: commentRequest.suffix,
        from: commentRequest.from,
        to: commentRequest.to,
      }, commentText.trim());
    }
    draftSelectionRef.current = null;
    setCommentRequest(null);
    setEditingCommentId(null);
    setCommentText("");
  };

  const cancelComment = () => {
    draftSelectionRef.current = null;
    setCommentRequest(null);
    setEditingCommentId(null);
    setCommentText("");
    showCommentsRef.current(commentsRef.current);
  };

  const openNewComment = () => {
    if (!selectionCandidate) return;
    draftSelectionRef.current = selectionCandidate;
    setCommentRequest(selectionCandidate);
    setSelectionCandidate(null);
    setEditingCommentId(null);
    setCommentText("");
    showCommentsRef.current(commentsRef.current);
  };

  const openExistingComment = (comment: EditorFragmentComment) => {
    setCommentRequest({ ...comment.selection, top: 0, left: 0, selectionRect: { top: 0, left: 0, width: 0, height: 0 } });
    setEditingCommentId(comment.id);
    setCommentText(comment.text);
  };

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;
    let removeSelectionListener: (() => void) | undefined;
    let headingSelectorObserver: MutationObserver | undefined;
    let commentSlotFrame: number | undefined;

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
              const ranges = transaction.getMeta(commentsKey) as Array<{ id: string; from: number; to: number; draft?: boolean }> | undefined;
              if (ranges === undefined) return current.map(transaction.mapping, transaction.doc);
              const inlineDecorations = ranges.map((range) => Decoration.inline(
                range.from,
                range.to,
                {
                  class: `editor-comment-highlight${range.draft ? " editor-comment-highlight-draft" : ""}`,
                  "data-comment-id": range.id,
                },
              ));
              const anchors = new Map<string, { to: number; draft?: boolean }>();
              for (const range of ranges) {
                const currentAnchor = anchors.get(range.id);
                if (!currentAnchor || range.to > currentAnchor.to) anchors.set(range.id, { to: range.to, draft: range.draft });
              }
              const widgets = Array.from(anchors, ([id, anchor]) => Decoration.widget(anchor.to, () => {
                const slot = document.createElement("span");
                slot.className = `editor-inline-comment-slot${anchor.draft ? " draft" : ""}`;
                slot.dataset.commentSlot = id;
                slot.contentEditable = "false";
                return slot;
              }, {
                key: `comment-slot-${id}`,
                side: -1,
                stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest(".editor-inline-comment-panel")),
              }));
              return DecorationSet.create(transaction.doc, [...inlineDecorations, ...widgets]);
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
            [Crepe.Feature.BlockEdit]: !readOnly,
            [Crepe.Feature.TopBar]: !readOnly,
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
        editor.setReadonly(readOnly);
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
        const nextSelectionToolbarTarget = root.querySelector<HTMLElement>(".milkdown-toolbar");
        if (nextSelectionToolbarTarget) setSelectionToolbarTarget(nextSelectionToolbarTarget);
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
        const syncCommentSlots = () => {
          const slots: Record<string, HTMLElement> = {};
          const editorSurface = root.querySelector<HTMLElement>(".ProseMirror.editor");
          const editorRect = editorSurface?.getBoundingClientRect();
          for (const slot of root.querySelectorAll<HTMLElement>("[data-comment-slot]")) {
            if (!slot.dataset.commentSlot) continue;
            slot.style.left = "0px";
            slot.style.width = "100%";
            if (editorRect) {
              const slotRect = slot.getBoundingClientRect();
              const horizontalInset = 8;
              slot.style.left = `${editorRect.left - slotRect.left + horizontalInset}px`;
              slot.style.width = `${Math.max(0, editorRect.width - horizontalInset * 2)}px`;
            }
            slots[slot.dataset.commentSlot] = slot;
          }
          setCommentSlotTargets(slots);
        };
        const scheduleCommentSlots = () => {
          if (commentSlotFrame !== undefined) window.cancelAnimationFrame(commentSlotFrame);
          commentSlotFrame = window.requestAnimationFrame(() => {
            commentSlotFrame = window.requestAnimationFrame(syncCommentSlots);
          });
        };
        showCommentsRef.current = (nextComments) => editor.editor.action((context) => {
          const view = context.get(editorViewCtx);
          const entries = draftSelectionRef.current
            ? [...nextComments, { id: "draft-comment", selection: draftSelectionRef.current, text: "", createdAt: "" }]
            : nextComments;
          const ranges = entries.flatMap((comment) => {
            const { from, to, text } = comment.selection;
            const needle = text.trim();
            if (!needle) return [];
            if (from !== undefined && to !== undefined && from < to && to <= view.state.doc.content.size &&
              view.state.doc.textBetween(from, to, "\n").trim() === needle) {
              return [{ id: comment.id, from, to, draft: comment.id === "draft-comment" }];
            }
            const normalizedNeedle = needle.replace(/\s+/g, " ");
            const normalizedCharacters: Array<{ value: string; position: number; nodeIndex: number }> = [];
            const textNodes: Array<{ text: string; from: number; to: number }> = [];
            let previousParent: unknown;
            let textNodeIndex = 0;
            view.state.doc.descendants((node, position, parent) => {
              if (!node.isText || !node.text) return;
              textNodes.push({ text: node.text, from: position, to: position + node.text.length });
              if (previousParent && previousParent !== parent && normalizedCharacters.at(-1)?.value !== " ") {
                normalizedCharacters.push({ value: " ", position: -1, nodeIndex: -1 });
              }
              for (let index = 0; index < node.text.length; index += 1) {
                const value = /\s/.test(node.text[index]) ? " " : node.text[index];
                if (value === " " && normalizedCharacters.at(-1)?.value === " ") continue;
                normalizedCharacters.push({ value, position: position + index, nodeIndex: textNodeIndex });
              }
              previousParent = parent;
              textNodeIndex += 1;
            });
            const normalizedDocument = normalizedCharacters.map((character) => character.value).join("");
            const matchIndex = normalizedDocument.indexOf(normalizedNeedle);
            const lastMatchIndex = normalizedDocument.lastIndexOf(normalizedNeedle);
            if (matchIndex < 0 || matchIndex !== lastMatchIndex) {
              if (normalizedNeedle.length < 80) return [];
              return textNodes.flatMap((textNode) => {
                const normalizedText = textNode.text.trim().replace(/\s+/g, " ");
                return normalizedText.length >= 3 && normalizedNeedle.includes(normalizedText)
                  ? [{ id: comment.id, from: textNode.from, to: textNode.to, draft: comment.id === "draft-comment" }]
                  : [];
              });
            }
            const fallbackRanges: Array<{ id: string; from: number; to: number; nodeIndex: number }> = [];
            for (const character of normalizedCharacters.slice(matchIndex, matchIndex + normalizedNeedle.length)) {
              if (character.position < 0) continue;
              const current = fallbackRanges.at(-1);
              if (current && current.to === character.position && current.nodeIndex === character.nodeIndex) {
                current.to = character.position + 1;
              } else {
                fallbackRanges.push({ id: comment.id, from: character.position, to: character.position + 1, nodeIndex: character.nodeIndex });
              }
            }
            return fallbackRanges.map(({ id, from: rangeFrom, to: rangeTo }) => ({
              id,
              from: rangeFrom,
              to: rangeTo,
              draft: id === "draft-comment",
            }));
          });
          view.dispatch(view.state.tr.setMeta(commentsKey, ranges));
          scheduleCommentSlots();
        });
        showCommentsRef.current(commentsRef.current);
        const handleCommentSlotResize = () => scheduleCommentSlots();
        window.addEventListener("resize", handleCommentSlotResize);

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
          window.removeEventListener("resize", handleCommentSlotResize);
          if (commentSlotFrame !== undefined) window.cancelAnimationFrame(commentSlotFrame);
          root.removeEventListener("keydown", handleHistoryShortcut, true);
          editor.destroy();
          return;
        }
        destroy = () => {
          removeSelectionListener?.();
          headingSelectorObserver?.disconnect();
          window.removeEventListener("resize", handleCommentSlotResize);
          if (commentSlotFrame !== undefined) window.cancelAnimationFrame(commentSlotFrame);
          root.removeEventListener("keydown", handleHistoryShortcut, true);
          showCommentsRef.current = () => undefined;
          setToolbarTarget((current) => current === nextToolbarTarget ? null : current);
          setSelectionToolbarTarget((current) => current === nextSelectionToolbarTarget ? null : current);
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
  }, [documentId, readOnly]);

  const renderCommentForm = (slotId: string) => {
    const target = commentSlotTargets[slotId];
    if (!target || !commentRequest) return null;
    return createPortal(
      <form className="editor-inline-comment-panel editing" contentEditable={false} onSubmit={submitComment} onKeyDown={(event) => {
        if (event.key === "Escape") cancelComment();
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}>
        <header>
          <span className="editor-inline-comment-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 4.5h12v8.2H9l-3.8 3v-3H4Z" /><path d="M7.2 8.5h5.6" /></svg></span>
          <b>Локальный комментарий</b>
        </header>
        <textarea autoFocus aria-label="Комментарий к выделенному фрагменту" placeholder="Запросить изменение" rows={2} value={commentText} onChange={(event) => setCommentText(event.target.value)} />
        <footer>
          <button type="button" className="cancel" onClick={cancelComment}>Отменить</button>
          <button type="submit" disabled={!commentText.trim()}>{editingCommentId ? "Сохранить" : "Комментарий"}</button>
        </footer>
      </form>,
      target,
    );
  };

  return (
    <div
      className={`rich-editor-shell${readOnly ? " read-only" : ""}`}
      data-editor-status={status}
    >
      <div
        ref={rootRef}
        className="rich-editor-root"
        role="textbox"
        aria-label="Визуальный Markdown-редактор"
        aria-multiline="true"
        aria-readonly={readOnly}
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
      {!readOnly && selectionToolbarTarget && selectionCandidate && !commentRequest && onAddComment && createPortal(
        <button type="button" className="toolbar-item editor-comment-toolbar-action" aria-label="Добавить комментарий к выделенному фрагменту" title="Добавить комментарий" data-testid="editor-comment-action" onMouseDown={(event) => event.preventDefault()} onClick={openNewComment}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12v8.2H9l-3.8 3v-3H4Z" /><path d="M7 8.5h6M10 5.8v5.4" /></svg>
        </button>,
        selectionToolbarTarget,
      )}
      {readOnly && selectionCandidate && !commentRequest && onAddComment && createPortal(
        <button
          type="button"
          className="editor-comment-floating-action"
          aria-label="Добавить комментарий к выделенному фрагменту"
          title="Добавить комментарий"
          data-testid="editor-comment-action"
          style={{ top: selectionCandidate.top, left: selectionCandidate.left }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={openNewComment}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12v8.2H9l-3.8 3v-3H4Z" /><path d="M7 8.5h6M10 5.8v5.4" /></svg>
        </button>,
        document.body,
      )}
      {comments.map((comment) => {
        const target = commentSlotTargets[comment.id];
        if (!target) return null;
        if (editingCommentId === comment.id) return <span key={comment.id}>{renderCommentForm(comment.id)}</span>;
        return createPortal(
          <article className="editor-inline-comment-panel saved" aria-label="Сохранённый комментарий к фрагменту">
            <header>
              <span className="editor-inline-comment-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 4.5h12v8.2H9l-3.8 3v-3H4Z" /><path d="M7.2 8.5h5.6" /></svg></span>
              <b>Локальный комментарий</b>
              <button type="button" onClick={() => openExistingComment(comment)} aria-label="Редактировать комментарий">✎</button>
              <button type="button" onClick={() => onDeleteComment?.(comment.id)} aria-label="Удалить комментарий">×</button>
            </header>
            <p>{comment.text}</p>
          </article>,
          target,
        );
      })}
      {!editingCommentId && commentRequest && renderCommentForm("draft-comment")}
    </div>
  );
}
