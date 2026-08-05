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

export interface EditorCommentRange {
  id: string;
  from: number;
  to: number;
  draft?: boolean;
}

export function mapEditorCommentRanges(
  ranges: EditorCommentRange[],
  mapPosition: (position: number, association: -1 | 1) => number,
  documentSize: number,
): EditorCommentRange[] {
  const clamp = (position: number) => Math.max(0, Math.min(documentSize, position));
  return ranges.map((range) => {
    const mappedFrom = clamp(mapPosition(range.from, 1));
    const mappedTo = clamp(mapPosition(range.to, -1));
    return {
      ...range,
      from: Math.min(mappedFrom, mappedTo),
      to: Math.max(mappedFrom, mappedTo),
    };
  });
}

export function proposalCommentsStorageKey(projectId: string): string {
  return `openspec-studio:proposal-comments:${projectId}`;
}

export function proposalCommentsGoal(comments: EditorFragmentComment[]): string {
  return artifactCommentsGoal(comments, "proposal");
}

export function artifactCommentsGoal(
  comments: EditorFragmentComment[],
  artifact: "proposal" | "design" | "tasks",
): string {
  if (!comments.length) return "";
  const entries = comments.map((comment, index) => [
    `${index + 1}. Фрагмент ${artifact}.md:`,
    `<<<FRAGMENT\n${comment.selection.text.trim()}\nFRAGMENT`,
    "Комментарий:",
    `<<<COMMENT\n${comment.text.trim()}\nCOMMENT`,
  ].join("\n"));
  return [
    `Обнови ${artifact}.md согласно всем комментариям к выделенным фрагментам ниже.`,
    `Каждый комментарий относится только к указанному фрагменту. Сохрани остальной смысл и Markdown-структуру ${artifact}.md.`,
    ...entries,
  ].join("\n\n");
}
