export interface TaskProgress {
  completed: number;
  total: number;
}

export function isOpenSpecTasksPath(path: string | null): boolean {
  return /^openspec\/changes\/[^/]+\/tasks\.md$/.test(path ?? "");
}

export function taskProgressFromMarkdown(markdown: string): TaskProgress {
  const checkboxes = markdown.matchAll(/^\s*[-*+]\s+\[([ xX])\](?:\s|$)/gm);
  let completed = 0;
  let total = 0;
  for (const checkbox of checkboxes) {
    total += 1;
    if (checkbox[1].toLowerCase() === "x") completed += 1;
  }
  return { completed, total };
}
