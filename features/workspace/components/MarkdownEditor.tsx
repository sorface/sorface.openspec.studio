import type { ChangeEvent } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { files } from "@/features/workspace/model/workspace-data";
import type { ViewMode } from "@/features/workspace/model/workspace-types";

interface MarkdownEditorProps {
  activeFile: string;
  lines: string[];
  markdown: string;
  viewMode: ViewMode;
  onBlur: () => void;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onWrite: () => void;
}

const viewModes: ViewMode[] = ["edit", "preview", "split"];

export function MarkdownEditor(props: MarkdownEditorProps) {
  const { activeFile, lines, markdown, viewMode, onBlur, onChange, onViewModeChange, onWrite } = props;

  return (
    <section className="editor-area">
      <div className="editor-toolbar">
        <div className="breadcrumbs"><span>changes</span><b>/</b><span>add-sso-auth</span><b>/</b><strong>{files.find((file) => file.id === activeFile)?.name}</strong></div>
        <div className="editor-actions">
          <div className="segmented">
            {viewModes.map((mode) => (
              <button key={mode} className={viewMode === mode ? "active" : ""} onClick={() => onViewModeChange(mode)}>
                {mode === "edit" ? "Edit" : mode === "preview" ? "Preview" : "Split"}
              </button>
            ))}
          </div>
          <IconButton label="История файла">◴</IconButton>
          <IconButton label="Ещё">•••</IconButton>
          <button className="save-button" onClick={onWrite}>Записать в файл <span>⌘S</span></button>
        </div>
      </div>

      <div className={`document-view ${viewMode}`}>
        {viewMode !== "preview" && (
          <div className="code-editor">
            <div className="line-numbers">{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
            <textarea aria-label="Markdown редактор" value={markdown} onChange={onChange} onBlur={onBlur} spellCheck={false} />
          </div>
        )}
        {viewMode !== "edit" && (
          <article className="preview-pane">
            <span className="eyebrow">ПРЕДПРОСМОТР</span>
            <h1>Добавить SSO-аутентификацию</h1>
            <h2>Зачем</h2>
            <p>Сейчас пользователи входят по локальному логину и паролю. Корпоративным клиентам нужен единый вход через существующий identity provider.</p>
            <h2>Что изменится</h2>
            <ul><li>Добавить вход через OIDC-провайдера</li><li>Связывать корпоративную учётную запись с локальным профилем</li><li>Сохранять текущий способ входа</li></ul>
            <h2>Влияние</h2>
            <p><code>/auth/sso/*</code> · внешние identity · PKCE</p>
          </article>
        )}
      </div>

      <footer className="editor-statusbar">
        <span className="draft-label"><i /> Черновик</span>
        <span>Markdown</span>
        <span>Строк: {lines.length}</span>
        <span>Слов: {markdown.trim().split(/\s+/).length}</span>
        <span className="spacer" />
        <button>UTF-8</button><button>LF</button>
        <span className="scope-safe">◈ Scope: Store only</span>
      </footer>
    </section>
  );
}
