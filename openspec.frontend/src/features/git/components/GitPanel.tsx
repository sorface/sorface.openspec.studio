"use client";

import { useEffect, useRef, useState } from "react";
import type { GitStatusController } from "@/features/git/hooks/useGitStatusController";
import { isGitOperationTerminal } from "@/features/git/model/git-operation";
import { GitChangesPanel } from "@/features/git/components/GitChangesPanel";
import {
  buildSplitDiffRows,
  parseUnifiedDiff,
  type DiffFile,
  type SplitDiffSide,
} from "@/features/git/model/unified-diff";

function DiffSide({ side, variant }: { side: SplitDiffSide; variant: "before" | "after" }) {
  const marker = side.kind === "addition" ? "+" : side.kind === "deletion" ? "−" : "";
  return (
    <div className={`git-diff-side git-diff-line ${variant} ${side.kind}`} aria-hidden={side.kind === "empty" || undefined}>
      <span className="line-number">{side.line ?? ""}</span>
      <span className="diff-marker" aria-hidden="true">{marker}</span>
      <code>{side.content || " "}</code>
    </div>
  );
}

function DiffFileView({ file }: { file: DiffFile }) {
  return (
    <article className="git-diff-file">
      <header>
        <span className={`git-stage-badge ${file.stage}`}>
          {file.stage === "staged" ? "Подготовлено" : "Не подготовлено"}
        </span>
        <strong>{file.path}</strong>
      </header>
      <div className="git-split-labels" aria-hidden="true">
        <div><span>До изменения</span><small>предыдущая версия</small></div>
        <div><span>Текущая версия</span><small>рабочая копия</small></div>
      </div>
      {file.hunks.map((hunk, hunkIndex) => (
        <section className="git-diff-hunk" key={`${file.path}-${hunkIndex}`}>
          <div className="git-hunk-heading">
            Изменённый фрагмент{hunk.label ? ` · ${hunk.label}` : ""}
          </div>
          <div className="git-diff-lines git-split-diff">
            {buildSplitDiffRows(hunk.lines).map((row, lineIndex) => (
              <div className="git-split-row" key={`${row.before.line ?? "-"}-${row.after.line ?? "-"}-${lineIndex}`}>
                <DiffSide side={row.before} variant="before" />
                <DiffSide side={row.after} variant="after" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

export function GitPanel({ controller }: { controller: GitStatusController }) {
  const allDiffFiles = parseUnifiedDiff(controller.status?.diff ?? "");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [remoteBranch, setRemoteBranch] = useState<string | null>(null);
  const [trackingBranch, setTrackingBranch] = useState("");
  const [pushDialog, setPushDialog] = useState(false);
  const [remote, setRemote] = useState("");
  const dialogInput = useRef<HTMLInputElement>(null);
  const pushRemoteSelect = useRef<HTMLSelectElement>(null);
  const status = controller.status;
  const operationActive = Boolean(controller.operation && !isGitOperationTerminal(controller.operation.status));
  const busy = controller.mutationPending || operationActive;
  const dirty = Boolean(status?.changes.length);
  const changePaths = [...new Set(status?.changes.map((item) => item.path) ?? [])];
  const effectiveActivePath = activePath && changePaths.includes(activePath) ? activePath : changePaths[0] ?? null;
  const diffFiles = effectiveActivePath ? allDiffFiles.filter((file) => file.path === effectiveActivePath) : [];
  const effectiveRemote = remote || status?.remotes[0] || "";

  useEffect(() => {
    if (!remoteBranch && !pushDialog) return;
    (remoteBranch ? dialogInput.current : pushRemoteSelect.current)?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setRemoteBranch(null); setPushDialog(false); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [pushDialog, remoteBranch]);

  const chooseBranch = (value: string) => {
    if (!value || value === status?.branch) return;
    if (value.startsWith("remote:")) {
      const branch = value.slice(7);
      setRemoteBranch(branch);
      setTrackingBranch(branch.split("/").slice(1).join("/"));
      return;
    }
    void controller.switchBranch(value);
  };
  const push = () => status?.upstream ? void controller.push() : setPushDialog(true);
  const navigateFile = (offset: number) => {
    if (!effectiveActivePath || changePaths.length < 2) return;
    const current = changePaths.indexOf(effectiveActivePath);
    setActivePath(changePaths[(current + offset + changePaths.length) % changePaths.length]);
  };

  return (
    <section className="git-panel" aria-label="Git-панель">
      <header className="git-panel-header">
        <div className="git-branch-summary">
          <span className="eyebrow">STORE GIT</span>
          <label>
            <span className="sr-only">Текущая ветка Store</span>
            <select value={status?.branch ?? ""} onChange={(event) => chooseBranch(event.target.value)} disabled={!status || dirty || busy} title={dirty ? "Commit local changes before switching branches" : "Current Store branch"}>
              {status?.detached && <option value="">detached HEAD</option>}
              {status?.localBranches.map((branch) => <option value={branch} key={branch}>{branch}</option>)}
              {status?.remoteBranches.map((branch) => <option value={`remote:${branch}`} key={branch}>↳ {branch}</option>)}
            </select>
          </label>
          {status?.head && <code>{status.head.slice(0, 12)} · {status.upstream || "без upstream"} · ↑{status.ahead} ↓{status.behind}</code>}
        </div>
        <div className="git-network-actions">
          <select aria-label="Git remote" value={effectiveRemote} onChange={(event) => setRemote(event.target.value)} disabled={busy || !status?.remotes.length}>
            {status?.remotes.map((item) => <option key={item}>{item}</option>)}
          </select>
          <button type="button" onClick={() => void controller.fetch(effectiveRemote)} disabled={busy || !effectiveRemote}>Fetch</button>
          <button type="button" onClick={push} disabled={busy || !status || status.detached}>Push</button>
          <button type="button" onClick={controller.refresh} disabled={controller.loading || busy}>{controller.loading ? "Обновление…" : "↻"}</button>
        </div>
      </header>

      {controller.loading && !controller.status && <div className="git-panel-state">Загрузка Git status…</div>}
      {controller.error && (
        <div className="git-panel-state error" role="alert">
          <b>{controller.error.message}</b>
          {controller.error.code === "INVALID_STORE" && <p>Создайте проект заново с локальным Store или через «Клонировать Store».</p>}
          {controller.error.correlationId && <small>Correlation ID: {controller.error.correlationId}</small>}
          <p>{gitRecoveryHint(controller.error.code)}</p>
          <button type="button" onClick={controller.refresh}>Повторить</button>
        </div>
      )}
      {status && (
        <div className="git-panel-body">
          <GitChangesPanel activePath={effectiveActivePath} busy={busy} controller={controller} dirty={dirty} onActivePathChange={setActivePath} status={status} />
          <div className="git-diff">
            <div className="git-diff-heading">
              <div className="git-diff-title">
                <span className="eyebrow">DIFF PREVIEW</span>
                <b>{effectiveActivePath ?? "Select a changed file"}</b>
              </div>
              <div className="git-diff-navigation" aria-label="Навигация по изменённым файлам">
                <button type="button" onClick={() => navigateFile(-1)} disabled={changePaths.length < 2} aria-label="Предыдущий изменённый файл" title="Previous file">↑</button>
                <span>{effectiveActivePath ? changePaths.indexOf(effectiveActivePath) + 1 : 0} / {changePaths.length}</span>
                <button type="button" onClick={() => navigateFile(1)} disabled={changePaths.length < 2} aria-label="Следующий изменённый файл" title="Next file">↓</button>
              </div>
              <span className="git-diff-legend">
                <i className="addition" /> добавлено
                <i className="deletion" /> удалено
              </span>
              {status.diffTruncated && <span>Ответ усечён сервером</span>}
            </div>
            <div className="git-diff-content">
              {diffFiles.length
                ? diffFiles.map((file, index) => (
                  <DiffFileView file={file} key={`${file.stage}-${file.path}-${index}`} />
                ))
                : <p className="git-diff-empty">{effectiveActivePath ? "Для нового файла diff появится после Stage." : "Выберите файл в панели изменений."}</p>}
            </div>
          </div>
        </div>
      )}
      <footer className="git-panel-footer">
        {controller.operation
          ? <><span>{controller.operation.gitAction}: {operationLabel(controller.operation.status)}</span>{operationActive && <button type="button" onClick={() => void controller.cancelOperation()}>Отменить</button>}{controller.operation.errorMessage && <span>{controller.operation.errorMessage} · {gitRecoveryHint(controller.operation.errorCode ?? "")}</span>}</>
          : <span>Store Git · локальные изменения и сеть управляются отдельно</span>}
      </footer>
      {remoteBranch && (
        <div className="git-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRemoteBranch(null); }}>
          <section className="git-dialog" role="dialog" aria-modal="true" aria-labelledby="git-track-title">
            <h3 id="git-track-title">Создать tracking branch?</h3>
            <p>Remote-tracking ветка: <code>{remoteBranch}</code></p>
            <label>Локальная ветка<input ref={dialogInput} value={trackingBranch} onChange={(event) => setTrackingBranch(event.target.value)} /></label>
            <div><button type="button" onClick={() => setRemoteBranch(null)}>Отмена</button><button type="button" disabled={!trackingBranch || busy} onClick={() => void controller.trackRemoteBranch(remoteBranch, trackingBranch).then((ok) => { if (ok) setRemoteBranch(null); })}>Подтвердить</button></div>
          </section>
        </div>
      )}
      {pushDialog && (
        <div className="git-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPushDialog(false); }}>
          <section className="git-dialog" role="dialog" aria-modal="true" aria-labelledby="git-push-title">
            <h3 id="git-push-title">Настроить upstream и отправить?</h3>
            <p>Ветка будет опубликована без force-push.</p>
            <label>Remote<select ref={pushRemoteSelect} value={effectiveRemote} onChange={(event) => setRemote(event.target.value)}>{status?.remotes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Remote branch<input value={status?.branch ?? ""} readOnly /></label>
            <div><button type="button" onClick={() => setPushDialog(false)}>Отмена</button><button type="button" disabled={!effectiveRemote || busy} onClick={() => void controller.push(effectiveRemote, status?.branch).then((ok) => { if (ok) setPushDialog(false); })}>Push & set upstream</button></div>
          </section>
        </div>
      )}
    </section>
  );
}

function operationLabel(status: string): string {
  return ({ queued: "в очереди", running: "выполняется", validating: "проверка", completed: "готово", cancelled: "отменено", failed: "ошибка" } as Record<string, string>)[status] ?? status;
}

export function gitRecoveryHint(code: string): string {
  const hints: Record<string, string> = {
    GIT_INDEX_CHANGED: "Состав staged-файлов изменился. Обновите status и подтвердите выбор снова.",
    GIT_HEAD_CHANGED: "HEAD изменился. Обновите status перед повторным commit.",
    GIT_WORKTREE_DIRTY: "Сначала закоммитьте или отмените локальные изменения.",
    GIT_AUTH_FAILED: "Проверьте ssh-agent или системный credential helper.",
    GIT_NON_FAST_FORWARD: "Сначала выполните Fetch и разрешите расхождение веток.",
    GIT_TIMEOUT: "Проверьте сеть и повторите операцию.",
    GIT_REMOTE_NOT_FOUND: "Обновите status и выберите существующий remote.",
    GIT_OPERATION_CONFLICT: "Дождитесь завершения активной Git-операции или отмените её.",
    GIT_DETACHED_HEAD: "Переключитесь на локальную ветку перед Push.",
    GIT_CHERRY_PICK_CONFLICT: "Разрешите Git conflict в рабочей копии, затем обновите status.",
    GIT_STASH_FAILED: "Не удалось временно сохранить локальные изменения. Обновите status и проверьте рабочую копию.",
    GIT_STASH_POP_CONFLICT: "Обновления применены, но локальные изменения вернулись с конфликтом. Разрешите conflict в рабочей копии.",
    GIT_COMMIT_NOT_FOUND: "Обновите список commits и повторите выбор.",
  };
  return hints[code] ?? "Обновите Git status и повторите безопасную операцию.";
}
