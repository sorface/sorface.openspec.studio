export type SplitDiffRowKind = "equal" | "change" | "remove" | "add";

export interface SplitDiffCell {
  lineNumber: number;
  text: string;
}

export interface SplitDiffRow {
  kind: SplitDiffRowKind;
  before?: SplitDiffCell;
  after?: SplitDiffCell;
}

export interface SplitDiffSummary {
  additions: number;
  deletions: number;
}

type LineOperation = {
  kind: "equal" | "remove" | "add";
  text: string;
};

function markdownLines(markdown: string): string[] {
  if (!markdown) return [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function lineOperations(before: string[], after: string[]): LineOperation[] {
  const longestCommonSubsequence = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1),
  );

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      longestCommonSubsequence[beforeIndex][afterIndex] = before[beforeIndex] === after[afterIndex]
        ? longestCommonSubsequence[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(
          longestCommonSubsequence[beforeIndex + 1][afterIndex],
          longestCommonSubsequence[beforeIndex][afterIndex + 1],
        );
    }
  }

  const operations: LineOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      operations.push({ kind: "equal", text: before[beforeIndex] });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (longestCommonSubsequence[beforeIndex + 1][afterIndex]
      >= longestCommonSubsequence[beforeIndex][afterIndex + 1]) {
      operations.push({ kind: "remove", text: before[beforeIndex] });
      beforeIndex += 1;
    } else {
      operations.push({ kind: "add", text: after[afterIndex] });
      afterIndex += 1;
    }
  }

  while (beforeIndex < before.length) {
    operations.push({ kind: "remove", text: before[beforeIndex] });
    beforeIndex += 1;
  }
  while (afterIndex < after.length) {
    operations.push({ kind: "add", text: after[afterIndex] });
    afterIndex += 1;
  }

  return operations;
}

export function createSplitLineDiff(beforeMarkdown: string, afterMarkdown: string): SplitDiffRow[] {
  const operations = lineOperations(markdownLines(beforeMarkdown), markdownLines(afterMarkdown));
  const rows: SplitDiffRow[] = [];
  let beforeLineNumber = 1;
  let afterLineNumber = 1;
  let operationIndex = 0;

  while (operationIndex < operations.length) {
    const operation = operations[operationIndex];
    if (operation.kind === "equal") {
      rows.push({
        kind: "equal",
        before: { lineNumber: beforeLineNumber, text: operation.text },
        after: { lineNumber: afterLineNumber, text: operation.text },
      });
      beforeLineNumber += 1;
      afterLineNumber += 1;
      operationIndex += 1;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];
    while (operationIndex < operations.length && operations[operationIndex].kind !== "equal") {
      const changedOperation = operations[operationIndex];
      if (changedOperation.kind === "remove") removed.push(changedOperation.text);
      if (changedOperation.kind === "add") added.push(changedOperation.text);
      operationIndex += 1;
    }

    const changedRowCount = Math.max(removed.length, added.length);
    for (let changedIndex = 0; changedIndex < changedRowCount; changedIndex += 1) {
      const removedText = removed[changedIndex];
      const addedText = added[changedIndex];
      const beforeCell = removedText === undefined
        ? undefined
        : { lineNumber: beforeLineNumber++, text: removedText };
      const afterCell = addedText === undefined
        ? undefined
        : { lineNumber: afterLineNumber++, text: addedText };

      rows.push({
        kind: beforeCell && afterCell ? "change" : beforeCell ? "remove" : "add",
        before: beforeCell,
        after: afterCell,
      });
    }
  }

  return rows;
}

export function summarizeSplitLineDiff(rows: SplitDiffRow[]): SplitDiffSummary {
  return rows.reduce<SplitDiffSummary>((summary, row) => ({
    additions: summary.additions + (row.kind !== "equal" && row.after ? 1 : 0),
    deletions: summary.deletions + (row.kind !== "equal" && row.before ? 1 : 0),
  }), { additions: 0, deletions: 0 });
}
