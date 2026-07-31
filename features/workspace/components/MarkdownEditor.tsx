import { useState, type FormEvent } from "react";
import { IconButton } from "@/components/ui/IconButton";
import type { ApiError } from "@/features/api/api-client";
import { DocumentHistoryPanel } from "@/features/documents/components/DocumentHistoryPanel";
import type { DocumentHistoryController } from "@/features/documents/hooks/useDocumentHistoryController";
import { MarkdownPreview } from "@/features/editor/components/MarkdownPreview";
import { RichMarkdownEditor } from "@/features/editor/components/RichMarkdownEditor";
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
  agentAvailable: boolean;
  agentPending: boolean;
  onBlur: () => void;
  onAgentEdit: (path: string, selection: string, instruction: string) => Promise<void>;
  onChange: (markdown: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onWrite: () => void;
  onRetry: () => void;
}

const viewModes: ViewMode[] = ["edit", "preview", "split"];

export function MarkdownEditor(props: MarkdownEditorProps) {
  const {
    activeFile, lines, markdown, documentStatus, loadingDocument, saving, dirty, conflict,
    error, history, saveShortcutLabel, viewMode, agentAvailable, agentPending,
    onBlur, onAgentEdit, onChange, onViewModeChange, onWrite, onRetry,
  } = props;
  const [agentSelection, setAgentSelection] = useState<string | null>(null);
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentError, setAgentError] = useState("");
  const breadcrumbs = activeFile?.split("/") ?? [];
  const canEdit = documentStatus === "ready" && !!activeFile && !loadingDocument;
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;

  const closeAgentDialog = () => {
    if (agentPending) return;
    setAgentSelection(null);
    setAgentInstruction("");
    setAgentError("");
  };

  const submitAgentEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeFile || !agentSelection || !agentInstruction.trim()) return;
    setAgentError("");
    try {
      await onAgentEdit(activeFile, agentSelection, agentInstruction.trim());
      closeAgentDialog();
    } catch (cause) {
      setAgentError(cause instanceof Error ? cause.message : "Не удалось запустить agent");
    }
  };

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
          <div className="segmented">
            {viewModes.map((mode) => (
              <button key={mode} className={viewMode === mode ? "active" : ""} onClick={() => onViewModeChange(mode)}>
                {mode === "edit" ? "Edit" : mode === "preview" ? "Preview" : "Split"}
              </button>
            ))}
          </div>
          <IconButton
            label="История файла"
            disabled={!canEdit}
            onClick={history.show}
            title={canEdit ? "Показать Git-историю файла" : "Сначала выберите Markdown-файл"}
          >◴</IconButton>
          <IconButton label="Ещё" disabled title="Дополнительные действия пока недоступны">•••</IconButton>
          <button className="save-button" onClick={onWrite} disabled={!canEdit || !dirty || saving}>
            {saving ? "Запись…" : "Записать в файл"} <span>{saveShortcutLabel}</span>
          </button>
        </div>
      </div>

      <div className={`document-view ${viewMode}`}>
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
        {canEdit && viewMode !== "preview" && (
          <RichMarkdownEditor
            documentId={activeFile!}
            markdown={markdown}
            onAskAgent={(selection) => {
              setAgentSelection(selection);
              setAgentInstruction("");
              setAgentError("");
            }}
            onChange={onChange}
            onBlur={onBlur}
          />
        )}
        {canEdit && viewMode !== "edit" && (
          <article className="preview-pane">
            <span className="eyebrow">ПРЕДПРОСМОТР</span>
            <MarkdownPreview documentId={activeFile!} markdown={markdown} />
          </article>
        )}
      </div>

      {history.open && activeFile && <DocumentHistoryPanel controller={history} path={activeFile} />}

      {agentSelection !== null && activeFile && (
        <div className="openspec-create-backdrop" role="presentation">
          <form
            className="openspec-create-dialog agent-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-edit-title"
            onSubmit={submitAgentEdit}
          >
            <header>
              <div>
                <small>AGENT · OPENSPEC CHANGE</small>
                <h3 id="agent-edit-title">Редактировать изменение</h3>
              </div>
              <button type="button" aria-label="Закрыть запрос к agent" onClick={closeAgentDialog} disabled={agentPending}>×</button>
            </header>
            <div className="openspec-create-content">
              <div className="agent-edit-file"><small>АКТИВНЫЙ ФАЙЛ</small><code>{activeFile}</code></div>
              <div className="agent-edit-selection"><small>ВЫДЕЛЕННЫЙ ФРАГМЕНТ</small><p>{agentSelection}</p></div>
              <label>
                Как изменить документ?
                <textarea
                  autoFocus
                  aria-label="Как изменить документ?"
                  placeholder="Например: уточни риски, добавь альтернативу и сделай формулировки проверяемыми…"
                  value={agentInstruction}
                  onChange={(event) => setAgentInstruction(event.target.value)}
                  disabled={agentPending}
                />
                <small>Agent изменит только соответствующий артефакт change. Перед записью вы увидите полный diff.</small>
              </label>
              {!agentAvailable && <div className="openspec-create-agent-warning">Сначала выберите доступный agent CLI в верхней панели.</div>}
              {agentError && <div className="openspec-create-error" role="alert">{agentError}</div>}
            </div>
            <footer>
              <button type="button" onClick={closeAgentDialog} disabled={agentPending}>Отмена</button>
              <button className="primary-submit" type="submit" disabled={!agentAvailable || agentPending || !agentInstruction.trim()}>
                {agentPending ? "Запускаем agent…" : "Подготовить изменения"}
              </button>
            </footer>
          </form>
        </div>
      )}

      <footer className="editor-statusbar">
        <span className="draft-label"><i /> {saving ? "Запись…" : dirty ? "Есть изменения" : "Файл сохранён"}</span>
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
