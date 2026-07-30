export type CloneEventName = "queued" | "running" | "progress" | "validating" | "completed" | "cancelled" | "failed";

export function reduceCloneStatus(current: string | null, event: CloneEventName): string {
  if (event === "progress") return current ?? "running";
  return event;
}

export function isCloneTerminal(status: string | null): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}
