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

test("считает выполненные задачи текущего tasks.md", async () => {
  const progress = await importTypeScript("../features/workspace/model/task-progress.ts");
  assert.equal(progress.isOpenSpecTasksPath("openspec/changes/add-proxy-log/tasks.md"), true);
  assert.equal(progress.isOpenSpecTasksPath("openspec/changes/add-proxy-log/design.md"), false);
  assert.deepEqual(progress.taskProgressFromMarkdown(`
- [x] Готово
  - [X] Также готово
* [ ] Осталось
- обычный пункт
- [invalid] не задача
`), { completed: 2, total: 3 });
});

test("разворачивает диапазоны Git-аннотаций в построчное представление", async () => {
  const annotations = await importTypeScript("../features/documents/model/document-annotations.ts");
  const lines = annotations.expandDocumentAnnotations([
    {
      startLine: 4,
      endLine: 5,
      hash: "abcdef123456",
      shortHash: "abcdef12",
      author: "devpav",
      authoredAt: "2026-07-02T10:00:00Z",
      subject: "update spec",
      lines: ["first", "second"],
      local: false,
    },
    {
      startLine: 6,
      endLine: 6,
      author: "Локальные изменения",
      subject: "Ещё не сохранено в Git",
      lines: ["local"],
      local: true,
    },
  ]);

  assert.deepEqual(lines.map((line) => line.lineNumber), [4, 5, 6]);
  assert.deepEqual(lines.map((line) => line.content), ["first", "second", "local"]);
  assert.deepEqual(lines.map((line) => line.groupStart), [true, false, true]);
  assert.equal(lines[0].author, "devpav");
  assert.equal(lines[2].local, true);
});

test("split diff выравнивает изменённые строки и считает добавления с удалениями", async () => {
  const diff = await importTypeScript("../features/openspec-workflow/model/split-line-diff.ts");
  const rows = diff.createSplitLineDiff(
    "one\nold\ntail",
    "one\nnew\nextra\ntail",
  );

  assert.deepEqual(rows.map((row) => row.kind), ["equal", "change", "add", "equal"]);
  assert.deepEqual(rows.map((row) => row.before?.lineNumber ?? null), [1, 2, null, 3]);
  assert.deepEqual(rows.map((row) => row.after?.lineNumber ?? null), [1, 2, 3, 4]);
  assert.equal(rows[1].before.text, "old");
  assert.equal(rows[1].after.text, "new");
  assert.equal(rows[2].after.text, "extra");
  assert.deepEqual(diff.summarizeSplitLineDiff(rows), { additions: 2, deletions: 1 });

  const created = diff.createSplitLineDiff("", "first\r\nsecond\r\n");
  assert.deepEqual(created.map((row) => row.kind), ["add", "add"]);
  assert.deepEqual(diff.summarizeSplitLineDiff(created), { additions: 2, deletions: 0 });

  const deleted = diff.createSplitLineDiff("first\nsecond\n", "");
  assert.deepEqual(deleted.map((row) => row.kind), ["remove", "remove"]);
  assert.deepEqual(diff.summarizeSplitLineDiff(deleted), { additions: 0, deletions: 2 });
});

test("Markdown presentation для diff форматирует блоки и оставляет HTML текстом", async () => {
  const markdown = await importTypeScript("../features/openspec-workflow/model/markdown-diff-presentation.ts");
  const lines = markdown.presentMarkdownDiff([
    "## План для `gateway`",
    "",
    "- [x] **Готовая** задача",
    "  - Вложенный пункт",
    "1. Первый шаг",
    "> Важное уточнение",
    "```kotlin",
    "val safe = \"<script>\"",
    "```",
  ].join("\n"));

  assert.equal(lines[0].kind, "heading");
  assert.equal(lines[0].level, 2);
  assert.deepEqual(lines[0].inline, [
    { kind: "text", text: "План для " },
    { kind: "code", text: "gateway", target: undefined },
  ]);
  assert.equal(lines[1].kind, "blank");
  assert.equal(lines[2].kind, "task");
  assert.equal(lines[2].checked, true);
  assert.deepEqual(lines[2].inline, [{ kind: "strong", text: "Готовая", target: undefined }, { kind: "text", text: " задача" }]);
  assert.deepEqual({ kind: lines[3].kind, indent: lines[3].indent }, { kind: "unordered-list", indent: 2 });
  assert.deepEqual({ kind: lines[4].kind, prefix: lines[4].prefix }, { kind: "ordered-list", prefix: "1." });
  assert.equal(lines[5].kind, "quote");
  assert.deepEqual(lines.slice(6).map((line) => line.kind), ["code-fence", "code", "code-fence"]);
  assert.equal(lines[6].language, "kotlin");
  assert.equal(lines[7].text, 'val safe = "<script>"');

  assert.deepEqual(markdown.tokenizeMarkdownDiffInline("[Документ](https://example.test) и ~~старое~~"), [
    { kind: "link", text: "Документ", target: "https://example.test" },
    { kind: "text", text: " и " },
    { kind: "strike", text: "старое", target: undefined },
  ]);
});

