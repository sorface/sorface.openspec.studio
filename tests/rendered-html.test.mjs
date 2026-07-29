import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("рендерит продуктовый workspace вместо стартового шаблона", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>OpenSpec Studio<\/title>/i);
  assert.match(html, /Platform specifications/);
  assert.match(html, /AI-ассистент/);
  assert.match(html, /Commit &amp; Push/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/i);
});

test("покрывает навигацию по Store и подключённым репозиториям", async () => {
  const html = await (await render()).text();
  for (const expected of [
    "Рабочее пространство",
    "Репозитории",
    "platform-core",
    "add-sso-auth",
    "proposal.md",
    "design.md",
    "tasks.md",
    "platform-api",
    "platform-web",
  ]) {
    assert.match(html, new RegExp(expected));
  }
});

test("покрывает режимы Markdown, черновик и безопасную запись", async () => {
  const html = await (await render()).text();
  assert.match(html, /aria-label="Markdown редактор"/);
  assert.match(html, />Edit</);
  assert.match(html, />Preview</);
  assert.match(html, />Split</);
  assert.match(html, /Черновик сохранён/);
  assert.match(html, /Записать в файл/);
  assert.match(html, /Scope: Store only/);
});

test("покрывает AI-инструкции, context review и diff-ready flow", async () => {
  const html = await (await render()).text();
  assert.match(html, /Улучшить выделение/);
  assert.match(html, /Дополнить документ/);
  assert.match(html, /Проверить change/);
  assert.match(html, /Контекст/);
  assert.match(html, /aria-label="Инструкция для AI"/);
  assert.match(html, /AI может изменять только OpenSpec Store/);
  assert.match(html, /вы увидите diff до применения/i);
});

test("покрывает Git, OpenSpec, операции и validate-status", async () => {
  const html = await (await render()).text();
  for (const expected of ["Git", "OpenSpec", "Операции", "Последняя проверка: успешно", "Commit &amp; Push"]) {
    assert.match(html, new RegExp(expected));
  }
});

test("сохраняет доступные имена у интерактивных icon-only controls", async () => {
  const html = await (await render()).text();
  for (const label of [
    "Уведомления",
    "Настройки",
    "Свернуть панель",
    "Новый файл",
    "Обновить",
    "История файла",
    "Свернуть AI-панель",
  ]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
});

test("использует самостоятельную реализацию без Untitled UI runtime-зависимости", async () => {
  const [packageJson, workspace, css] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(packageJson, /untitledui|react-aria|lucide/i);
  assert.doesNotMatch(workspace, /from ["'][^"']*untitled/i);
  assert.match(css, /--green:/);
  assert.match(css, /\.segmented/);
  assert.match(css, /\.toast/);
});

test("сохраняет feature-first архитектуру и тонкий route entry point", async () => {
  const [page, workspace, editor, assistant, model, uiPrimitive] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/AiAssistantPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/model/workspace-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/IconButton.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /OpenSpecWorkspace/);
  assert.ok(page.split("\n").length <= 8, "route entry point должен оставаться тонким");
  assert.match(workspace, /WorkspaceHeader/);
  assert.match(workspace, /WorkspaceSidebar/);
  assert.match(workspace, /MarkdownEditor/);
  assert.match(workspace, /AiAssistantPanel/);
  assert.match(editor, /interface MarkdownEditorProps/);
  assert.match(assistant, /interface AiAssistantPanelProps/);
  assert.match(model, /export type ViewMode/);
  assert.match(uiPrimitive, /ButtonHTMLAttributes/);
});
