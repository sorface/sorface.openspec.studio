"use client";

import { useEffect, useMemo, useRef } from "react";
import { MarkdownPreview } from "@/features/editor/components/MarkdownPreview";
import { RichMarkdownEditor } from "@/features/editor/components/RichMarkdownEditor";
import type { ChangeCreationController } from "@/features/openspec-workflow/hooks/useChangeCreationController";
import type { OpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";
import type { OpenSpecExplorationQuestion } from "@/features/openspec-workflow/model/openspec-types";

interface ChangeCreationWizardProps {
  agentAvailable: boolean;
  creation: ChangeCreationController;
  workflow: OpenSpecWorkflowController;
  onClose: () => void;
  onCreated: (proposalPath: string) => void;
}

const steps = [
  { id: "intent", label: "Замысел" },
  { id: "clarifying", label: "Уточнение" },
  { id: "proposal", label: "Proposal" },
  { id: "naming", label: "Название" },
] as const;

function stepIndex(stage: ChangeCreationController["draft"]["stage"]): number {
  if (stage === "clarifying") return 1;
  if (stage === "proposal") return 2;
  if (stage === "naming" || stage === "creating") return 3;
  return 0;
}

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${Math.max(0, totalSeconds % 60).toString().padStart(2, "0")}`;
}

function QuestionCard({
  question,
  values,
  onChange,
}: {
  question: OpenSpecExplorationQuestion;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  if (question.kind === "text") {
    return (
      <article className="creation-question-card">
        <b>{question.prompt}</b>
        {question.why && <p>{question.why}</p>}
        <textarea
          aria-label={`Ответ: ${question.prompt}`}
          value={values[0] ?? ""}
          onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
          placeholder="Введите ответ…"
        />
      </article>
    );
  }
  return (
    <article className="creation-question-card">
      <b>{question.prompt}</b>
      {question.why && <p>{question.why}</p>}
      <div className="creation-question-options">
        {(question.options ?? []).map((option) => {
          const checked = values.includes(option);
          return (
            <label key={option}>
              <input
                type={question.kind === "single_choice" ? "radio" : "checkbox"}
                name={question.id}
                checked={checked}
                onChange={() => {
                  if (question.kind === "single_choice") onChange([option]);
                  else onChange(checked ? values.filter((value) => value !== option) : [...values, option]);
                }}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </article>
  );
}

export function ChangeCreationWizard({
  agentAvailable,
  creation,
  workflow,
  onClose,
  onCreated,
}: ChangeCreationWizardProps) {
  const appliedExploreOperation = useRef("");
  const activeOperation = !!workflow.operation && ["queued", "running", "validating"].includes(workflow.operation.status);
  const currentStep = stepIndex(creation.draft.stage);
  const creationReview = workflow.operation?.openspecAction === "create_change" && workflow.result;
  const createFailed = workflow.operation?.openspecAction === "create_change" && workflow.operation.status === "failed";
  const exploreFailed = workflow.operation?.openspecAction === "explore" && workflow.operation.status === "failed";
  const allRequiredAnswersPresent = creation.draft.questions.every((question) => (
    (creation.draft.answers[question.id]?.length ?? 0) > 0
  ));

  useEffect(() => {
    const operation = workflow.operation;
    const exploration = workflow.result?.exploration;
    if (!operation || operation.openspecAction !== "explore" || operation.status !== "awaiting_review" ||
      !exploration || appliedExploreOperation.current === operation.id) return;
    appliedExploreOperation.current = operation.id;
    creation.applyExploration(exploration);
  }, [creation, workflow.operation, workflow.result]);

  useEffect(() => {
    if (activeOperation) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeOperation, onClose]);

  const runExplore = async (withAssumptions = false) => {
    if (!creation.draft.intent.trim() || !agentAvailable || activeOperation) return;
    creation.markClarifying();
    await workflow.explore(creation.handoff(withAssumptions));
  };

  const prepareChange = async () => {
    const name = creation.draft.changeName ?? "";
    if (!creation.nameValid || !creation.draft.proposal?.trim()) return;
    workflow.resetOperation();
    creation.markCreating();
    await workflow.createChange(name, creation.draft.proposal);
  };

  const writeCreatedChange = async () => {
    const name = creation.draft.changeName ?? "";
    if (!await workflow.write()) return;
    await creation.complete();
    onClose();
    onCreated(`openspec/changes/${name}/proposal.md`);
  };

  const leftDocumentId = creation.draft.stage === "proposal" ? "change-creation-proposal" : "change-creation-intent";
  const leftMarkdown = creation.draft.stage === "proposal" ? creation.draft.proposal ?? "" : creation.draft.intent;
  const leftChange = creation.draft.stage === "proposal" ? creation.setProposal : creation.setIntent;
  const title = useMemo(() => {
    if (creation.draft.stage === "clarifying") return "Уточняем намерение";
    if (creation.draft.stage === "proposal") return "Проверяем proposal";
    if (creation.draft.stage === "naming" || creation.draft.stage === "creating") return "Создаём change";
    return "Опишите замысел";
  }, [creation.draft.stage]);

  return (
    <section className="openspec-panel change-creation-page" aria-labelledby="change-creation-title">
        <header className="change-creation-header">
          <div className="change-creation-heading">
            <button
              type="button"
              className="creation-back"
              aria-label="Вернуться к списку изменений"
              disabled={activeOperation}
              onClick={onClose}
            >←</button>
            <div>
              <small>НОВОЕ ИЗМЕНЕНИЕ</small>
              <h2 id="change-creation-title">{title}</h2>
            </div>
          </div>
          <div className="change-creation-header-actions">
            <span className="creation-save-status">{creation.saving ? "Сохраняем draft…" : "Draft сохранён"}</span>
            <button
              type="button"
              className="creation-reset"
              disabled={activeOperation}
              onClick={() => {
                if (window.confirm("Начать заново? Незавершённый draft будет удалён.")) void creation.reset();
              }}
            >Начать заново</button>
          </div>
        </header>

        <nav className="change-creation-stepper" aria-label="Этапы создания change">
          {steps.map((step, index) => (
            <span key={step.id} className={index === currentStep ? "active" : index < currentStep ? "done" : ""}>
              <i>{index < currentStep ? "✓" : index + 1}</i>{step.label}
            </span>
          ))}
        </nav>

        {creation.loading ? <div className="change-creation-loading">Восстанавливаем draft…</div> : (
          <div className="change-creation-grid">
            <section className="change-creation-document">
              <header>
                <div><small>{creation.draft.stage === "proposal" || currentStep >= 3 ? "OPENSPEC ARTIFACT" : "ВАШ ЗАМЫСЕЛ"}</small><b>{currentStep >= 3 ? "proposal.md" : `${leftDocumentId}.md`}</b></div>
                <span>Markdown</span>
              </header>
              {currentStep >= 3 ? (
                <article className="creation-proposal-preview">
                  <MarkdownPreview documentId="accepted-change-proposal" markdown={creation.draft.proposal ?? ""} />
                </article>
              ) : (
                <RichMarkdownEditor
                  key={leftDocumentId}
                  documentId={leftDocumentId}
                  markdown={leftMarkdown}
                  agentAvailable={false}
                  agentPending={activeOperation}
                  onBlur={() => undefined}
                  onChange={leftChange}
                  onAgentEdit={async () => ({ markdown: leftMarkdown, replacement: "" })}
                />
              )}
              <footer>
                <span>{leftMarkdown.trim().split(/\s+/).filter(Boolean).length} слов</span>
                <span>Store не изменяется</span>
              </footer>
            </section>

            <aside className="change-creation-assistant" aria-live="polite">
              {creation.draft.stage === "intent" && (
                <div className="creation-onboarding">
                  <span className="creation-ai-mark">✦</span>
                  <small>AI-АНАЛИТИК</small>
                  <h3>Сформулируйте намерение свободно</h3>
                  <p>Опишите проблему, ожидаемое поведение и ограничения. Markdown останется вашим рабочим draft.</p>
                  <ul>
                    <li>Проверю существующие capabilities и baseline specs</li>
                    <li>Задам только вопросы, влияющие на scope</li>
                    <li>Подготовлю proposal до создания файлов</li>
                  </ul>
                  {!agentAvailable && <div className="creation-warning">Выберите доступный Agent CLI в верхней панели.</div>}
                </div>
              )}

              {creation.draft.stage === "clarifying" && activeOperation && (
                <div className="creation-running">
                  <span className="operation-spinner" />
                  <small>READ-ONLY ИССЛЕДОВАНИЕ</small>
                  <h3>{workflow.operationProgress || "Изучаем замысел…"}</h3>
                  <p>Прошло {formatElapsedTime(workflow.operationElapsedSeconds)}. Store остаётся без изменений.</p>
                  <ol>{workflow.operationActivity.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ol>
                  <button type="button" onClick={() => void workflow.cancel()}>Остановить</button>
                </div>
              )}

              {creation.draft.stage === "clarifying" && !activeOperation && creation.draft.questions.length > 0 && (
                <div className="creation-questions">
                  <small>НУЖНО УТОЧНЕНИЕ</small>
                  <h3>Ответьте на важные вопросы</h3>
                  {creation.draft.summary && <p className="creation-summary">{creation.draft.summary}</p>}
                  {creation.draft.questions.map((question) => (
                    <QuestionCard
                      key={question.id}
                      question={question}
                      values={creation.draft.answers[question.id] ?? []}
                      onChange={(values) => creation.setAnswer(question.id, values)}
                    />
                  ))}
                  <div className="creation-inline-actions">
                    <button type="button" onClick={() => void runExplore(true)}>Продолжить с допущениями</button>
                    <button type="button" className="primary-submit" disabled={!allRequiredAnswersPresent} onClick={() => void runExplore()}>
                      ✦ Ответить и продолжить
                    </button>
                  </div>
                </div>
              )}

              {creation.draft.stage === "clarifying" && !activeOperation &&
                creation.draft.questions.length === 0 && exploreFailed && (
                <div className="creation-recovery" role="alert">
                  <small>ИССЛЕДОВАНИЕ НЕ ЗАВЕРШЕНО</small>
                  <h3>Замысел и draft сохранены</h3>
                  <p>{workflow.operation?.errorMessage || "Agent не вернул структурированный результат."}</p>
                  <button type="button" className="primary-submit" onClick={() => void runExplore()}>
                    ✦ Повторить анализ
                  </button>
                </div>
              )}

              {creation.draft.stage === "proposal" && (
                <div className="creation-proposal-meta">
                  <small>PROPOSAL ГОТОВ</small>
                  <h3>Проверьте смысл изменения</h3>
                  <p className="creation-summary">{creation.draft.summary}</p>
                  {!!creation.draft.assumptions.length && (
                    <section><b>Допущения</b><ul>{creation.draft.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section>
                  )}
                  <label>
                    <span>Что нужно скорректировать?</span>
                    <textarea value={creation.draft.feedback ?? ""} onChange={(event) => creation.setFeedback(event.target.value)} placeholder="Необязательное замечание для следующей AI-итерации…" />
                  </label>
                  <div className="creation-inline-actions">
                    <button type="button" disabled={!creation.draft.feedback?.trim()} onClick={() => void runExplore()}>✦ Уточнить proposal</button>
                    <button type="button" className="primary-submit" onClick={creation.acceptProposal}>Принять proposal</button>
                  </div>
                </div>
              )}

              {(creation.draft.stage === "naming" || creation.draft.stage === "creating") && (
                <div className="creation-naming">
                  <small>ФИНАЛЬНЫЙ ШАГ</small>
                  <h3>Назовите изменение</h3>
                  <p>Имя станет устойчивым путём change. Можно выбрать вариант AI или ввести собственный.</p>
                  <div className="creation-name-suggestions">
                    {creation.draft.suggestedNames.map((name) => (
                      <button type="button" key={name} className={creation.draft.changeName === name ? "selected" : ""} onClick={() => creation.setChangeName(name)}>{name}</button>
                    ))}
                  </div>
                  <label>
                    <span>Название change</span>
                    <input value={creation.draft.changeName ?? ""} onChange={(event) => creation.setChangeName(event.target.value)} placeholder="add-guided-change" />
                    <small className={creation.nameValid ? "valid-name" : "invalid-name"}>{creation.nameValid ? "✓ Корректный kebab-case" : "Используйте английские буквы, цифры и дефисы"}</small>
                  </label>
                  <code>openspec/changes/{creation.draft.changeName || "…"}/proposal.md</code>

                  {creation.draft.stage === "naming" && (
                    <button type="button" className="primary-submit creation-prepare" disabled={!creation.nameValid} onClick={() => void prepareChange()}>
                      Подготовить change
                    </button>
                  )}
                  {creation.draft.stage === "creating" && activeOperation && (
                    <div className="creation-running compact"><span className="operation-spinner" /><b>Подготавливаем безопасный diff…</b></div>
                  )}
                  {createFailed && <div className="creation-warning">{workflow.operation?.errorMessage || "Change не подготовлен"}</div>}
                  {creationReview && workflow.operation?.status === "awaiting_review" && (
                    <section className="creation-final-review">
                      <b>Готово к принятию</b>
                      <p>Будет создан {creationReview.files.length} файл(а). Delta specs пока не формируются.</p>
                      {creationReview.files.map((file) => <code key={file.path}>{file.type} · {file.path}</code>)}
                      <button type="button" className="primary-submit" onClick={() => void workflow.accept()}>Принять подготовленный change</button>
                    </section>
                  )}
                  {workflow.draft?.status === "accepted" && (
                    <section className="creation-write-confirmation">
                      <b>Proposal принят как внутренний draft</b>
                      <p>Следующее действие запишет change в активный Store.</p>
                      <button type="button" className="primary-submit" disabled={workflow.pending} onClick={() => void writeCreatedChange()}>
                        Записать change в Store
                      </button>
                    </section>
                  )}
                </div>
              )}

              {(creation.error || workflow.error) && (
                <div className="creation-warning" role="alert">{creation.error?.message || workflow.error?.message}</div>
              )}
            </aside>
          </div>
        )}

        <footer className="change-creation-footer">
          <span><i /> AI работает только с изолированным снимком Store</span>
          {creation.draft.stage === "intent" && (
            <button type="button" className="primary-submit" disabled={!creation.draft.intent.trim() || !agentAvailable} onClick={() => void runExplore()}>
              ✦ Проработать с AI
            </button>
          )}
        </footer>
    </section>
  );
}
