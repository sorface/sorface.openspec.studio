export type CloneEventName = "queued" | "running" | "progress" | "validating" | "completed" | "cancelled" | "failed";

export function reduceCloneStatus(current: string | null, event: CloneEventName): string {
  if (event === "progress") return current ?? "running";
  return event;
}

export function isCloneTerminal(status: string | null): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

export function cloneRecoveryHint(errorCode?: string): string {
  if (errorCode === "GIT_AUTH_FAILED") {
    return "Проверьте SSH_AUTH_SOCK и список ключей командой ssh-add -l.";
  }
  if (errorCode === "SSH_HOST_KEY_FAILED") {
    return "Проверьте fingerprint хоста и запись в ~/.ssh/known_hosts.";
  }
  if (errorCode === "INVALID_REPOSITORY") {
    return "Клонированный каталог должен быть отдельным Git worktree.";
  }
  return "Проверьте Git URL и повторите.";
}
