import type { ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";
import type { ApiError } from "@/features/api/api-client";
import { DocumentHistoryPanel } from "@/features/documents/components/DocumentHistoryPanel";
import type { DocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import { MarkdownPreview } from "@/features/editor/components/MarkdownPreview";
import { RichMarkdownEditor } from "@/features/editor/components/RichMarkdownEditor";
import type { AgentEditResult, AgentEditSelection } from "@/features/editor/model/agent-edit";
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
  saveShortcutLabel: string;
  viewMode: ViewMode;
  userReadOnly?: boolean;
  hideHeaderActions?: boolean;
  readOnlyLabel?: string;
  agentAvailable: boolean;
  agentPending: boolean;
  toolbarActions?: ReactNode;
  contextPanel?: ReactNode;
  onBlur: () => void;
  onAgentEdit: (path: string, selection: AgentEditSelection, instruction: string) => Promise<AgentEditResult>;
  onChange: (markdown: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onWrite: () => void;
  onRetry: () => void;
}

const viewModes: ViewMode[] = ["edit", "preview", "split"];

export function MarkdownEditor(props: MarkdownEditorProps) {
  const {
    activeFile, lines, markdown, documentStatus, loadingDocument, saving, dirty, conflict,
    error, history, saveShortcutLabel, viewMode, userReadOnly = false, hideHeaderActions = false,
    readOnlyLabel = "Только просмотр", agentAvailable, agentPending,
    toolbarActions, contextPanel, onBlur, onAgentEdit, onChange, onViewModeChange, onWrite, onRetry,
  } = props;
  const breadcrumbs = activeFile?.split("/") ?? [];
  const canEdit = documentStatus === "ready" && !!activeFile && !loadingDocument;
  const effectiveViewMode: ViewMode = userReadOnly ? "preview" : viewMode;
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;

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
              <IconButton
                label="Git-аннотации файла"
                disabled={!canEdit}
                onClick={history.show}
                title={canEdit ? "Показать Git-аннотации и историю файла" : "Сначала выберите Markdown-файл"}
              >◴</IconButton>
              <IconButton label="Ещё" disabled title="Дополнительные действия пока недоступны">•••</IconButton>
              <button className="save-button" onClick={onWrite} disabled={userReadOnly || !canEdit || !dirty || saving}>
                {userReadOnly ? "Только просмотр" : saving ? "Запись…" : "Записать в файл"} {!userReadOnly && <span>{saveShortcutLabel}</span>}
              </button>
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
            documentId={activeFile!}
            markdown={markdown}
            agentAvailable={agentAvailable}
            agentPending={agentPending}
            toolbarActions={toolbarActions}
            onAgentEdit={(selection, instruction) => onAgentEdit(activeFile!, selection, instruction)}
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
      </div>
      {contextPanel}
      </div>

      {history.open && activeFile && <DocumentHistoryPanel controller={history} path={activeFile} />}

      <footer className="editor-statusbar">
        <span className="draft-label"><i /> {userReadOnly ? readOnlyLabel : saving ? "Запись…" : dirty ? "Есть изменения" : "Файл сохранён"}</span>
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
