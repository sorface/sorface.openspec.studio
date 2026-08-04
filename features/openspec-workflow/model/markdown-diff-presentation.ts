export type MarkdownDiffInlineKind = "text" | "code" | "strong" | "emphasis" | "strike" | "link";

export interface MarkdownDiffInlineToken {
  kind: MarkdownDiffInlineKind;
  text: string;
  target?: string;
}

export type MarkdownDiffLineKind =
  | "blank"
  | "paragraph"
  | "heading"
  | "task"
  | "unordered-list"
  | "ordered-list"
  | "quote"
  | "code"
  | "code-fence"
  | "divider";

export interface MarkdownDiffLinePresentation {
  kind: MarkdownDiffLineKind;
  text: string;
  inline: MarkdownDiffInlineToken[];
  level?: number;
  indent?: number;
  prefix?: string;
  checked?: boolean;
  language?: string;
}

type InlineMatcher = {
  kind: Exclude<MarkdownDiffInlineKind, "text">;
  expression: RegExp;
  textGroup: number;
  targetGroup?: number;
};

const inlineMatchers: InlineMatcher[] = [
  { kind: "code", expression: /`([^`]+)`/, textGroup: 1 },
  { kind: "strong", expression: /\*\*([^*]+)\*\*|__([^_]+)__/, textGroup: 1 },
  { kind: "strike", expression: /~~([^~]+)~~/, textGroup: 1 },
  { kind: "link", expression: /\[([^\]]+)]\(([^)]+)\)/, textGroup: 1, targetGroup: 2 },
  { kind: "emphasis", expression: /\*([^*]+)\*|_([^_]+)_/, textGroup: 1 },
];

function matchedGroup(match: RegExpExecArray, preferredGroup: number): string {
  return match[preferredGroup] ?? match.slice(preferredGroup + 1).find((value) => value !== undefined) ?? "";
}

export function tokenizeMarkdownDiffInline(text: string): MarkdownDiffInlineToken[] {
  const tokens: MarkdownDiffInlineToken[] = [];
  let remaining = text;

  while (remaining) {
    let best: { matcher: InlineMatcher; match: RegExpExecArray } | undefined;
    for (const matcher of inlineMatchers) {
      const match = matcher.expression.exec(remaining);
      if (!match) continue;
      if (!best || match.index < best.match.index) best = { matcher, match };
    }

    if (!best) {
      tokens.push({ kind: "text", text: remaining });
      break;
    }
    if (best.match.index > 0) {
      tokens.push({ kind: "text", text: remaining.slice(0, best.match.index) });
    }

    tokens.push({
      kind: best.matcher.kind,
      text: matchedGroup(best.match, best.matcher.textGroup),
      target: best.matcher.targetGroup ? best.match[best.matcher.targetGroup] : undefined,
    });
    remaining = remaining.slice(best.match.index + best.match[0].length);
  }

  return tokens;
}

function indentation(leadingWhitespace: string): number {
  return Math.min(leadingWhitespace.replace(/\t/g, "  ").length, 12);
}

function presentation(
  kind: MarkdownDiffLineKind,
  text: string,
  details: Omit<MarkdownDiffLinePresentation, "kind" | "text" | "inline"> = {},
): MarkdownDiffLinePresentation {
  return { kind, text, inline: tokenizeMarkdownDiffInline(text), ...details };
}

export function presentMarkdownDiff(markdown: string): MarkdownDiffLinePresentation[] {
  if (!markdown) return [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  let activeFence: "```" | "~~~" | undefined;
  return lines.map((line) => {
    const fence = line.match(/^\s*(```|~~~)\s*([^\s`]*)?.*$/);
    if (fence) {
      const marker = fence[1] as "```" | "~~~";
      const isClosing = activeFence === marker;
      activeFence = isClosing ? undefined : marker;
      return presentation("code-fence", "", { language: isClosing ? undefined : fence[2] || "code" });
    }
    if (activeFence) return presentation("code", line);
    if (!line.trim()) return presentation("blank", "");
    if (/^\s*((\*|-|_)\s*){3,}$/.test(line)) return presentation("divider", "");

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) return presentation("heading", heading[2], { level: heading[1].length });

    const task = line.match(/^(\s*)[-*+]\s+\[([ xX])]\s+(.+)$/);
    if (task) {
      return presentation("task", task[3], {
        indent: indentation(task[1]),
        checked: task[2].toLowerCase() === "x",
      });
    }

    const unordered = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (unordered) {
      return presentation("unordered-list", unordered[2], { indent: indentation(unordered[1]) });
    }

    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      return presentation("ordered-list", ordered[3], {
        indent: indentation(ordered[1]),
        prefix: `${ordered[2]}.`,
      });
    }

    const quote = line.match(/^(\s*)>\s?(.*)$/);
    if (quote) return presentation("quote", quote[2], { indent: indentation(quote[1]) });

    return presentation("paragraph", line.trim());
  });
}
