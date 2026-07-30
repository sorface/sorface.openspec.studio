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

  for (const method of ["listProjects", "getProject", "createProject", "updateProject", "deleteProject"]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(controller, /AbortController/);
  assert.match(controller, /Promise\.all\(\[listProjects/);
  assert.match(controller, /mutationChain/);
  assert.match(controller, /ACTIVE_PROJECT_STORAGE_KEY/);
  assert.match(controller, /await createProject\(input\).*setProjects\(\(current\)/s);
  assert.match(switcher, /role="dialog"/);
  assert.match(switcher, /event\.key === "Escape"/);
  assert.match(switcher, /Удалить только метаданные/);
  assert.match(switcher, /Correlation ID:/);
  assert.match(switcher, /disabled=\{controller\.mutationPending\}/);
});

test("repositories feature покрывает clone, SSE, cancel и server-backed состояние", async () => {
  const [client, controller, panel, state] = await Promise.all([
    readFile(new URL("../features/repositories/api/repositories-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/repositories/hooks/useRepositoriesController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/repositories/components/RepositoriesPanel.tsx", import.meta.url), "utf8"),
    importTypeScript("../features/repositories/model/repository-operation.ts"),
  ]);
  for (const method of ["listRepositories", "startRepositoryClone", "getRepositoryClone", "cancelRepositoryClone"]) {
    assert.match(client, new RegExp(`function ${method}`));
  }
  assert.match(controller, /EventSource/);
  assert.match(controller, /setInterval/);
  assert.match(panel, /Git URL/);
  assert.match(panel, /Целевой каталог/);
  assert.match(panel, /Отменить/);
  assert.match(panel, /Correlation ID:/);
  assert.match(panel, /event\.key === "Escape"/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /disabled=\{controller\.loading\}/);
  assert.equal(state.reduceCloneStatus("running", "progress"), "running");
  assert.equal(state.reduceCloneStatus("running", "validating"), "validating");
  assert.equal(state.isCloneTerminal("completed"), true);
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
