import type { KeyboardEvent } from "react";
import { IconButton } from "@/components/ui/IconButton";
import type { AssistantMode } from "@/features/workspace/model/workspace-types";
import type { AiOperationsController } from "@/features/ai-operations/hooks/useAiOperationsController";

interface AiAssistantPanelProps {
  assistantMode: AssistantMode;
  messages: string[];
  prompt: string;
  onClose: () => void;
  onModeChange: (mode: AssistantMode) => void;
  onPromptChange: (prompt: string) => void;
  onSend: () => void;
  ai: AiOperationsController;
  providerAvailable: boolean;
}

export function AiAssistantPanel(props: AiAssistantPanelProps) {
  const { assistantMode, messages, prompt, onClose, onModeChange, onPromptChange, onSend, ai, providerAvailable } = props;
  const running = ai.operation && ["queued", "running", "validating"].includes(ai.operation.status);

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
            {!providerAvailable && <div className="ai-provider-notice">Выберите доступный agent CLI в верхней панели, чтобы запустить AI.</div>}
            <div className="quick-actions">
              <button onClick={() => onPromptChange("Сделай требования более проверяемыми")}><span>✎</span><b>Улучшить выделение</b><small>Переписать яснее и точнее</small></button>
              <button onClick={() => onPromptChange("Добавь граничные сценарии")}><span>＋</span><b>Дополнить документ</b><small>Добавить раздел по инструкции</small></button>
              <button onClick={() => onPromptChange("Проверь change перед validate")}><span>✓</span><b>Проверить change</b><small>Найти пробелы и противоречия</small></button>
            </div>
            {messages.map((message, index) => (
              <div key={`${message}-${index}`} className={index % 2 === 0 ? "chat-message user" : "chat-message ai"}>{message}</div>
            ))}
            {running && <div className="ai-operation-status">{ai.operation?.status === "validating" ? "Проверка результата…" : "Agent CLI выполняет задачу…"} <button onClick={() => void ai.cancel()}>Отменить</button></div>}
            {ai.error && <div className="form-error" role="alert">{ai.error.message}{ai.error.correlationId && <small>Correlation ID: {ai.error.correlationId}</small>}</div>}
            {ai.result && (
              <div className="ai-result">
                <span className="eyebrow">AWAITING REVIEW</span>
                <p>{ai.result.finalResponse}</p>
                {ai.result.files.map((file) => <details key={file.path}><summary>{file.path}</summary><pre>{file.after}</pre></details>)}
              </div>
            )}
          </div>
          <div className="prompt-box">
            <textarea aria-label="Инструкция для AI" placeholder="Опишите, что нужно изменить..." value={prompt} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={handleKeyDown} />
            <div className="prompt-tools">
              <button type="button" disabled title="Используйте вкладку «Контекст» для review">⌕ <span>Контекст</span></button>
              <button type="button" disabled title="Прикрепление файлов пока недоступно">⌁</button>
              <button className="send" onClick={onSend} disabled={!prompt.trim() || !ai.manifest || !!running || !providerAvailable}>↑</button>
            </div>
            <small><i /> AI может изменять только OpenSpec Store</small>
          </div>
        </>
      ) : (
        <div className="context-panel">
          <span className="eyebrow">В ЗАПРОСЕ</span>
          <h3>{ai.manifest ? `${ai.manifest.entries.filter((entry) => entry.included).length} включено · ${ai.manifest.entries.filter((entry) => !entry.included).length} исключено` : "Контекст не проверен"}</h3>
          <p>Backend проверит пути, секреты, размер и контрольные суммы до запуска AI.</p>
          {ai.manifest?.entries.map((entry, index) => (
            <div className={`context-file ${entry.included ? "" : "excluded"}`} key={`${entry.source}:${entry.path}`}><span>{index ? "◇" : "◆"}</span><b>{entry.path}</b><small>{entry.reason}</small></div>
          ))}
          {ai.manifest && <p className="context-limits">До {ai.manifest.limits.maxFiles} файлов · {Math.round(ai.manifest.limits.maxTotalBytes / 1024 / 1024)} MiB</p>}
          <button className="add-context" disabled={ai.pending} onClick={() => void ai.reviewContext()}>{ai.pending ? "Проверка…" : "✓ Проверить контекст"}</button>
        </div>
      )}
    </aside>
  );
}
