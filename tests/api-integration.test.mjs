import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#${Date.now()}-${Math.random()}`);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("API transport возвращает JSON и типизированную безопасную ошибку", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const api = await importTypeScript("../features/api/api-client.ts");

  globalThis.fetch = async () => jsonResponse({ status: "ready" });
  assert.deepEqual(await api.apiRequest("/api/v1/system/health"), { status: "ready" });

  globalThis.fetch = async () => jsonResponse({
    error: {
      code: "INVALID_PROJECT_NAME",
      message: "Название проекта обязательно",
      details: { field: "name" },
      correlationId: "correlation-1",
    },
  }, 400);
  await assert.rejects(
    api.apiRequest("/api/v1/projects"),
    (error) => error instanceof api.ApiError
      && error.status === 400
      && error.code === "INVALID_PROJECT_NAME"
      && error.correlationId === "correlation-1",
  );
});

test("API transport преобразует сетевую ошибку в backend unavailable", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const api = await importTypeScript("../features/api/api-client.ts");
  globalThis.fetch = async () => { throw new TypeError("connection refused"); };

  await assert.rejects(
    api.apiRequest("/api/v1/projects"),
    (error) => error.code === "NETWORK_ERROR" && error.status === 0,
  );
});

test("мутация получает CSRF token и повторяется после CSRF_REJECTED только один раз", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const api = await importTypeScript("../features/api/api-client.ts");
  const calls = [];
  let sessionNumber = 0;
  let mutationNumber = 0;

  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/v1/system/session") {
      sessionNumber += 1;
      return jsonResponse({ csrfToken: `token-${sessionNumber}` });
    }
    mutationNumber += 1;
    if (mutationNumber <= 2) {
      return jsonResponse({ error: { code: "CSRF_REJECTED", message: "CSRF token недействителен" } }, 403);
    }
    return jsonResponse({ id: "project-1" }, 201);
  };

  await assert.rejects(
    api.apiRequest("/api/v1/projects", { method: "POST", body: { name: "Platform", storePath: "/store" } }),
    (error) => error.code === "CSRF_REJECTED",
  );

  assert.equal(calls.length, 4);
  assert.equal(calls[1].options.headers.get("X-CSRF-Token"), "token-1");
  assert.equal(calls[3].options.headers.get("X-CSRF-Token"), "token-2");
  assert.equal(calls[1].options.body, JSON.stringify({ name: "Platform", storePath: "/store" }));
});

test("API transport корректно обрабатывает 204 No Content", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const api = await importTypeScript("../features/api/api-client.ts");
  globalThis.fetch = async (path) => path === "/api/v1/system/session"
    ? jsonResponse({ csrfToken: "token" })
    : new Response(null, { status: 204 });

  assert.equal(await api.apiRequest("/api/v1/projects/project-1", { method: "DELETE" }), undefined);
});

test("выбор проекта восстанавливается безопасно и получает fallback после удаления", async () => {
  const selection = await importTypeScript("../features/projects/model/project-selection.ts");
  const projects = [{ id: "one" }, { id: "two" }, { id: "three" }];

  assert.equal(selection.resolveActiveProjectId(projects, "two"), "two");
  assert.equal(selection.resolveActiveProjectId(projects, "missing"), "one");
  assert.equal(selection.resolveActiveProjectId([], "missing"), null);
  assert.equal(selection.nextProjectIdAfterDelete(projects, "two"), "three");
  assert.equal(selection.nextProjectIdAfterDelete(projects, "three"), "two");
});

