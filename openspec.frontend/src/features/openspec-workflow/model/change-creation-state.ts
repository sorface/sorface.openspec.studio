import type {
  ChangeCreationDraft,
  OpenSpecExplorationResult,
} from "./openspec-types";

export function emptyChangeCreationDraft(): ChangeCreationDraft {
  return {
    version: 1,
    stage: "intent",
    intent: "",
    questions: [],
    answers: {},
    assumptions: [],
    suggestedNames: [],
    proposalAccepted: false,
  };
}

export function invalidateCreationResearch(
  current: ChangeCreationDraft,
  intent: string,
): ChangeCreationDraft {
  if (intent === current.intent) return current;
  return {
    ...emptyChangeCreationDraft(),
    projectId: current.projectId,
    createdAt: current.createdAt,
    intent,
  };
}

export function applyExplorationResult(
  current: ChangeCreationDraft,
  result: OpenSpecExplorationResult,
): ChangeCreationDraft {
  const answers = Object.fromEntries(
    result.questions
      .filter((question) => current.answers[question.id])
      .map((question) => [question.id, current.answers[question.id]]),
  );
  return {
    ...current,
    stage: result.state === "needs_input" ? "clarifying" : "proposal",
    summary: result.summary,
    questions: result.questions,
    answers,
    assumptions: result.assumptions,
    proposal: result.proposal,
    suggestedNames: result.suggestedNames,
    proposalAccepted: false,
    changeName: result.suggestedNames[0] ?? "",
    feedback: "",
  };
}

export function buildCreationHandoff(
  draft: ChangeCreationDraft,
  continueWithAssumptions = false,
): string {
  const questions = draft.questions.map((question) => ({
    id: question.id,
    question: question.prompt,
    answer: draft.answers[question.id] ?? [],
  }));
  const sections = [
    `ИСХОДНЫЙ MARKDOWN-ЗАМЫСЕЛ:\n${draft.intent.trim()}`,
    draft.summary ? `SUMMARY ПРЕДЫДУЩЕГО РАУНДА:\n${draft.summary.trim()}` : "",
    questions.length ? `ВОПРОСЫ И ОТВЕТЫ:\n${JSON.stringify(questions)}` : "",
    draft.assumptions.length ? `ЯВНЫЕ ДОПУЩЕНИЯ:\n${JSON.stringify(draft.assumptions)}` : "",
    draft.feedback?.trim() ? `ЗАМЕЧАНИЕ К PROPOSAL:\n${draft.feedback.trim()}` : "",
    continueWithAssumptions
      ? "Пользователь разрешил продолжить с явно перечисленными неблокирующими допущениями."
      : "",
  ].filter(Boolean);
  return sections.join("\n\n").slice(0, 32 * 1024);
}

export function isValidChangeName(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}
