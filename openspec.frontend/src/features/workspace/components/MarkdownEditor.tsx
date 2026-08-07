import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiError } from "@/features/api/api-client";
import { DocumentHistoryPanel } from "@/features/documents/components/DocumentHistoryPanel";
import type { DocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import { MarkdownPreview } from "@/features/editor/components/MarkdownPreview";
import { FlyingOperationBird, RichMarkdownEditor } from "@/features/editor/components/RichMarkdownEditor";
import type { EditorFragmentComment, EditorTextSelection } from "@/features/editor/model/fragment-comment";
import type { DocumentViewStatus } from "@/features/documents/model/document-types";
import type { ViewMode } from "@/features/workspace/model/workspace-types";

interface MarkdownEditorProps {
  activeFile: string | null;
  lines: string[];
  markdown: string;
  documentStatus: DocumentViewStatus;
  loadingDocument: boolean;
  saving: boolean;
  dirty: boolean;
  conflict: boolean;
  error: ApiError | null;
  history: DocumentHistoryController;
  viewMode: ViewMode;
  userReadOnly?: boolean;
  hideHeaderActions?: boolean;
  readOnlyLabel?: string;
  comments?: EditorFragmentComment[];
  toolbarLoading?: boolean;
  toolbarActions?: ReactNode;
  contextPanel?: ReactNode;
  onBlur: () => void;
  onAddComment?: (path: string, selection: EditorTextSelection, comment: string) => void;
  onUpdateComment?: (path: string, commentId: string, comment: string) => void;
  onDeleteComment?: (path: string, commentId: string) => void;
  onChange: (markdown: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onRetry: () => void;
}

const viewModes: ViewMode[] = ["edit", "preview", "split"];

export function MarkdownEditor(props: MarkdownEditorProps) {
  const {
    activeFile, lines, markdown, documentStatus, loadingDocument, saving, dirty, conflict,
    error, history, viewMode, userReadOnly = false, hideHeaderActions = false,
    readOnlyLabel = "Только просмотр", comments, toolbarLoading = false,
    toolbarActions, contextPanel, onBlur, onAddComment, onUpdateComment, onDeleteComment, onChange, onViewModeChange, onRetry,
  } = props;
  const breadcrumbs = activeFile?.split("/") ?? [];
  const canEdit = documentStatus === "ready" && !!activeFile && !loadingDocument;
  const effectiveViewMode: ViewMode = userReadOnly ? "preview" : viewMode;
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  const previousToolbarLoading = useRef(toolbarLoading);
  const [editorRevision, setEditorRevision] = useState(0);
  useEffect(() => {
    if (previousToolbarLoading.current && !toolbarLoading) {
      setEditorRevision((current) => current + 1);
    }
    previousToolbarLoading.current = toolbarLoading;
  }, [toolbarLoading]);
  const autosaveTooltip = userReadOnly
    ? readOnlyLabel
    : saving
      ? "Автосохранение выполняется…"
      : dirty
        ? "Есть несохранённые изменения. Автосохранение запустится автоматически."
        : "Изменения сохранены автоматически.";

  return (
    <section className="editor-area">
      <div className="editor-toolbar">
        <div className="breadcrumbs">
          {breadcrumbs.map((part, index) => (
            <span key={`${part}-${index}`}>{index === breadcrumbs.length - 1 ? <strong>{part}</strong> : part}{index < breadcrumbs.length - 1 && <b> / </b>}</span>
          ))}
          {!activeFile && <span>Документ не выбран</span>}
        </div>
        <div className="editor-actions">
          {userReadOnly && <span className="spec-readonly-label">{readOnlyLabel}</span>}
          {!hideHeaderActions && (
            <>
              <div className="segmented">
                {viewModes.map((mode) => (
                  <button
                    key={mode}
                    className={effectiveViewMode === mode ? "active" : ""}
                    disabled={userReadOnly && mode !== "preview"}
                    onClick={() => onViewModeChange(mode)}
                  >
                    {mode === "edit" ? "Edit" : mode === "preview" ? "Preview" : "Split"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={`editor-content-shell ${contextPanel ? "with-context-panel" : ""}`}>
      <div className={`document-view ${effectiveViewMode} ${userReadOnly ? "user-readonly" : ""}`}>
        {!canEdit && (
          <div className={`document-state ${documentStatus === "error" || documentStatus === "unavailable" ? "error" : ""}`}>
            <p>
              {loadingDocument || documentStatus === "loading" ? "Загрузка документа…" :
                documentStatus === "empty" ? "В выбранном Store нет Markdown-документов." :
                  documentStatus === "idle" ? "Выберите или создайте проект." :
                    error?.message ?? "Документ недоступен"}
            </p>
            {(documentStatus === "error" || documentStatus === "unavailable") && <button type="button" onClick={onRetry}>Повторить</button>}
          </div>
        )}
        {canEdit && conflict && (
          <div className="document-alert conflict" role="alert">
            Файл изменён вне редактора. Ваш текст сохранён в этой вкладке.
            <button type="button" onClick={onRetry}>Загрузить актуальную версию</button>
          </div>
        )}
        {canEdit && error && !conflict && (
          <div className="document-alert error" role="alert">
            {error.message}
            {error.correlationId && <small>Correlation ID: {error.correlationId}</small>}
          </div>
        )}
        {canEdit && !userReadOnly && effectiveViewMode !== "preview" && (
          <RichMarkdownEditor
            key={`${activeFile}:${editorRevision}`}
            documentId={activeFile!}
            markdown={markdown}
            comments={comments}
            toolbarLoading={toolbarLoading}
            toolbarActions={toolbarActions}
            onAddComment={onAddComment ? (selection, comment) => onAddComment(activeFile!, selection, comment) : undefined}
            onUpdateComment={onUpdateComment ? (commentId, comment) => onUpdateComment(activeFile!, commentId, comment) : undefined}
            onDeleteComment={onDeleteComment ? (commentId) => onDeleteComment(activeFile!, commentId) : undefined}
            onChange={onChange}
            onBlur={onBlur}
          />
        )}
        {canEdit && effectiveViewMode !== "edit" && (
          <article className="preview-pane">
            <span className="eyebrow">ПРЕДПРОСМОТР</span>
            <MarkdownPreview documentId={activeFile!} markdown={markdown} />
          </article>
        )}
        {toolbarLoading && (
          <div className="document-operation-loading" role="status" aria-label="Agent выполняет операцию">
            <FlyingOperationBird />
          </div>
        )}
      </div>
      {contextPanel}
      </div>

      {history.open && activeFile && <DocumentHistoryPanel controller={history} path={activeFile} />}

      <footer className="editor-statusbar" title={autosaveTooltip} aria-label={autosaveTooltip}>
        {(userReadOnly || saving || dirty) && (
          <span className="draft-label"><i /> {userReadOnly ? readOnlyLabel : saving ? "Запись…" : "Есть изменения"}</span>
        )}
        <span>Markdown</span>
        <span>Строк: {lines.length}</span>
        <span>Слов: {wordCount}</span>
        <span className="spacer" />
        <span>UTF-8</span><span>LF</span>
        <span className="scope-safe">◈ Scope: Store only</span>
      </footer>
    </section>
  );
}
