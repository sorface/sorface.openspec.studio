export type AiEventName =
  | "queued" | "running" | "provider_event" | "provider_diagnostic"
  | "validating" | "awaiting_review" | "cancelled" | "failed";

export function reduceAiStatus(current: string | null, event: AiEventName): string {
  if (event === "provider_event" || event === "provider_diagnostic") return current ?? "running";
  return event;
}

export function isAiTerminal(status: string | null): boolean {
  return status === "awaiting_review" || status === "cancelled" || status === "failed";
}
