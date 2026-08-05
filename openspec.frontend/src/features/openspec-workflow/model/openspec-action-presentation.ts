import type {
  OpenSpecAction,
  OpenSpecChangeDetails,
} from "@/features/openspec-workflow/model/openspec-types";

export interface OpenSpecDocumentActionPresentation {
  action: OpenSpecAction;
  label: string;
  primary: boolean;
}

export const openSpecActionLabels: Record<string, string> = {
  explore: "Исследование задачи",
  create_change: "Создать изменение",
  prepare_artifact: "Подготовить",
  fix_artifact: "Исправить",
  archive: "Архивировать",
};

export function openSpecActionLabel(action: OpenSpecAction): string {
  if ((action.kind === "prepare_artifact" || action.kind === "fix_artifact") &&
      ["spec", "specs"].includes(action.artifact ?? "")) {
    return action.kind === "prepare_artifact" ? "Сформировать specs изменения" : "Обновить specs изменения";
  }
  if (action.kind === "prepare_artifact" && action.artifact === "proposal") {
    return "Подготовить proposal";
  }
  if (action.kind === "prepare_artifact" && action.artifact === "design") {
    return "Сформировать design";
  }
  if (action.kind === "prepare_artifact" && action.artifact === "tasks") {
    return "Сформировать tasks";
  }
  return openSpecActionLabels[action.kind] ?? action.kind;
}

export function openSpecDocumentActions(
  details: OpenSpecChangeDetails,
  hasSpecs: boolean,
  documentArtifact: "proposal" | "design" = "proposal",
): OpenSpecDocumentActionPresentation[] {
  const actionFor = (...artifacts: string[]) => details.actions.find((candidate) =>
    artifacts.includes(candidate.artifact ?? "") &&
    (candidate.kind === "prepare_artifact" || candidate.kind === "fix_artifact"),
  );
  const artifactDone = (...artifacts: string[]) => details.artifacts.some((artifact) =>
    artifacts.includes(artifact.id) && artifact.status === "done",
  );
  const specs = actionFor("spec", "specs");
  const specsDone = artifactDone("spec", "specs");
  const design = actionFor("design");
  const tasks = actionFor("tasks");

  if (documentArtifact === "design") {
    if (!specsDone || !artifactDone("design") || !tasks) return [];
    return [{
      action: tasks,
      label: artifactDone("tasks") ? "Обновить tasks.md" : "Создать tasks.md",
      primary: true,
    }];
  }

  if (!specsDone) {
    return specs ? [{
      action: specs,
      label: hasSpecs ? "Обновить specs" : "Сформировать specs",
      primary: true,
    }] : [];
  }

  const proposalActions: OpenSpecDocumentActionPresentation[] = [
    ...(specs ? [{
      action: specs,
      label: "Обновить",
      primary: false,
    }] : []),
  ];
  if (!design || artifactDone("design")) return proposalActions;
  return [...proposalActions, {
    action: design,
    label: "Создать design.md",
    primary: true,
  }];
}

export function defaultOpenSpecActionGoal(action: OpenSpecAction): string {
  if (["spec", "specs"].includes(action.artifact ?? "")) {
    return action.kind === "fix_artifact"
      ? "Исправь specs изменения по диагностике и актуальному proposal.md."
      : "Сформируй или обнови specs изменения по актуальному proposal.md.";
  }
  if (action.artifact === "proposal") return "Подготовь proposal по описанному замыслу изменения.";
  if (action.artifact === "design") return "Подготовь design для выбранного change по актуальным proposal и specs.";
  if (action.artifact === "tasks") return "Подготовь tasks для выбранного change по актуальным specs и design.";
  return "Выполни доступное действие OpenSpec для выбранного change.";
}
