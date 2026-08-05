export interface EditorTextSelection {
  text: string;
  prefix?: string;
  suffix?: string;
  from?: number;
  to?: number;
}

export interface EditorFragmentComment {
  id: string;
  selection: EditorTextSelection;
  text: string;
  createdAt: string;
}

export function proposalCommentsStorageKey(projectId: string): string {
  return `openspec-studio:proposal-comments:${projectId}`;
}

export function proposalCommentsGoal(comments: EditorFragmentComment[]): string {
  if (!comments.length) return "";
  const entries = comments.map((comment, index) => [
    `${index + 1}. Фрагмент proposal.md:`,
    `<<<FRAGMENT\n${comment.selection.text.trim()}\nFRAGMENT`,
    "Комментарий:",
    `<<<COMMENT\n${comment.text.trim()}\nCOMMENT`,
  ].join("\n"));
  return [
    "Обнови proposal.md согласно всем комментариям к выделенным фрагментам ниже.",
    "Каждый комментарий относится только к указанному фрагменту. Сохрани остальной смысл и Markdown-структуру proposal.md.",
    ...entries,
  ].join("\n\n");
}