test("projects client и controller покрывают CRUD, lifecycle и подтверждённое состояние", async () => {
  const [client, controller, switcher] = await Promise.all([
    readFile(new URL("../features/projects/api/projects-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/projects/hooks/useProjectsController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/projects/components/ProjectSwitcher.tsx", import.meta.url), "utf8"),
  ]);

  for (const method of ["listProjects", "getProject", "createProject", "createProjectFromGit", "updateProject", "deleteProject"]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(controller, /AbortController/);
  assert.match(controller, /Promise\.all\(\[listProjects/);
  assert.match(controller, /mutationChain/);
  assert.match(controller, /ACTIVE_PROJECT_STORAGE_KEY/);
  assert.match(controller, /await createProject\(input\).*setProjects\(\(current\)/s);
  assert.match(controller, /await createProjectFromGit\(input\)/);
  assert.match(controller, /setLastContextImport\(created\.contextImport \?\? null\)/);
  assert.match(controller, /configureAi/);
  assert.match(controller, /defaultAiProvider: provider/);
  assert.match(switcher, /role="dialog"/);
  assert.match(switcher, /event\.key === "Escape"/);
  assert.match(switcher, /Удалить только метаданные/);
  assert.match(switcher, /Correlation ID:/);
  assert.match(switcher, /disabled=\{controller\.mutationPending\}/);
  assert.match(switcher, /Клонировать Store/);
  assert.match(switcher, /git@github\.com:owner\/store\.git/);
  assert.match(switcher, /controller\.createFromGit/);
  assert.match(switcher, /Название, если нет манифеста/);
  assert.match(switcher, /\.openspec\/context\.yaml/);
  assert.match(switcher, /context\.repositories/);
  assert.match(switcher, /Контекст загружен частично/);
  assert.match(switcher, /lastContextImport\.imported/);
});

test("Git feature получает read-only status и показывает читаемый diff", async () => {
  const [client, controller, panel, workspace, sidebar, footer, diffParser] = await Promise.all([
    readFile(new URL("../features/git/api/git-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/git/hooks/useGitStatusController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/git/components/GitPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceFooter.tsx", import.meta.url), "utf8"),
    importTypeScript("../features/git/model/unified-diff.ts"),
  ]);
  assert.match(client, /getGitStatus/);
  assert.match(client, /\/git\/status/);
  assert.match(controller, /AbortController/);
  assert.match(controller, /getGitStatus/);
  assert.match(panel, /Изменения по строкам/);
  assert.match(panel, /git-diff-line/);
  assert.match(panel, /Изменений нет/);
  assert.match(panel, /Только просмотр/);
  assert.match(workspace, /useGitStatusController/);
  assert.match(workspace, /<GitPanel/);
  assert.match(sidebar, /onWorkspaceModeChange\("git"\)/);
  assert.doesNotMatch(sidebar, /Git-панель пока недоступна/);
  assert.doesNotMatch(footer, /Commit & Push/);

  const files = diffParser.parseUnifiedDiff(`# Unstaged
diff --git a/openspec/changes/example/design.md b/openspec/changes/example/design.md
index 123..456 100644
--- a/openspec/changes/example/design.md
+++ b/openspec/changes/example/design.md
@@ -4,2 +4,2 @@ Context
-old value
+new value
 unchanged`);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "openspec/changes/example/design.md");
  assert.equal(files[0].stage, "unstaged");
  assert.deepEqual(
    files[0].hunks[0].lines.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine })),
    [
      { kind: "deletion", oldLine: 4, newLine: undefined },
      { kind: "addition", oldLine: undefined, newLine: 4 },
      { kind: "context", oldLine: 5, newLine: 5 },
    ],
  );
});

test("agent CLI settings используют capabilities и сохранённые настройки проекта", async () => {
  const [header, workspace, controller] = await Promise.all([
    readFile(new URL("../features/workspace/components/WorkspaceHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/ai-operations/hooks/useAiOperationsController.ts", import.meta.url), "utf8"),
  ]);
  assert.match(header, /Настройка agent CLI/);
  assert.match(header, /availableProviders/);
  assert.match(header, /projects\.configureAi/);
  assert.match(header, /defaultAiProvider|selectedProvider/);
  assert.doesNotMatch(workspace, /defaultAiProvider \?\? "codex"/);
  assert.match(controller, /if \(!projectId \|\| !manifest \|\| !provider\) return/);
});

