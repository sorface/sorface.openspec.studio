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
