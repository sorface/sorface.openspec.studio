export type OpenSpecArtifactRefreshStep = "specs" | "design" | "tasks";
export type OpenSpecArtifactRefreshStatus = "active" | "interrupted" | "complete";

export interface OpenSpecArtifactRefreshCascade {
  change: string;
  current: OpenSpecArtifactRefreshStep;
  steps: OpenSpecArtifactRefreshStep[];
  completed: OpenSpecArtifactRefreshStep[];
  status: OpenSpecArtifactRefreshStatus;
  specsArtifact: "spec" | "specs";
  operationId?: string;
  reason?: string;
}

export interface OpenSpecArtifactOperationIdentity {
  id?: string;
  change?: string;
  artifact?: string;
}

export const openSpecArtifactRefreshSteps: OpenSpecArtifactRefreshStep[] = [
  "specs",
  "design",
  "tasks",
];

export function normalizeOpenSpecArtifactRefreshStep(
  artifact?: string,
): OpenSpecArtifactRefreshStep | null {
  if (artifact === "spec" || artifact === "specs") return "specs";
  if (artifact === "design" || artifact === "tasks") return artifact;
  return null;
}

export function createOpenSpecArtifactRefreshCascade(
  change: string,
  specsArtifact: string,
  includeTasks = true,
): OpenSpecArtifactRefreshCascade {
  return {
    change,
    current: "specs",
    steps: includeTasks ? openSpecArtifactRefreshSteps : openSpecArtifactRefreshSteps.slice(0, 2),
    completed: [],
    status: "active",
    specsArtifact: specsArtifact === "spec" ? "spec" : "specs",
  };
}

export function bindOpenSpecArtifactRefreshOperation(
  cascade: OpenSpecArtifactRefreshCascade,
  operationId?: string,
): OpenSpecArtifactRefreshCascade {
  if (cascade.status !== "active") return cascade;
  return { ...cascade, operationId };
}

export function openSpecArtifactRefreshMatchesOperation(
  cascade: OpenSpecArtifactRefreshCascade | null,
  operation: OpenSpecArtifactOperationIdentity | null,
  allowInterrupted = false,
): boolean {
  if (!cascade || cascade.status === "complete" || !operation) return false;
  if (cascade.status === "interrupted" && !allowInterrupted) return false;
  if (operation.change !== cascade.change) return false;
  if (normalizeOpenSpecArtifactRefreshStep(operation.artifact) !== cascade.current) return false;
  return !cascade.operationId || operation.id === cascade.operationId;
}

export function resumeOpenSpecArtifactRefreshCascade(
  cascade: OpenSpecArtifactRefreshCascade,
): OpenSpecArtifactRefreshCascade {
  if (cascade.status !== "interrupted") return cascade;
  return { ...cascade, status: "active", operationId: undefined, reason: undefined };
}

export function advanceOpenSpecArtifactRefreshCascade(
  cascade: OpenSpecArtifactRefreshCascade,
): OpenSpecArtifactRefreshCascade {
  if (cascade.status !== "active") return cascade;
  const currentIndex = cascade.steps.indexOf(cascade.current);
  const completed = cascade.completed.includes(cascade.current)
    ? cascade.completed
    : [...cascade.completed, cascade.current];
  const next = cascade.steps[currentIndex + 1];
  return next
    ? { ...cascade, current: next, completed, operationId: undefined }
    : { ...cascade, completed, status: "complete", operationId: undefined, reason: undefined };
}

export function interruptOpenSpecArtifactRefreshCascade(
  cascade: OpenSpecArtifactRefreshCascade,
  reason: string,
): OpenSpecArtifactRefreshCascade {
  if (cascade.status !== "active") return cascade;
  return { ...cascade, status: "interrupted", operationId: undefined, reason };
}

export function openSpecArtifactRefreshActionArtifact(
  cascade: OpenSpecArtifactRefreshCascade,
): string {
  return cascade.current === "specs" ? cascade.specsArtifact : cascade.current;
}

export function openSpecArtifactRefreshGoal(step: OpenSpecArtifactRefreshStep): string {
  if (step === "specs") {
    return [
      "Сначала актуализируй proposal.md выбранного change с учётом внесённых пользователем изменений и согласуй его формулировки с текущим намерением.",
      "Затем пересогласуй все delta specs с итоговым proposal.md.",
      "На этом этапе разрешено изменять только proposal.md и delta specs; не изменяй design.md и tasks.md.",
    ].join(" ");
  }
  if (step === "design") {
    return "Пересогласуй design.md с актуальными proposal.md и уже обновлёнными delta specs. Не изменяй tasks.md на этом этапе.";
  }
  return [
    "Пересогласуй tasks.md с актуальными proposal.md, delta specs и design.md.",
    "Сохраняй отметку [x] только у задачи, чьи требование, смысл, ожидаемый результат и критерии выполнения не изменились.",
    "Если ранее выполненная задача стала спорной, изменилась или утратила актуальность, оставь её невыполненной и сделай изменение видимым в diff.",
    "Не считай change реализованным, пока не выполнены все актуальные пункты tasks.md.",
  ].join(" ");
}

export function openSpecArtifactRefreshStepLabel(step: OpenSpecArtifactRefreshStep): string {
  if (step === "specs") return "proposal.md + diff specs";
  return `${step}.md`;
}

export function openSpecArtifactRefreshStepNumber(
  step: OpenSpecArtifactRefreshStep,
  steps = openSpecArtifactRefreshSteps,
): number {
  return steps.indexOf(step) + 1;
}
