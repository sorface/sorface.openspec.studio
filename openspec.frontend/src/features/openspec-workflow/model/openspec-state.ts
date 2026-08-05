import type { OpenSpecActionResult, OpenSpecOperation, OpenSpecOperationStatus, OpenSpecViewStatus } from "./openspec-types";

const terminalStatuses = new Set<OpenSpecOperationStatus>([
  "awaiting_review", "accepted", "rejected", "cancelled", "failed",
]);

export function isOpenSpecOperationTerminal(status: OpenSpecOperationStatus): boolean {
  return terminalStatuses.has(status);
}

export function reduceOpenSpecOperationStatus(
  current: OpenSpecOperationStatus,
  event: string,
): OpenSpecOperationStatus {
  if (event === "running" || event === "validating" || event === "awaiting_review" ||
      event === "cancelled" || event === "failed") {
    return event;
  }
  return current;
}

export function openSpecViewStatus(errorCode: string): OpenSpecViewStatus {
  if (errorCode === "NETWORK_ERROR" || errorCode === "OPENSPEC_CLI_UNAVAILABLE" ||
      errorCode === "OPENSPEC_VERSION_UNSUPPORTED") return "unavailable";
  if (errorCode === "OPENSPEC_STATUS_STALE") return "stale";
  return "error";
}

export function openSpecOperationShouldAutoApply(operation: OpenSpecOperation | null): boolean {
  if (operation?.status !== "awaiting_review" ||
      !["prepare_artifact", "fix_artifact"].includes(operation.openspecAction) ||
      !operation.result) return false;
  try {
    const result = JSON.parse(operation.result) as OpenSpecActionResult;
    return Array.isArray(result.files) && result.files.length === 0 &&
      result.exploration?.state !== "needs_input";
  } catch {
    return false;
  }
}
