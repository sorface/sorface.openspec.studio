"use client";

import { useMemo, useState } from "react";

type ViewMode = "edit" | "preview" | "split";

const files = [
  { id: "proposal", name: "proposal.md", icon: "◇", indent: 2 },
  { id: "design", name: "design.md", icon: "◇", indent: 2 },
  { id: "tasks", name: "tasks.md", icon: "◇", indent: 2 },
];

const initialMarkdown = `# Добавить SSO-аутентификацию

## Зачем

Сейчас пользователи входят по локальному логину и паролю. Корпоративным клиентам нужен единый вход через существующий identity provider.

## Что изменится

- Добавить вход через OIDC-провайдера
- Связывать корпоративную учётную запись с локальным профилем
- Сохранять текущий способ входа для существующих пользователей

## Возможности

### Новые возможности

- \`sso-authentication\`: вход через корпоративный OIDC
- \`account-linking\`: безопасная привязка учётных записей

## Влияние

- API: новые endpoints \`/auth/sso/*\`
- Данные: таблица внешних identity
- Безопасность: проверка state, nonce и PKCE
`;

function Logo() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button className="icon-button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

export default function Home() {
  const [activeFile, setActiveFile] = useState("proposal");
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [draftSaved, setDraftSaved] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [assistantMode, setAssistantMode] = useState<"assistant" | "context">("assistant");
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
      <header className="topbar">
        <div className="brand">
          <Logo />
          <strong>OpenSpec</strong>
          <span>Studio</span>
        </div>

        <button className="project-switcher">
          <span className="project-avatar">P</span>
          <span>
            <small>ПРОЕКТ</small>
            <b>Platform specifications</b>
          </span>
          <em>⌄</em>
        </button>

        <div className="workspace-status">
          <span className="branch-chip"><i /> main</span>
          <span className="divider" />
          <span className="store-id">Store <b>platform-core</b></span>
          <span className="sync-status">↻</span>
          <span className="saved-state"><i /> {draftSaved ? "Черновик сохранён" : "Есть изменения"}</span>
        </div>

        <div className="top-actions">
          <button className="provider-button"><span className="provider-icon">✣</span> Codex <small>GPT-5</small>⌄</button>
          <IconButton label="Уведомления">♧</IconButton>
          <IconButton label="Настройки">⚙</IconButton>
          <button className="user-avatar">PT</button>
        </div>
      </header>

      <section className={`workspace ${leftOpen ? "" : "left-collapsed"} ${rightOpen ? "" : "right-collapsed"}`}>
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>ОБЗОР</span>
            <IconButton label="Свернуть панель" onClick={() => setLeftOpen(false)}>‹</IconButton>
          </div>
          <button className="nav-item"><span>⌂</span> Рабочее пространство</button>
          <button className="nav-item"><span>▱</span> Репозитории <small>3</small></button>
          <button className="nav-item"><span>⌁</span> Git <b>4</b></button>

          <div className="sidebar-heading files-heading">
            <span>OPENSpec</span>
            <div><IconButton label="Новый файл">＋</IconButton><IconButton label="Обновить">↻</IconButton></div>
          </div>
          <div className="tree">
            <button className="tree-row root"><span>⌄</span><b>⌑</b> specs <small>12</small></button>
            <button className="tree-row root"><span>⌄</span><b>◇</b> changes <small>3</small></button>
            <button className="tree-row change"><span>⌄</span><i className="change-dot" /> add-sso-auth <em>2/3</em></button>
            {files.map((file) => (
              <button
                key={file.id}
                className={`tree-row file ${activeFile === file.id ? "active" : ""}`}
                onClick={() => setActiveFile(file.id)}
              >
                <span>{file.icon}</span>{file.name}{file.id === "proposal" && <i className="draft-dot" />}
              </button>
            ))}
            <button className="tree-row change collapsed"><span>›</span><i className="change-dot amber" /> improve-audit-log <em>1/4</em></button>
            <button className="tree-row change collapsed"><span>›</span><i className="change-dot blue" /> billing-webhooks <em>3/3</em></button>
            <button className="tree-row root archive"><span>›</span><b>□</b> archive <small>18</small></button>
          </div>

          <div className="repo-summary">
            <div className="sidebar-heading"><span>КОНТЕКСТ</span><button>Управлять</button></div>
            <div className="repo-row"><i className="repo-icon">◆</i><span><b>platform-api</b><small>main · чисто</small></span><em /></div>
            <div className="repo-row"><i className="repo-icon">◆</i><span><b>platform-web</b><small>feature/sso · чисто</small></span><em /></div>
          </div>
        </aside>

        {!leftOpen && <button className="open-panel left" onClick={() => setLeftOpen(true)}>›</button>}

        <section className="editor-area">
          <div className="editor-toolbar">
            <div className="breadcrumbs"><span>changes</span><b>/</b><span>add-sso-auth</span><b>/</b><strong>{files.find((f) => f.id === activeFile)?.name}</strong></div>
            <div className="editor-actions">
              <div className="segmented">
                {(["edit", "preview", "split"] as ViewMode[]).map((mode) => (
                  <button key={mode} className={viewMode === mode ? "active" : ""} onClick={() => setViewMode(mode)}>
                    {mode === "edit" ? "Edit" : mode === "preview" ? "Preview" : "Split"}
                  </button>
                ))}
              </div>
              <IconButton label="История файла">◴</IconButton>
              <IconButton label="Ещё">•••</IconButton>
              <button className="save-button" onClick={writeFile}>Записать в файл <span>⌘S</span></button>
            </div>
          </div>

          <div className={`document-view ${viewMode}`}>
            {viewMode !== "preview" && (
              <div className="code-editor">
                <div className="line-numbers">{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
                <textarea
                  aria-label="Markdown редактор"
                  value={markdown}
                  onChange={(event) => {
                    setMarkdown(event.target.value);
                    setDraftSaved(false);
                  }}
                  onBlur={saveDraft}
                  spellCheck={false}
                />
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
            <button>UTF-8</button>
            <button>LF</button>
            <span className="scope-safe">◈ Scope: Store only</span>
          </footer>
        </section>

        <aside className="assistant-panel">
          <div className="assistant-tabs">
            <button className={assistantMode === "assistant" ? "active" : ""} onClick={() => setAssistantMode("assistant")}>AI-ассистент</button>
            <button className={assistantMode === "context" ? "active" : ""} onClick={() => setAssistantMode("context")}>Контекст <b>4</b></button>
            <IconButton label="Свернуть AI-панель" onClick={() => setRightOpen(false)}>›</IconButton>
          </div>

          {assistantMode === "assistant" ? (
            <>
              <div className="assistant-content">
                <div className="ai-welcome">
                  <span className="spark">✦</span>
                  <h2>Чем помочь со спецификацией?</h2>
                  <p>Я работаю только с активным Store. Вы увидите diff до применения любых изменений.</p>
                </div>
                <div className="quick-actions">
                  <button onClick={() => setPrompt("Сделай требования более проверяемыми")}><span>✎</span><b>Улучшить выделение</b><small>Переписать яснее и точнее</small></button>
                  <button onClick={() => setPrompt("Добавь граничные сценарии")}><span>＋</span><b>Дополнить документ</b><small>Добавить раздел по инструкции</small></button>
                  <button onClick={() => setPrompt("Проверь change перед validate")}><span>✓</span><b>Проверить change</b><small>Найти пробелы и противоречия</small></button>
                </div>
                {messages.map((message, index) => (
                  <div key={`${message}-${index}`} className={index % 2 === 0 ? "chat-message user" : "chat-message ai"}>{message}</div>
                ))}
              </div>
              <div className="prompt-box">
                <textarea
                  aria-label="Инструкция для AI"
                  placeholder="Опишите, что нужно изменить..."
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendPrompt();
                    }
                  }}
                />
                <div className="prompt-tools">
                  <button title="Добавить контекст">⌕ <span>Контекст</span></button>
                  <button title="Прикрепить файл">⌁</button>
                  <button className="send" onClick={sendPrompt} disabled={!prompt.trim()}>↑</button>
                </div>
                <small><i /> AI может изменять только OpenSpec Store</small>
              </div>
            </>
          ) : (
            <div className="context-panel">
              <span className="eyebrow">В ЗАПРОСЕ</span>
              <h3>4 файла · 18,6 KB</h3>
              <p>Проверьте итоговый набор до запуска AI.</p>
              {["proposal.md", "LoginService.ts", "oidc.config.ts", "auth.spec.ts"].map((name, index) => (
                <div className="context-file" key={name}><span>{index ? "◇" : "◆"}</span><b>{name}</b><button>×</button></div>
              ))}
              <button className="add-context">＋ Добавить файл</button>
            </div>
          )}
        </aside>

        {!rightOpen && <button className="open-panel right" onClick={() => setRightOpen(true)}>‹</button>}
      </section>

      <nav className="bottom-bar">
        <button className="active"><span>⌁</span><b>Git</b><em>4</em></button>
        <button><span>◇</span><b>OpenSpec</b></button>
        <button><span>◴</span><b>Операции</b><em className="running">1</em></button>
        <div className="bottom-spacer" />
        <span className="validation"><i /> Последняя проверка: успешно · 2 мин назад</span>
        <button className="commit-button" onClick={() => notify("Откройте Git-панель для commit")}>Commit & Push</button>
      </nav>

      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
