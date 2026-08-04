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
  if (errorCode === "WORKTREE_DIRTY") {
    return "Переключение и обновление доступны только для репозитория без локальных изменений.";
  }
  if (errorCode === "GIT_UPSTREAM_MISSING") {
    return "Сначала выберите remote-tracking ветку, чтобы настроить upstream.";
  }
  if (errorCode === "GIT_FAST_FORWARD_REQUIRED") {
    return "Ветки разошлись. Разрешите расхождение вручную вне OpenSpec Studio.";
  }
  if (errorCode === "GIT_BRANCH_NOT_FOUND" || errorCode === "GIT_BRANCH_EXISTS") {
    return "Перечитайте репозитории и выберите актуальную ветку.";
  }
  if (errorCode === "GIT_TIMEOUT" || errorCode === "GIT_OPERATION_FAILED") {
    return "Проверьте Git-состояние и сетевое подключение, затем повторите.";
  }
  return "Проверьте Git URL и повторите.";
}