test("страница Контекст покрывает clone, SSE, cancel и server-backed состояние", async () => {
  const [client, controller, panel, sidebar, workspace, css, state] = await Promise.all([
    readFile(new URL("../features/repositories/api/repositories-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/repositories/hooks/useRepositoriesController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/repositories/components/RepositoriesPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
    importTypeScript("../features/repositories/model/repository-operation.ts"),
  ]);
  for (const method of ["listRepositories", "startRepositoryClone", "getRepositoryClone", "cancelRepositoryClone"]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(controller, /EventSource/);
  assert.match(controller, /setInterval/);
  assert.match(controller, /next\.errorCode/);
  assert.match(controller, /next\.errorMessage/);
  assert.match(controller, /next\.correlationId/);
  assert.match(panel, /Git URL/);
  assert.match(panel, /Git URL \(SSH\)/);
  assert.match(panel, /git@github\.com:owner\/repository\.git/);
  assert.doesNotMatch(panel, /Целевой каталог|targetPath/);
  assert.doesNotMatch(panel, /~\/\.osstudio/);
  assert.match(panel, /Отменить/);
  assert.match(panel, /Исправить и повторить/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-modal="true"/);
  assert.match(panel, /repository-connect-backdrop/);
  assert.match(panel, /event\.key === "Escape"/);
  assert.doesNotMatch(panel, /repository-connect-card/);
  assert.doesNotMatch(panel, /Подключить первый репозиторий/);
  assert.match(css, /\.repositories-panel-header > button:hover:not\(:disabled\),[\s\S]*color:\s*#fff/);
  assert.match(css, /\.repository-connect-backdrop \{[\s\S]*position:\s*absolute[\s\S]*z-index:\s*20/);
  assert.match(panel, /cloneRecoveryHint/);
  assert.match(panel, /Correlation ID:/);
  assert.match(panel, /КОНТЕКСТ ПРОЕКТА/);
  assert.match(panel, /Подключённые репозитории/);
  assert.match(panel, /read-only/);
  assert.match(panel, /disabled=\{controller\.loading/);
  assert.match(sidebar, /> Контекст <small>/);
  assert.match(sidebar, /onWorkspaceModeChange\("context"\)/);
  assert.match(sidebar, /disabled=\{!projectSelected\}/);
  assert.doesNotMatch(sidebar, /RepositoriesPanel/);
  assert.match(workspace, /activeWorkspaceMode === "context"/);
  assert.match(workspace, /projects\.activeProject \? workspaceMode : "documents"/);
  assert.match(workspace, /<RepositoriesPanel/);
  assert.equal(state.reduceCloneStatus("running", "progress"), "running");
  assert.equal(state.reduceCloneStatus("running", "validating"), "validating");
  assert.equal(state.isCloneTerminal("completed"), true);
  assert.match(state.cloneRecoveryHint("GIT_AUTH_FAILED"), /ssh-add -l/);
  assert.match(state.cloneRecoveryHint("SSH_HOST_KEY_FAILED"), /known_hosts/);
  assert.match(state.cloneRecoveryHint("INVALID_REPOSITORY"), /Git worktree/);
  assert.doesNotMatch(state.cloneRecoveryHint("INVALID_REPOSITORY"), /\.openspec-store|store-id|openspec\/config/);
});

test("documents feature читает дерево, содержимое и Git-историю и записывает файл через backend", async () => {
  const [client, controller, historyController, historyPanel, sidebar, editor, workspace] = await Promise.all([
    readFile(new URL("../features/documents/api/documents-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/documents/hooks/useDocumentsController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/documents/hooks/useDocumentHistoryController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/documents/components/DocumentHistoryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
  ]);
  for (const method of ["listDocuments", "getDocument", "getDocumentHistory", "writeDocument"]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(client, /URLSearchParams/);
  assert.match(client, /method: "PUT"/);
  assert.match(controller, /baseContentHash: contentHash/);
  assert.match(controller, /DRAFT_CONFLICT/);
  assert.match(controller, /window\.confirm/);
  assert.match(controller, /drafts\.current/);
  assert.match(client, /\/history\?\$\{query\}/);
  assert.match(historyController, /getDocumentHistory\(projectId, path, request\.signal\)/);
  assert.match(historyController, /history\.length > 0 \? "ready" : "empty"/);
  assert.match(historyController, /requestRef\.current\?\.abort\(\)/);
  assert.match(historyPanel, /role="dialog"/);
  assert.match(historyPanel, /В Git пока нет коммитов/);
  assert.match(historyPanel, /Correlation ID:/);
  assert.match(historyPanel, /последние 100 коммитов/);
  assert.match(sidebar, /navigationSections\.map/);
  assert.match(sidebar, /collectDocumentScopes\(documents\.items\)/);
  assert.match(sidebar, /documentScopes\.filter/);
  assert.match(sidebar, /scopeItems\.map/);
  assert.match(sidebar, /documents\.select\(item\.path\)/);
  assert.match(sidebar, /collapsedDirectories/);
  assert.match(sidebar, /documents\.retry/);
  assert.match(editor, /documents|documentStatus/);
  assert.match(editor, /Записать в файл/);
  assert.match(editor, /disabled=\{!canEdit\}/);
  assert.match(editor, /history\.show/);
  assert.match(workspace, /useDocumentsController/);
  assert.match(workspace, /useDocumentHistoryController/);
  assert.doesNotMatch(workspace, /workspace-data/);
});

test("платформенные shortcuts поддерживают macOS, Windows/Linux и удалённые клавиатуры", async () => {
  const shortcuts = await importTypeScript("../features/system/model/platform-shortcuts.ts");
  const macOS = { platform: "MacIntel" };
  const windows = { platform: "Win32" };
  const event = (overrides) => ({
    altKey: false,
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  });

  assert.equal(shortcuts.primaryShortcutLabel("s", macOS), "⌘S");
  assert.equal(shortcuts.primaryShortcutLabel("s", windows), "Ctrl+S");
  assert.equal(shortcuts.isSaveShortcut(event({ key: "s", metaKey: true }), macOS), true);
  assert.equal(shortcuts.isSaveShortcut(event({ key: "s", ctrlKey: true }), windows), true);
  assert.equal(shortcuts.isSaveShortcut(event({ key: "s", ctrlKey: true }), macOS), true);
  assert.equal(shortcuts.historyShortcut(event({ key: "z", metaKey: true }), macOS), "undo");
  assert.equal(shortcuts.historyShortcut(event({ key: "z", ctrlKey: true }), windows), "undo");
  assert.equal(shortcuts.historyShortcut(event({ key: "z", metaKey: true, shiftKey: true }), macOS), "redo");
  assert.equal(shortcuts.historyShortcut(event({ key: "y", ctrlKey: true }), windows), "redo");
  assert.equal(shortcuts.historyShortcut(event({ key: "z", altKey: true, ctrlKey: true }), windows), null);
});

test("AI operations feature требует review token и показывает review-ready diff", async () => {
  const [client, controller, panel, state] = await Promise.all([
    readFile(new URL("../features/ai-operations/api/ai-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/ai-operations/hooks/useAiOperationsController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/AiAssistantPanel.tsx", import.meta.url), "utf8"),
    importTypeScript("../features/ai-operations/model/ai-operation-state.ts"),
  ]);
  assert.match(client, /context-manifests/);
  assert.match(client, /reviewToken/);
  assert.match(controller, /EventSource/);
  assert.match(controller, /awaiting_review/);
  assert.match(panel, /Проверить контекст/);
  assert.match(panel, /AWAITING REVIEW/);
  assert.match(panel, /ai\.result\.files/);
  assert.match(panel, /entry\.included/);
  assert.match(panel, /maxTotalBytes/);
  assert.match(panel, /Correlation ID:/);
  assert.equal(state.reduceAiStatus("running", "provider_event"), "running");
  assert.equal(state.reduceAiStatus("running", "awaiting_review"), "awaiting_review");
  assert.equal(state.isAiTerminal("failed"), true);
});

test("OpenSpec workflow поддерживает read-only обзор, agent actions, stale refresh и полный review", async () => {
  const [client, controller, panel, workspace, sidebar, footer, state] = await Promise.all([
    readFile(new URL("../features/openspec-workflow/api/openspec-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/hooks/useOpenSpecWorkflowController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/OpenSpecPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceFooter.tsx", import.meta.url), "utf8"),
    importTypeScript("../features/openspec-workflow/model/openspec-state.ts"),
  ]);

  for (const method of [
    "getOpenSpecOverview", "getOpenSpecChange", "deleteOpenSpecChange", "validateOpenSpec", "startOpenSpecAction",
    "getOpenSpecOperation", "cancelOpenSpecOperation", "acceptOpenSpecOperation",
    "rejectOpenSpecOperation", "getOpenSpecDraft", "writeOpenSpecDraft",
  ]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(controller, /getOpenSpecOverview\(projectId/);
  assert.match(controller, /EventSource/);
  assert.match(controller, /setInterval/);
  assert.match(controller, /OPENSPEC_STATUS_STALE/);
  assert.match(controller, /setReloadVersion/);
  assert.match(controller, /validateOpenSpec/);
  assert.match(controller, /cancelOpenSpecOperation/);
  assert.match(controller, /acceptOpenSpecOperation/);
  assert.match(controller, /writeOpenSpecDraft/);
  assert.match(controller, /setDraft\(await writeOpenSpecDraft\(projectId, draft\.id\)\);[\s\S]*onStoreChanged\?\.\(\)/);
  assert.match(controller, /deleteOpenSpecChange/);
  assert.match(controller, /details\.fingerprint/);

  assert.match(panel, /Agent CLI не настроен\. Обзор и проверка доступны/);
  assert.match(panel, /Артефакты и зависимости/);
  assert.match(panel, /diagnostics\.map/);
  assert.match(panel, /Исправить через agent/);
  assert.match(panel, /fix_artifact/);
  assert.match(panel, /mutation\.type/);
  assert.match(panel, /create.*update.*delete.*rename/s);
  assert.match(panel, /Архивирование принимается только целиком/);
  assert.match(panel, /Принять весь набор/);
  assert.match(panel, /Записать .* изменений в Store/);
  assert.match(panel, /Удалить change/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /deletion\.files\.map/);
  assert.match(panel, /deleteConfirmation !== changeName/);
  assert.match(workspace, /useOpenSpecWorkflowController/);
  assert.match(workspace, /documents\.retry/);
  assert.match(workspace, /<OpenSpecPanel/);
  assert.match(workspace, /openSpecCreateDialogOpen/);
  assert.match(workspace, /onAddOpenSpecChange=\{addOpenSpecChange\}/);
  assert.match(panel, /createDialogOpen/);
  assert.match(panel, /onCreateDialogOpenChange/);
  assert.match(sidebar, /onWorkspaceModeChange\("openspec"\)/);
  assert.match(footer, /workspaceMode === "openspec"/);

  assert.equal(state.reduceOpenSpecOperationStatus("running", "provider_event"), "running");
  assert.equal(state.reduceOpenSpecOperationStatus("running", "validating"), "validating");
  assert.equal(state.reduceOpenSpecOperationStatus("validating", "awaiting_review"), "awaiting_review");
  assert.equal(state.isOpenSpecOperationTerminal("awaiting_review"), true);
  assert.equal(state.openSpecViewStatus("OPENSPEC_STATUS_STALE"), "stale");
  assert.equal(state.openSpecViewStatus("OPENSPEC_CLI_UNAVAILABLE"), "unavailable");
});

test("OpenSpec workflow проводит explore до создания change и показывает состояние валидации", async () => {
  const [model, controller, panel, css] = await Promise.all([
    readFile(new URL("../features/openspec-workflow/model/openspec-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/hooks/useOpenSpecWorkflowController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/OpenSpecPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(model, /"explore" \| "create_change"/);
  assert.match(model, /"idle" \| "checking" \| "valid" \| "invalid" \| "error"/);
  assert.match(controller, /const explore = useCallback/);
  assert.match(controller, /kind: "explore"/);
  assert.match(controller, /Результат обязательного explore/);
  assert.match(controller, /setSelectedChange\(operation\.openspecChange\)/);
  assert.match(controller, /setValidationStatus\("checking"\)/);
  assert.match(controller, /next\.valid \? "valid" : "invalid"/);
  assert.match(controller, /void validate\(false\)/);
  assert.match(controller, /operationElapsedSeconds/);
  assert.match(controller, /operationActivity/);
  assert.match(controller, /appendOperationActivity/);
  assert.match(controller, /operationStartInFlight/);
  assert.match(controller, /provider_event/);
  assert.match(controller, /Agent продолжает исследование/);

  assert.match(panel, /Добавить изменение/);
  assert.match(panel, /aria-labelledby="openspec-create-title"/);
  assert.match(panel, /1 · Исследование/);
  assert.match(panel, /Исследовать задачу/);
  assert.match(panel, /РЕЗУЛЬТАТ ИССЛЕДОВАНИЯ/);
  assert.match(panel, /Название изменения/);
  assert.match(panel, /Создать изменение/);
  assert.match(panel, /Следующий шаг|СЛЕДУЮЩИЙ ШАГ/);
  assert.match(panel, /Обновить спецификацию/);
  assert.match(panel, /Спецификация валидна/);
  assert.match(panel, /Готово к проверке/);
  assert.match(panel, /Требует исправления/);
  assert.match(panel, /без ограничения по времени/);
  assert.match(panel, /ХОД ИССЛЕДОВАНИЯ/);
  assert.match(panel, /без скрытых рассуждений, команд и содержимого файлов/);
  assert.match(panel, /exploreFailure/);
  assert.match(panel, /formatElapsedTime/);
  assert.match(css, /\.openspec-create-backdrop \{[^}]*position:\s*fixed[^}]*z-index:\s*85/s);
  assert.match(css, /\.openspec-create-dialog \{[^}]*width:\s*min\(680px, 100%\)/s);
  assert.match(css, /\.openspec-validation-badge\.status-valid/);
});

test("контекстная панель редактора запускает scoped редактирование OpenSpec через agent", async () => {
  const [richEditor, markdownEditor, workspace, controller, css, logic] = await Promise.all([
    readFile(new URL("../features/editor/components/RichMarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/hooks/useOpenSpecWorkflowController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
    importTypeScript("../features/openspec-workflow/model/openspec-document-action.ts"),
  ]);

  assert.match(richEditor, /addGroup\("agent", "Agent"\)/);
  assert.match(richEditor, /Редактировать изменение через agent/);
  assert.match(richEditor, /textBetween\(from, to, "\\n"\)/);
  assert.match(markdownEditor, /aria-labelledby="agent-edit-title"/);
  assert.match(markdownEditor, /Как изменить документ\?/);
  assert.match(markdownEditor, /Подготовить изменения/);
  assert.match(markdownEditor, /Перед записью вы увидите полный diff/);
  assert.match(workspace, /openSpec\.editDocument\(path, selection, instruction\)/);
  assert.match(workspace, /setWorkspaceMode\("openspec"\)/);
  assert.match(controller, /changeFromDocumentPath/);
  assert.match(controller, /actionMatchesDocument/);
  assert.match(controller, /kind: "fix_artifact"/);
  assert.match(controller, /statusFingerprint: current\.fingerprint/);
  assert.match(css, /\.agent-edit-dialog/);
  assert.equal(logic.changeFromDocumentPath("openspec/changes/add-report/design.md"), "add-report");
  assert.equal(logic.changeFromDocumentPath("openspec/changes/archive/2026-01-01-add-report/design.md"), null);
  assert.equal(logic.actionMatchesDocument({ outputPaths: ["openspec/changes/add-report/specs/**/*.md"] }, "openspec/changes/add-report/specs/report/spec.md"), true);
});
