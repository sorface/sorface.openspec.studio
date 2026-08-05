export interface StructuredOperationConclusion {
  summary: string;
  assumptions: string[];
  suggestedNames: string[];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unwrapJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function parseStructuredOperationConclusion(value: string): StructuredOperationConclusion | null {
  try {
    const parsed = JSON.parse(unwrapJsonFence(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    const assumptions = stringList(record.assumptions);
    const suggestedNames = stringList(record.suggestedNames ?? record.suggested_names);
    if (!summary && assumptions.length === 0 && suggestedNames.length === 0) return null;

    return { summary, assumptions, suggestedNames };
  } catch {
    return null;
  }
}