test("каскад пересогласования проходит specs, design и tasks и безопасно прерывается", async () => {
  const cascade = await importTypeScript("../features/openspec-workflow/model/artifact-refresh-cascade.ts");
  let state = cascade.createOpenSpecArtifactRefreshCascade("add-proxy-log", "spec");

  assert.equal(state.current, "specs");
  assert.equal(cascade.openSpecArtifactRefreshActionArtifact(state), "spec");
  state = cascade.bindOpenSpecArtifactRefreshOperation(state, "operation-specs");
  assert.equal(cascade.openSpecArtifactRefreshMatchesOperation(state, {
    id: "operation-specs",
    change: "add-proxy-log",
    artifact: "specs",
  }), true);
  assert.equal(cascade.openSpecArtifactRefreshMatchesOperation(state, {
    id: "old-operation",
    change: "add-proxy-log",
    artifact: "specs",
  }), false);

  state = cascade.advanceOpenSpecArtifactRefreshCascade(state);
  assert.deepEqual(state.completed, ["specs"]);
  assert.equal(state.current, "design");
  state = cascade.advanceOpenSpecArtifactRefreshCascade(state);
  assert.equal(state.current, "tasks");
  state = cascade.advanceOpenSpecArtifactRefreshCascade(state);
  assert.equal(state.status, "complete");
  assert.deepEqual(state.completed, ["specs", "design", "tasks"]);

  let designOnly = cascade.createOpenSpecArtifactRefreshCascade("add-proxy-log", "specs", false);
  assert.deepEqual(designOnly.steps, ["specs", "design"]);
  designOnly = cascade.advanceOpenSpecArtifactRefreshCascade(designOnly);
  assert.equal(designOnly.current, "design");
  designOnly = cascade.advanceOpenSpecArtifactRefreshCascade(designOnly);
  assert.equal(designOnly.status, "complete");
  assert.deepEqual(designOnly.completed, ["specs", "design"]);

  const interrupted = cascade.interruptOpenSpecArtifactRefreshCascade(
    cascade.createOpenSpecArtifactRefreshCascade("add-proxy-log", "specs"),
    "Результат отклонён",
  );
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.reason, "Результат отклонён");
  assert.equal(cascade.openSpecArtifactRefreshMatchesOperation(interrupted, {
    change: "add-proxy-log",
    artifact: "specs",
  }), false);
  const resumed = cascade.resumeOpenSpecArtifactRefreshCascade(interrupted);
  assert.equal(resumed.status, "active");
  assert.equal(resumed.reason, undefined);
  assert.match(cascade.openSpecArtifactRefreshGoal("specs"), /актуализируй proposal\.md/);
  assert.match(cascade.openSpecArtifactRefreshGoal("specs"), /только proposal\.md и delta specs/);
  assert.equal(cascade.openSpecArtifactRefreshStepLabel("specs"), "proposal.md + diff specs");
  assert.match(cascade.openSpecArtifactRefreshGoal("tasks"), /Сохраняй отметку \[x\] только/);
  assert.match(cascade.openSpecArtifactRefreshGoal("tasks"), /Не считай change реализованным/);
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

test("низкоуровневый Git feature остаётся доступен как внутренняя диагностика, но скрыт из основного workspace", async () => {
  const [client, controller, panel, changesPanel, operationModel, workspace, sidebar, footer, diffParser] = await Promise.all([
    readFile(new URL("../features/git/api/git-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/git/hooks/useGitStatusController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/git/components/GitPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/git/components/GitChangesPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/git/model/git-operation.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceFooter.tsx", import.meta.url), "utf8"),
    importTypeScript("../features/git/model/unified-diff.ts"),
  ]);
  assert.match(client, /getGitStatus/);
  assert.match(client, /projectGitPath\(projectId, "status"\)/);
  assert.match(client, /stageGitPaths/);
  assert.match(client, /unstageGitPaths/);
  assert.match(client, /createGitCommit/);
  assert.match(client, /switchGitBranch/);
  assert.match(client, /startGitFetch/);
  assert.match(client, /startGitPush/);
  assert.match(client, /cancelGitOperation/);
  assert.match(controller, /AbortController/);
  assert.match(controller, /getGitStatus/);
  assert.match(controller, /setInterval/);
  assert.match(controller, /isGitOperationTerminal/);
  assert.match(controller, /setVersion/);
  assert.match(operationModel, /queued/);
  assert.match(operationModel, /cancelled/);
  assert.match(panel, /DIFF PREVIEW/);
  assert.match(panel, /effectiveActivePath/);
  assert.match(panel, /git-diff-line/);
  assert.match(panel, /buildSplitDiffRows/);
  assert.match(panel, /До изменения/);
  assert.match(panel, /Текущая версия/);
  assert.match(panel, /GitChangesPanel/);
  assert.match(changesPanel, /aria-label="Изменения Git"/);
  assert.match(changesPanel, /Рабочее дерево чистое/);
  assert.match(changesPanel, /Staged/);
  assert.match(changesPanel, /Unstaged/);
  assert.match(changesPanel, /Фильтр Git-изменений/);
  assert.match(changesPanel, /Stage/);
  assert.match(changesPanel, /Unstage/);
  assert.match(changesPanel, /Commit message/);
  assert.match(panel, /Fetch/);
  assert.match(panel, /Push & set upstream/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /event\.key === "Escape"/);
  assert.match(panel, /gitRecoveryHint/);
  assert.doesNotMatch(panel, /Только просмотр · commit/);
  assert.doesNotMatch(workspace, /useGitStatusController/);
  assert.doesNotMatch(workspace, /<GitPanel/);
  assert.doesNotMatch(sidebar, /onWorkspaceModeChange\("git"\)/);
  assert.doesNotMatch(sidebar, /Git-панель пока недоступна/);
  assert.doesNotMatch(footer, /Git|Commit & Push/);

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

test("task context связывает workspace с задачей и публикует только OpenSpec-артефакты", async () => {
  const [client, controller, selector, dialog, workspace, header, documents, types, footer, css] = await Promise.all([
    readFile(new URL("../features/task-context/api/task-context-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/task-context/hooks/useTaskContextController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/task-context/components/TaskContextSelector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/task-context/components/PublicationDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/documents/hooks/useDocumentsController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/model/workspace-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceFooter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  for (const method of ["getTaskWorkspaces", "openTaskWorkspace", "syncTaskWorkspace", "previewTaskPublication", "generateTaskPublicationMessage", "publishTaskArtifacts"]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(client, /task-publications\/preview/);
  assert.match(client, /task-publications\/message/);
  assert.match(client, /task-workspaces\/sync/);
  assert.match(controller, /setOverview\(await openTaskWorkspace/);
  assert.match(controller, /await syncTaskWorkspace\(projectId\)/);
  assert.match(controller, /setSyncing\(true\)/);
  assert.match(controller, /setPreview\(await previewTaskPublication/);
  assert.match(controller, /generateTaskPublicationMessage\(projectId, preview\.token\)/);
  assert.match(controller, /token: preview\.token/);
  assert.match(selector, /Номер задачи или ветка/);
  assert.match(selector, /active\?\.branch/);
  assert.match(selector, /className="task-branch-icon"[\s\S]*aria-hidden="true"/);
  assert.match(selector, /className="task-context-branch"/);
  assert.match(selector, /aria-label=\{triggerLabel\}/);
  assert.doesNotMatch(selector, /task-context-icon|task-context-copy|РАБОЧИЙ КОНТЕКСТ|Изменения каждой задачи сохраняются отдельно/);
  assert.doesNotMatch(selector, /статус задачи|workflow/i);
  assert.match(css, /\.task-context-trigger \{[^}]*height:\s*34px[^}]*border:\s*0[^}]*background:\s*transparent/s);
  assert.match(css, /\.task-branch-icon \{[^}]*width:\s*14px[^}]*stroke:\s*#718079/s);
  assert.match(css, /\.task-context-branch \{[^}]*font:\s*650 13px var\(--font-ui\)/s);
  assert.match(css, /\.task-context-popover \{[^}]*width:\s*312px/s);
  assert.match(dialog, /Опубликовать артефакты/);
  assert.match(dialog, /предложено агентом/);
  assert.match(dialog, /Сгенерировать/);
  assert.match(dialog, /controller\.generating/);
  assert.match(dialog, /<textarea rows=\{6\}/);
  assert.match(dialog, /preview\.excludedCount/);
  assert.match(workspace, /useTaskContextController/);
  assert.match(workspace, /workspaceContext/);
  assert.match(workspace, /result\.updated\) retryDocuments\(\)/);
  assert.match(documents, /item\.kind === "file" && item\.path === requestedPath/);
  assert.match(workspace, /<PublicationDialog/);
  assert.match(header, /<div className="task-context-publish-group">\s*<TaskContextSelector[\s\S]*className="publish-icon-button"[\s\S]*<\/div>\s*<div className="workspace-status">/);
  assert.doesNotMatch(header, /<div className="workspace-status">[\s\S]*className="publish-icon-button"/);
  assert.match(header, /aria-label=\{tasks\.preparing \? "Готовим публикацию" : "Опубликовать артефакты текущей задачи"\}/);
  assert.match(header, /Получить изменения текущей задачи из remote/);
  assert.match(header, /onClick=\{onReceive\}/);
  assert.doesNotMatch(header, /className="publish-button"/);
  assert.match(css, /\.task-context-publish-group \{[^}]*display:\s*flex[^}]*gap:\s*2px/s);
  assert.match(css, /\.publish-icon-button \{[^}]*width:\s*32px[^}]*background:\s*transparent/s);
  assert.match(documents, /loadedWorkspaceContext/);
  assert.doesNotMatch(types, /"git"/);
  assert.match(footer, /изменения разделены по задачам/);
});

test("agent CLI settings используют capabilities и сохранённые настройки проекта", async () => {
  const [header, panel, customSelect, workspace, controller] = await Promise.all([
    readFile(new URL("../features/workspace/components/WorkspaceHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/AgentCliPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/CustomSelect.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/ai-operations/hooks/useAiOperationsController.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /Настройка Agent CLI/);
  assert.match(header, /availableProviders/);
  assert.match(panel, /projects\.configureAi/);
  assert.match(panel, /defaultAiProvider|selectedProvider/);
  assert.match(panel, /availableModels/);
  assert.match(panel, /доступно/);
  assert.match(panel, /недоступна/);
  assert.match(panel, /<CustomSelect ariaLabel="Модель"/);
  assert.doesNotMatch(panel, /<select/);
  assert.doesNotMatch(panel, /Каталог .* CLI|CLI не предоставил каталог моделей|provider-model-hint/);
  assert.match(customSelect, /aria-haspopup="listbox"/);
  assert.match(customSelect, /ArrowDown|ArrowUp/);
  assert.match(await readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"), /\.agent-cli-form \{[^}]*flex:\s*1 1 auto/s);
  assert.match(workspace, /agentSettingsOpen/);
  assert.match(workspace, /\)\}\s*\{agentSettingsOpen && <AgentCliPanel/s);
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
  for (const method of [
    "listRepositories", "switchRepositoryBranch", "updateRepository",
    "startRepositoryClone", "getRepositoryClone", "cancelRepositoryClone",
  ]) {
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
  assert.match(panel, /Ветка репозитория/);
  assert.match(panel, /Локальные ветки/);
  assert.match(panel, /Remote branches/);
  assert.match(panel, /Получить обновления/);
  assert.match(panel, /AI: read-only/);
  assert.match(controller, /switchRepositoryBranch/);
  assert.match(controller, /updateRepository/);
  assert.match(controller, /busyRepositoryId/);
  assert.match(state.cloneRecoveryHint("WORKTREE_DIRTY"), /без локальных изменений/);
  assert.match(state.cloneRecoveryHint("GIT_FAST_FORWARD_REQUIRED"), /Разрешите расхождение/);
  assert.match(css, /\.repository-card-controls \{[\s\S]*grid-template-columns/);
  assert.match(css, /\.repository-update-button/);
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
  for (const method of ["listDocuments", "getDocument", "getDocumentAnnotations", "getDocumentHistory", "writeDocument"]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(client, /URLSearchParams/);
  assert.match(client, /method: "PUT"/);
  assert.match(controller, /baseContentHash: contentHash/);
  assert.match(controller, /const savedMarkdown = markdown/);
  assert.match(controller, /latest\.selectedPath !== savedPath/);
  assert.match(controller, /current === savedMarkdown \? document\.content : current/);
  assert.match(controller, /DRAFT_CONFLICT/);
  assert.match(controller, /window\.confirm/);
  assert.match(controller, /drafts\.current/);
  assert.match(client, /\/history\?\$\{query\}/);
  assert.match(client, /\/annotations\?\$\{query\}/);
  assert.match(historyController, /getDocumentAnnotations\(projectId, path, request\.signal\)/);
  assert.match(historyController, /getDocumentHistory\(projectId, path, request\.signal\)/);
  assert.match(historyController, /annotationItems\.length > 0 \|\| history\.length > 0 \? "ready" : "empty"/);
  assert.match(historyController, /requestRef\.current\?\.abort\(\)/);
  assert.match(historyPanel, /role="dialog"/);
  assert.match(historyPanel, /В Git пока нет коммитов/);
  assert.match(historyPanel, /Git-аннотации/);
  assert.match(historyPanel, /Локальные изменения|Локально/);
  assert.match(historyPanel, /Построчные Git-аннотации/);
  assert.match(historyPanel, /formatAnnotationDate\(entry\.authoredAt\)/);
  assert.match(historyPanel, /entry\.content \|\| " "/);
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
  assert.match(workspace, /DOCUMENT_AUTOSAVE_DELAY_MS = 3_000/);
  assert.match(workspace, /window\.setTimeout\(\(\) => \{\s*void persistFile\(false\);\s*\}, DOCUMENT_AUTOSAVE_DELAY_MS\)/s);
  assert.match(workspace, /documents\.status !== "ready"/);
  assert.match(workspace, /documents\.saving/);
  assert.match(workspace, /documents\.conflict/);
  assert.match(workspace, /window\.clearTimeout\(timer\)/);
  assert.match(workspace, /persistFile\(true\)/);
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
  const [client, controller, state] = await Promise.all([
    readFile(new URL("../features/ai-operations/api/ai-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/ai-operations/hooks/useAiOperationsController.ts", import.meta.url), "utf8"),
    importTypeScript("../features/ai-operations/model/ai-operation-state.ts"),
  ]);
  assert.match(client, /context-manifests/);
  assert.match(client, /reviewToken/);
  assert.match(controller, /EventSource/);
  assert.match(controller, /awaiting_review/);
  assert.equal(state.reduceAiStatus("running", "provider_event"), "running");
  assert.equal(state.reduceAiStatus("running", "awaiting_review"), "awaiting_review");
  assert.equal(state.isAiTerminal("failed"), true);
});

test("OpenSpec workflow поддерживает read-only обзор, agent actions, stale refresh и полный review", async () => {
  const [client, controller, panel, operationPanel, documentActions, actionPresentation, actionPresentationState, workspace, sidebar, footer, state] = await Promise.all([
    readFile(new URL("../features/openspec-workflow/api/openspec-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/hooks/useOpenSpecWorkflowController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/OpenSpecPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/OpenSpecOperationPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/OpenSpecDocumentActions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/model/openspec-action-presentation.ts", import.meta.url), "utf8"),
    importTypeScript("../features/openspec-workflow/model/openspec-action-presentation.ts"),
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
  assert.match(controller, /name === "awaiting_review"\) setOperationDialogOpen\(true\)/);
  assert.match(controller, /const writtenDraft = await writeOpenSpecDraft\(projectId, draft\.id\);[\s\S]*setDraft\(writtenDraft\);[\s\S]*onStoreChanged\?\.\(operation \?\? undefined\)/);
  assert.match(controller, /deleteOpenSpecChange/);
  assert.match(controller, /details\.fingerprint/);
  assert.match(controller, /runArtifactAction = useCallback/);
  assert.match(controller, /latest = await getOpenSpecChange\(projectId, change\)/);
  assert.match(controller, /statusFingerprint: latest\.fingerprint/);
  assert.match(controller, /startArtifactRefresh = useCallback/);
  assert.match(controller, /advanceOpenSpecArtifactRefreshCascade/);
  assert.match(controller, /openSpecArtifactRefreshCascadeGoal\(nextCascade\)/);
  assert.match(controller, /interruptOpenSpecArtifactRefreshCascade/);
  assert.match(controller, /retryArtifactRefresh = useCallback/);
  assert.match(controller, /resumeOpenSpecArtifactRefreshCascade/);

  assert.match(panel, /Agent CLI не настроен\. Обзор и проверка доступны/);
  assert.match(panel, /Артефакты и зависимости/);
  assert.match(panel, /diagnostics\.map/);
  assert.match(panel, /Исправить через agent/);
  assert.match(panel, /fix_artifact/);
  assert.match(panel, /<OpenSpecOperationPanel controller=\{controller\}/);
  assert.match(operationPanel, /mutation\.type/);
  assert.match(operationPanel, /create.*update.*delete.*rename/s);
  assert.match(operationPanel, /Архивирование принимается только целиком/);
  assert.match(operationPanel, /Принять весь набор/);
  assert.match(operationPanel, /Записать .* изменений в Store/);
  assert.match(panel, /Удалить change/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /deletion\.files\.map/);
  assert.match(panel, /deleteConfirmation !== changeName/);
  assert.match(workspace, /useOpenSpecWorkflowController/);
  assert.match(workspace, /documents\.retry/);
  assert.match(workspace, /const retryDocuments = documents\.retry;[\s\S]*const refreshTasks = tasks\.refresh;[\s\S]*const refreshStoreState = useCallback\(\(operation\?:[\s\S]*retryDocuments\(\);\s*refreshTasks\(\);/);
  assert.match(workspace, /useOpenSpecWorkflowController\([\s\S]*refreshStoreState,\s*workspaceContext/);
  assert.match(workspace, /<OpenSpecPanel/);
  assert.match(workspace, /openSpecCreationPageOpen/);
  assert.match(workspace, /onAddOpenSpecChange=\{addOpenSpecChange\}/);
  assert.match(workspace, /changeDocumentContextFromPath/);
  assert.match(workspace, /\(proposal\|design\)\\\.md/);
  assert.match(workspace, /documentArtifact=\{changeDocument\.artifact\}/);
  assert.match(workspace, /<OpenSpecDocumentAction/);
  assert.match(workspace, /<OpenSpecDocumentReview/);
  assert.doesNotMatch(workspace, /continueOpenSpecChange|setWorkspaceMode\("openspec"\).*runArtifactAction/s);
  assert.match(documentActions, /documentDirty && !await onSave\(\)/);
  assert.match(documentActions, /controller\.runArtifactAction\(change, action\.artifact/);
  assert.match(documentActions, /openSpecArtifactRefreshGoal\("specs"\)/);
  assert.match(documentActions, /const downstreamCreated = designCreated \|\| tasksCreated/);
  assert.match(documentActions, /documentArtifact === "proposal" && downstreamCreated/);
  assert.match(documentActions, /Пересогласовать артефакты change\?/);
  assert.match(documentActions, /Создать новый change/);
  assert.match(documentActions, /Принять риск и обновить/);
  assert.match(documentActions, /controller\.startArtifactRefresh\([\s\S]*change,[\s\S]*action\.artifact,[\s\S]*tasksCreated,[\s\S]*proposalCommentsGoal\(proposalComments\)/);
  assert.match(documentActions, /proposal\.md \+ diff specs/);
  assert.match(documentActions, /openSpecDocumentActions\(controller\.details, hasSpecs, documentArtifact\)/);
  assert.match(documentActions, /actions\.map\(\(\{ action, label, primary \}\)/);
  assert.match(documentActions, /Загружаем состояние change/);
  assert.match(documentActions, /<OpenSpecOperationPanel\s+controller=\{controller\}/);
  assert.match(documentActions, /controller\.operationDialogOpen/);
  assert.match(documentActions, /Просмотреть результат/);
  assert.match(documentActions, /selectedOperation && selectedOperation\.status !== "accepted"/);
  assert.match(documentActions, /Показать историю операций изменения/);
  assert.match(documentActions, /className="openspec-operations-open-icon"/);
  assert.match(documentActions, /className="openspec-operations-open-label">История/);
  assert.match(documentActions, /Всего операций:/);
  assert.match(operationPanel, /createSplitLineDiff/);
  assert.match(operationPanel, /summarizeSplitLineDiff/);
  assert.match(operationPanel, /presentMarkdownDiff/);
  assert.match(operationPanel, /function MarkdownDiffLine/);
  assert.match(operationPanel, /function OperationConclusion/);
  assert.match(operationPanel, /const \[collapsed, setCollapsed\] = useState\(false\)/);
  assert.match(operationPanel, /className="openspec-mutation-toggle"/);
  assert.match(operationPanel, /aria-expanded=\{!collapsed\}/);
  assert.match(operationPanel, /aria-controls=\{contentId\}/);
  assert.match(operationPanel, /!collapsed &&/);
  assert.match(operationPanel, /className="openspec-operation-conclusion"/);
  assert.match(operationPanel, /<OperationConclusion markdown=\{controller\.result\.finalResponse\}/);
  assert.doesNotMatch(operationPanel, /<p>\{controller\.result\.finalResponse\}<\/p>/);
  assert.match(operationPanel, /className="openspec-split-diff"/);
  assert.doesNotMatch(operationPanel, /openspec-split-diff-number|openspec-split-diff-marker/);
  assert.match(operationPanel, /openspec-mutation-summary/);
  assert.doesNotMatch(operationPanel, /Markdown до изменения|Markdown после изменения|<textarea/);
  assert.match(operationPanel, /Принять весь набор/);
  assert.doesNotMatch(operationPanel, /Planning-артефакты согласованы/);
  assert.doesNotMatch(operationPanel, /завершится только после выполнения всех актуальных пунктов tasks\.md/);
  assert.doesNotMatch(operationPanel, /Повторить текущий этап/);
  assert.match(operationPanel, /aria-label="Этапы пересогласования"/);
  assert.match(actionPresentation, /Сформировать specs/);
  assert.match(actionPresentation, /Обновить specs/);
  assert.match(actionPresentation, /Сформировать design/);
  assert.match(actionPresentation, /Создать design\.md/);
  assert.doesNotMatch(actionPresentation, /Обновить design\.md/);
  assert.match(actionPresentation, /label: "Обновить"/);
  assert.match(actionPresentation, /Создать tasks\.md/);
  assert.match(actionPresentation, /Обновить tasks\.md/);
  assert.match(actionPresentation, /if \(!specsDone\)/);
  assert.doesNotMatch(actionPresentation, /next\.artifact === "tasks"/);
  const artifactAction = (artifact, available = true) => ({ kind: "prepare_artifact", artifact, available });
  const documentActionDetails = (statuses) => ({
    actions: [artifactAction("specs"), artifactAction("design"), artifactAction("tasks", statuses.design === "done")],
    artifacts: Object.entries(statuses).map(([id, status]) => ({ id, status })),
  });
  assert.deepEqual(
    actionPresentationState.openSpecDocumentActions(documentActionDetails({ proposal: "done", specs: "ready", design: "blocked", tasks: "blocked" }), false)
      .map(({ label, primary }) => ({ label, primary })),
    [{ label: "Сформировать specs", primary: true }],
  );
  assert.deepEqual(
    actionPresentationState.openSpecDocumentActions(documentActionDetails({ proposal: "done", specs: "done", design: "ready", tasks: "blocked" }), true)
      .map(({ label, primary }) => ({ label, primary })),
    [{ label: "Обновить", primary: false }, { label: "Создать design.md", primary: true }],
  );
  assert.deepEqual(
    actionPresentationState.openSpecDocumentActions(documentActionDetails({ proposal: "done", specs: "done", design: "done", tasks: "ready" }), true)
      .map(({ label, primary }) => ({ label, primary })),
    [{ label: "Обновить", primary: false }],
  );
  assert.deepEqual(
    actionPresentationState.openSpecDocumentActions(documentActionDetails({ proposal: "done", specs: "done", design: "done", tasks: "ready" }), true, "design")
      .map(({ label, primary }) => ({ label, primary })),
    [{ label: "Создать tasks.md", primary: true }],
  );
  assert.deepEqual(
    actionPresentationState.openSpecDocumentActions(documentActionDetails({ proposal: "done", specs: "done", design: "done", tasks: "done" }), true, "design")
      .map(({ label, primary }) => ({ label, primary })),
    [{ label: "Обновить tasks.md", primary: true }],
  );
  assert.match(panel, /<ChangeCreationWizard/);
  assert.match(panel, /useChangeCreationController\(projectId\)/);
  assert.match(panel, /onCreationPageOpenChange/);
  assert.match(panel, /defaultOpenSpecActionGoal/);
  assert.match(panel, /Дополнительные указания для agent/);
  assert.match(panel, /Без текста Agent использует актуальный proposal/);
  assert.doesNotMatch(panel, /needsAgent && !goal\.trim\(\)/);
  assert.match(sidebar, /onWorkspaceModeChange\("openspec"\)/);
  assert.match(footer, /workspaceMode === "openspec"/);

  assert.equal(state.reduceOpenSpecOperationStatus("running", "provider_event"), "running");
  assert.equal(state.reduceOpenSpecOperationStatus("running", "validating"), "validating");
  assert.equal(state.reduceOpenSpecOperationStatus("validating", "awaiting_review"), "awaiting_review");
  assert.equal(state.isOpenSpecOperationTerminal("awaiting_review"), true);
  assert.equal(state.openSpecViewStatus("OPENSPEC_STATUS_STALE"), "stale");
  assert.equal(state.openSpecViewStatus("OPENSPEC_CLI_UNAVAILABLE"), "unavailable");
});

test("OpenSpec workflow проводит управляемые AI-итерации до proposal и создаёт change только после подтверждения", async () => {
  const [model, controller, panel, operationPanel, wizard, creationController, client, workspace, css, state] = await Promise.all([
    readFile(new URL("../features/openspec-workflow/model/openspec-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/hooks/useOpenSpecWorkflowController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/OpenSpecPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/OpenSpecOperationPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/ChangeCreationWizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/hooks/useChangeCreationController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/api/openspec-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
    importTypeScript("../features/openspec-workflow/model/change-creation-state.ts"),
  ]);

  assert.match(model, /"explore" \| "create_change"/);
  assert.match(model, /"intent" \| "clarifying" \| "proposal" \| "naming" \| "creating"/);
  assert.match(model, /exploration\?: OpenSpecExplorationResult/);
  assert.match(model, /"idle" \| "checking" \| "valid" \| "invalid" \| "error"/);
  assert.match(controller, /const explore = useCallback/);
  assert.match(controller, /kind: "explore"/);
  assert.match(controller, /createChange = useCallback\(async \(change: string, proposal: string\)/);
  assert.match(controller, /kind:\s*"create_change",\s*change,\s*proposal/);
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

  assert.match(panel, /Создать change/);
  assert.doesNotMatch(panel, /className="openspec-add-change"/);
  assert.doesNotMatch(css, /\.openspec-panel-header \.openspec-add-change/);
  assert.match(panel, /ChangeCreationWizard/);
  assert.match(wizard, /aria-labelledby="change-creation-title"/);
  assert.match(wizard, /className="openspec-panel change-creation-page"/);
  assert.match(wizard, /Вернуться к списку изменений/);
  assert.doesNotMatch(wizard, /role="dialog"|aria-modal="true"|change-creation-backdrop/);
  assert.match(wizard, /Опишите замысел/);
  assert.match(wizard, /READ-ONLY ИССЛЕДОВАНИЕ/);
  assert.match(wizard, /Ответьте на важные вопросы/);
  assert.match(wizard, /Продолжить с допущениями/);
  assert.match(wizard, /ИССЛЕДОВАНИЕ НЕ ЗАВЕРШЕНО/);
  assert.match(wizard, /Повторить анализ/);
  assert.match(wizard, /Проверяем proposal/);
  assert.match(wizard, /Что нужно скорректировать\?/);
  assert.match(wizard, /Назовите изменение/);
  assert.match(wizard, /suggestedNames\.map/);
  assert.match(wizard, /Подготовить change/);
  assert.match(wizard, /Записать change в Store/);
  assert.match(wizard, /onCreated\(`openspec\/changes\/\$\{name\}\/proposal\.md`\)/);
  assert.match(creationController, /setTimeout\(\(\) => \{/);
  assert.match(creationController, /saveChangeCreationDraft/);
  assert.match(creationController, /deleteChangeCreationDraft/);
  for (const method of ["getChangeCreationDraft", "saveChangeCreationDraft", "deleteChangeCreationDraft"]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(workspace, /pendingDocumentPath/);
  assert.match(workspace, /selectDocument\(pendingDocumentPath\)/);
  assert.match(workspace, /onChangeCreated=\{openCreatedChange\}/);
  assert.match(panel, /Следующий шаг|СЛЕДУЮЩИЙ ШАГ/);
  assert.match(workspace, /OpenSpecDocumentAction/);
  assert.match(panel, /Спецификация валидна/);
  assert.match(operationPanel, /Готово к проверке/);
  assert.match(panel, /Требует исправления/);
  assert.match(wizard, /formatElapsedTime/);
  assert.match(css, /\.change-creation-page \{[^}]*height:\s*100%[^}]*grid-template-rows:/s);
  assert.doesNotMatch(css, /\.change-creation-backdrop|\.change-creation-wizard/);
  assert.match(css, /\.change-creation-grid \{[^}]*grid-template-columns:/s);
  assert.match(css, /\.openspec-validation-badge\.status-valid/);

  const empty = state.emptyChangeCreationDraft();
  assert.equal(empty.stage, "intent");
  const researched = state.applyExplorationResult({ ...empty, intent: "Новый workflow" }, {
    state: "needs_input",
    summary: "Нужно уточнить scope",
    questions: [{ id: "scope", prompt: "Какой scope?", kind: "single_choice", options: ["A", "B"] }],
    assumptions: [],
    suggestedNames: [],
  });
  assert.equal(researched.stage, "clarifying");
  const withAnswer = { ...researched, answers: { scope: ["A"] } };
  assert.match(state.buildCreationHandoff(withAnswer), /ВОПРОСЫ И ОТВЕТЫ/);
  assert.match(state.buildCreationHandoff(withAnswer), /"A"/);
  const proposal = state.applyExplorationResult(withAnswer, {
    state: "proposal_ready",
    summary: "Scope согласован",
    questions: [],
    assumptions: ["Сохраняем draft"],
    proposal: "# Why\n\nНовый workflow",
    suggestedNames: ["add-guided-change"],
  });
  assert.equal(proposal.stage, "proposal");
  assert.equal(proposal.changeName, "add-guided-change");
  assert.equal(state.isValidChangeName("add-guided-change"), true);
  assert.equal(state.isValidChangeName("Guided Change"), false);
  const invalidated = state.invalidateCreationResearch(proposal, "Изменённый замысел");
  assert.equal(invalidated.stage, "intent");
  assert.equal(invalidated.proposal, undefined);
});

test("proposal.md хранит видимые комментарии к фрагментам и применяет их через полное обновление", async () => {
  const [richEditor, markdownEditor, workspace, controller, documentActions, css, logic, commentModel] = await Promise.all([
    readFile(new URL("../features/editor/components/RichMarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/hooks/useOpenSpecWorkflowController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/openspec-workflow/components/OpenSpecDocumentActions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
    importTypeScript("../features/openspec-workflow/model/openspec-document-action.ts"),
    importTypeScript("../features/editor/model/fragment-comment.ts"),
  ]);

  assert.match(richEditor, /selectionchange/);
  assert.match(richEditor, /container\.closest\("\.cm-content"\)/);
  assert.match(richEditor, /Добавить комментарий к выделенному фрагменту/);
  assert.match(richEditor, /editor-comment-highlight/);
  assert.match(richEditor, /editor-fragment-comments/);
  assert.match(richEditor, /onDeleteComment/);
  assert.match(richEditor, /textBetween\(from, to, "\\n"\)/);
  assert.match(richEditor, /candidate\.prefix = view\.state\.doc\.textBetween\(0, from, "\\n"\)/);
  assert.match(richEditor, /candidate\.suffix = view\.state\.doc\.textBetween\(to, view\.state\.doc\.content\.size, "\\n"\)/);
  assert.match(markdownEditor, /onAddComment/);
  assert.match(workspace, /proposalCommentsStorageKey/);
  assert.match(workspace, /pendingCommentUpdatePath/);
  assert.match(workspace, /clearFragmentComments/);
  assert.match(documentActions, /proposalCommentsGoal\(proposalComments\)/);
  assert.match(documentActions, /controller\.startArtifactRefresh/);
  assert.doesNotMatch(controller, /editDocument|mode: "inline"|createAiOperation/);
  assert.doesNotMatch(richEditor, /agent-inline-prompt|Редактировать изменение через agent/);
  assert.match(css, /\.editor-comment-prompt/);
  assert.match(css, /\.editor-comment-action/);
  assert.match(css, /\.editor-comment-highlight/);
  assert.match(css, /\.editor-fragment-comments/);
  const goal = commentModel.proposalCommentsGoal([{
    id: "comment-1",
    selection: { text: "Исходный фрагмент" },
    text: "Добавить ограничение",
    createdAt: "2026-08-04T00:00:00.000Z",
  }]);
  assert.match(goal, /Исходный фрагмент/);
  assert.match(goal, /Добавить ограничение/);
  assert.equal(logic.changeFromDocumentPath("openspec/changes/add-report/design.md"), "add-report");
  assert.equal(logic.changeFromDocumentPath("openspec/changes/archive/2026-01-01-add-report/design.md"), null);
  assert.equal(logic.actionMatchesDocument({ outputPaths: ["openspec/changes/add-report/specs/**/*.md"] }, "openspec/changes/add-report/specs/report/spec.md"), true);
});
