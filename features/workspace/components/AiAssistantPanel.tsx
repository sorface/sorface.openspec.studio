import type { KeyboardEvent } from "react";
import { IconButton } from "@/components/ui/IconButton";
import type { AssistantMode } from "@/features/workspace/model/workspace-types";

interface AiAssistantPanelProps {
  assistantMode: AssistantMode;
  messages: string[];
  prompt: string;
  onClose: () => void;
  onModeChange: (mode: AssistantMode) => void;
  onPromptChange: (prompt: string) => void;
  onSend: () => void;
}

export function AiAssistantPanel(props: AiAssistantPanelProps) {
  const { assistantMode, messages, prompt, onClose, onModeChange, onPromptChange, onSend } = props;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <aside className="assistant-panel">
      <div className="assistant-tabs">
        <button className={assistantMode === "assistant" ? "active" : ""} onClick={() => onModeChange("assistant")}>AI-ассистент</button>
        <button className={assistantMode === "context" ? "active" : ""} onClick={() => onModeChange("context")}>Контекст <b>4</b></button>
        <IconButton label="Свернуть AI-панель" onClick={onClose}>›</IconButton>
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
              <button onClick={() => onPromptChange("Сделай требования более проверяемыми")}><span>✎</span><b>Улучшить выделение</b><small>Переписать яснее и точнее</small></button>
              <button onClick={() => onPromptChange("Добавь граничные сценарии")}><span>＋</span><b>Дополнить документ</b><small>Добавить раздел по инструкции</small></button>
              <button onClick={() => onPromptChange("Проверь change перед validate")}><span>✓</span><b>Проверить change</b><small>Найти пробелы и противоречия</small></button>
            </div>
            {messages.map((message, index) => (
              <div key={`${message}-${index}`} className={index % 2 === 0 ? "chat-message user" : "chat-message ai"}>{message}</div>
            ))}
          </div>
          <div className="prompt-box">
            <textarea aria-label="Инструкция для AI" placeholder="Опишите, что нужно изменить..." value={prompt} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={handleKeyDown} />
            <div className="prompt-tools">
              <button title="Добавить контекст">⌕ <span>Контекст</span></button>
              <button title="Прикрепить файл">⌁</button>
              <button className="send" onClick={onSend} disabled={!prompt.trim()}>↑</button>
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
  );
}
