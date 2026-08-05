export type DiffStage = "staged" | "unstaged";
export type DiffLineKind = "context" | "addition" | "deletion";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  label: string;
  lines: DiffLine[];
}

export interface DiffFile {
  stage: DiffStage;
  path: string;
  hunks: DiffHunk[];
}

export type SplitDiffKind = DiffLineKind | "empty";

export interface SplitDiffSide {
  kind: SplitDiffKind;
  content: string;
  line?: number;
}

export interface SplitDiffRow {
  before: SplitDiffSide;
  after: SplitDiffSide;
}

const hunkPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
const filePattern = /^diff --git a\/(.+) b\/(.+)$/;

export function parseUnifiedDiff(value: string): DiffFile[] {
  const files: DiffFile[] = [];
  let stage: DiffStage = "unstaged";
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of value.replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine === "# Staged") {
      stage = "staged";
      continue;
    }
    if (rawLine === "# Unstaged") {
      stage = "unstaged";
      continue;
    }

    const fileMatch = rawLine.match(filePattern);
    if (fileMatch) {
      file = { stage, path: fileMatch[2], hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }

    const hunkMatch = rawLine.match(hunkPattern);
    if (hunkMatch && file) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      hunk = {
        label: hunkMatch[3].trim(),
        lines: [],
      };
      file.hunks.push(hunk);
      continue;
    }

    if (!file || !hunk || rawLine === "\\ No newline at end of file") continue;
    if (rawLine.startsWith("+")) {
      hunk.lines.push({ kind: "addition", content: rawLine.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith("-")) {
      hunk.lines.push({ kind: "deletion", content: rawLine.slice(1), oldLine });
      oldLine += 1;
      continue;
    }

    hunk.lines.push({
      kind: "context",
      content: rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return files;
}

/** Aligns a unified diff hunk into the two columns used by a side-by-side viewer. */
export function buildSplitDiffRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.kind === "context") {
      rows.push({
        before: { kind: "context", content: line.content, line: line.oldLine },
        after: { kind: "context", content: line.content, line: line.newLine },
      });
      index += 1;
      continue;
    }

    const changed: DiffLine[] = [];
    while (index < lines.length && lines[index].kind !== "context") {
      changed.push(lines[index]);
      index += 1;
    }
    const deletions = changed.filter((item) => item.kind === "deletion");
    const additions = changed.filter((item) => item.kind === "addition");
    const changedRowCount = Math.max(deletions.length, additions.length);

    for (let changedIndex = 0; changedIndex < changedRowCount; changedIndex += 1) {
      const deletion = deletions[changedIndex];
      const addition = additions[changedIndex];
      rows.push({
        before: deletion
          ? { kind: "deletion", content: deletion.content, line: deletion.oldLine }
          : { kind: "empty", content: "" },
        after: addition
          ? { kind: "addition", content: addition.content, line: addition.newLine }
          : { kind: "empty", content: "" },
      });
    }
  }

  return rows;
}
