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
  assert.match(html, /Загрузка проектов/);
  assert.doesNotMatch(html, /AI-ассистент/);
  assert.match(html, /Git управляет только Store/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/i);
});

test("переключатель проекта использует портфель без избыточной подписи", async () => {
  const switcher = await readFile(new URL("../features/projects/components/ProjectSwitcher.tsx", import.meta.url), "utf8");
  assert.match(switcher, /className="project-icon"/);
  assert.match(switcher, /<svg viewBox="0 0 24 24"/);
  assert.match(switcher, /className=\{`project-chevron/);
  assert.doesNotMatch(switcher, />ПРОЕКТ</);
  assert.doesNotMatch(switcher, />⌄</);
  assert.match(await readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"), /\.project-chevron \{[^}]*fill:\s*none[^}]*stroke-width:\s*1\.35/s);
});

test("логотип OpenSpec Studio изображает горные вершины", async () => {
  const logo = await readFile(new URL("../components/ui/LogoMark.tsx", import.meta.url), "utf8");
  assert.match(logo, /className="logo-mark-peak logo-mark-peak-back"/);
  assert.match(logo, /className="logo-mark-peak logo-mark-peak-front"/);
  assert.doesNotMatch(logo, /<rect|logo-mark-ground|logo-mark-summits/);
  assert.doesNotMatch(logo, /<i \/>/);
});

test("покрывает навигацию по Store и подключённым репозиториям", async () => {
  const html = await (await render()).text();
  const sidebar = await readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8");
  for (const expected of [
    "Рабочее пространство",
    "Контекст",
    "не выбран",
    "Документ не выбран",
  ]) {
    assert.match(html, new RegExp(expected));
  }
  assert.match(sidebar, /\{projectSelected && \([\s\S]*className="sidebar-heading files-heading"/);
  assert.doesNotMatch(sidebar, /!projectSelected && <div className="tree-state"/);
});

test("Контекст становится доступной страницей подключения репозиториев после выбора проекта", async () => {
  const [workspace, sidebar, panel] = await Promise.all([
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/repositories/components/RepositoriesPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(sidebar, /onWorkspaceModeChange\("context"\)/);
  assert.match(sidebar, /disabled=\{!projectSelected\}/);
  assert.match(sidebar, /projectSelected && workspaceMode === "context"/);
  assert.doesNotMatch(sidebar, /<RepositoriesPanel/);
  assert.match(workspace, /projects\.activeProject \? workspaceMode : "documents"/);
  assert.match(workspace, /activeWorkspaceMode === "context"/);
  assert.match(workspace, /<RepositoriesPanel controller=\{repositories\}/);
  assert.match(panel, /Подключить Git-репозиторий/);
  assert.match(panel, /Git URL/);
  assert.match(panel, /Подключённые репозитории/);
});

test("форма проекта поддерживает переносимый .openspec/context.yaml", async () => {
  const [switcher, controller, types, css] = await Promise.all([
    readFile(new URL("../features/projects/components/ProjectSwitcher.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/projects/hooks/useProjectsController.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/projects/model/project-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(types, /name\?: string/);
  assert.match(types, /contextImport\?: ContextImportSummary/);
  assert.match(types, /manifestFound: boolean/);
  assert.match(switcher, /Название, если нет манифеста/);
  assert.match(switcher, /\.openspec\/context\.yaml/);
  assert.match(switcher, /Контекст проекта загружен/);
  assert.match(switcher, /Подключено \{controller\.lastContextImport\.imported\}/);
  assert.doesNotMatch(switcher, /<input required autoComplete="off" value=\{name\}/);
  assert.match(controller, /lastContextImport: ContextImportSummary \| null/);
  assert.match(css, /\.project-state\.project-import-result\.warning/);
});

test("покрывает визуальное Markdown-редактирование, черновик и безопасную запись", async () => {
  const html = await (await render()).text();
  assert.match(html, /Выберите или создайте проект/);
  assert.match(html, />Edit</);
  assert.match(html, />Preview</);
  assert.match(html, />Split</);
  assert.match(html, /Файл сохранён/);
  assert.match(html, /Записать в файл/);
  assert.match(html, /Scope: Store only/);
});

test("история выбранного файла подключена к read-only Git-панели", async () => {
  const [editor, panel, css] = await Promise.all([
    readFile(new URL("../features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/documents/components/DocumentHistoryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /label="История файла"/);
  assert.match(editor, /onClick=\{history\.show\}/);
  assert.match(editor, /<DocumentHistoryPanel controller=\{history\}/);
  assert.doesNotMatch(editor, /История файла пока недоступна/);
  assert.match(panel, /Только просмотр/);
  assert.match(panel, /<time dateTime=\{entry\.committedAt\}>/);
  assert.match(css, /\.file-history-panel \{[^}]*position:\s*absolute[^}]*z-index:\s*12/s);
  assert.match(css, /\.file-history-body \{[^}]*overflow-y:\s*auto/s);
});

test("Preview использует read-only Milkdown вместо сырого Markdown pre", async () => {
  const [editor, preview] = await Promise.all([
    readFile(new URL("../features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/editor/components/MarkdownPreview.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /<MarkdownPreview documentId=\{activeFile!\} markdown=\{markdown\} \/>/);
  assert.doesNotMatch(editor, /<pre className="markdown-preview">\{markdown\}<\/pre>/);
  assert.match(preview, /\.setReadonly\(true\)/);
  assert.match(preview, /replaceAll\(markdown\)/);
  assert.match(preview, /role="document" aria-label="Предпросмотр Markdown"/);
  assert.doesNotMatch(preview, /dangerouslySetInnerHTML/);
});

test("визуальный редактор сохраняет Markdown, undo/redo и платформенное сохранение", async () => {
  const [editor, workspace, markdownEditor, packageJson] = await Promise.all([
    readFile(new URL("../features/editor/components/RichMarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"@milkdown\/crepe"/);
  assert.match(editor, /listener\.markdownUpdated/);
  assert.match(editor, /let editorReady = false/);
  assert.match(editor, /if \(!editorReady\) return/);
  assert.match(editor, /normalizedInitialMarkdown = editor\.getMarkdown\(\);\s*editorReady = true/);
  assert.doesNotMatch(editor, /event\.isTrusted|hasUserInteraction/);
  assert.match(editor, /onChangeRef\.current\(nextMarkdown === normalizedInitialMarkdown \? initialMarkdown : nextMarkdown\)/);
  assert.match(editor, /\[Crepe\.Feature\.TopBar\]: true/);
  assert.match(editor, /\[Crepe\.Feature\.ImageBlock\]: false/);
  assert.match(editor, /\[Crepe\.Feature\.Table\]|Crepe\.Feature\.TopBar/);
  assert.match(editor, /historyShortcut\(event\)/);
  assert.match(editor, /action === "undo" \? undo : redo/);
  assert.match(editor, /normalizedInitialMarkdown = editor\.getMarkdown\(\)/);
  assert.match(editor, /nextMarkdown === normalizedInitialMarkdown \? initialMarkdown : nextMarkdown/);
  assert.match(editor, /root\.addEventListener\("keydown", handleHistoryShortcut, true\)/);
  assert.match(editor, /root\.removeEventListener\("keydown", handleHistoryShortcut, true\)/);
  assert.match(editor, /editor\.destroy/);
  assert.match(workspace, /isSaveShortcut\(event\)/);
  assert.match(workspace, /window\.addEventListener\("keydown", handleSaveShortcut, true\)/);
  assert.match(workspace, /window\.removeEventListener\("keydown", handleSaveShortcut, true\)/);
  assert.match(workspace, /primaryShortcutLabel\("S"\)/);
  assert.match(markdownEditor, /\{saveShortcutLabel\}/);
  assert.doesNotMatch(markdownEditor, /<span>⌘S<\/span>/);
});

test("текущий стиль Paragraph в toolbar не выделяется жирным", async () => {
  const css = await readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.top-bar-heading-label,[\s\S]*\.top-bar-heading-option\.active\s*\{[\s\S]*font-weight:\s*400/);
});

test("уровни заголовков редактора визуально отличаются от основного текста", async () => {
  const css = await readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.rich-editor-shell \.milkdown \.ProseMirror h2 \{[^}]*font-size:\s*24px[^}]*font-weight:\s*700/s);
  assert.match(css, /\.rich-editor-shell \.milkdown \.ProseMirror h3 \{[^}]*font-size:\s*19px[^}]*font-weight:\s*650/s);
});

test("code block редактора оформлен как минималистичная карточка", async () => {
  const css = await readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.rich-editor-shell \.milkdown \.milkdown-code-block \{[^}]*border:\s*1px solid #dfe6e2[^}]*border-radius:\s*8px[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.milkdown-code-block \.cm-gutters \{ display:\s*none;/);
  assert.match(css, /\.milkdown-code-block \.tools \{[^}]*position:\s*absolute[^}]*top:\s*6px[^}]*right:\s*6px[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.milkdown-code-block \.language-picker \{[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.milkdown-code-block \.list-wrapper \{[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.milkdown-code-block:hover \.tools \.language-button/);
  assert.match(css, /\.milkdown-code-block:focus-within \.tools \.tools-button-group button/);
  assert.match(css, /\.milkdown-code-block \.milkdown-code-block-placeholder \{[^}]*font:\s*12px\/1\.6 var\(--font-code\)/s);
});

test("не рендерит удалённую панель AI-ассистента", async () => {
  const html = await (await render()).text();
  const workspace = await readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(html, /AI-ассистент|Чем помочь со спецификацией|Инструкция для AI/);
  assert.doesNotMatch(workspace, /AiAssistantPanel|useAiOperationsController|rightOpen|assistantMode/);
});

test("покрывает рабочую Git- и OpenSpec-навигацию без неиспользуемых операций", async () => {
  const html = await (await render()).text();
  for (const expected of ["Git", "OpenSpec", "Локальный режим", "Git управляет только Store"]) {
    assert.match(html, new RegExp(expected));
  }
  assert.doesNotMatch(html, /Операции|История операций пока недоступна/);
  assert.doesNotMatch(html, /Git-панель пока недоступна/);
  assert.doesNotMatch(html, /Commit &amp; Push появится вместе с Git-панелью/);
  assert.doesNotMatch(html, /OPENSpec/);
});

test("сохраняет доступные имена у интерактивных icon-only controls", async () => {
  const html = await (await render()).text();
  const [header, sidebar, agentPanel] = await Promise.all([
    readFile(new URL("../features/workspace/components/WorkspaceHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/AgentCliPanel.tsx", import.meta.url), "utf8"),
  ]);
  for (const label of [
    "Свернуть панель",
    "История файла",
  ]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  assert.match(agentPanel, /label="Свернуть панель Agent CLI"/);
  assert.match(agentPanel, /onClick=\{onClose\}>›<\/IconButton>/);
  for (const label of ["Управление OpenSpec", "Обновить"]) {
    assert.match(sidebar, new RegExp(`label="${label}"`));
  }
  assert.doesNotMatch(header, /Уведомления пока недоступны|Настройки пока недоступны|Профиль пока недоступен|>PT<\/button>/);
});

test("дерево OpenSpec прокручивается, каталоги сворачиваются, а AI selector использует chevron", async () => {
  const [sidebar, header, css] = await Promise.all([
    readFile(new URL("../features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/WorkspaceHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(sidebar, /collapsedDirectories/);
  assert.match(sidebar, /collapsedSections/);
  assert.match(sidebar, /new Set<NavigationSectionId>\(\["documentation", "archive"\]\)/);
  for (const label of ["Документация", "Изменения", "Архив"]) {
    assert.match(sidebar, new RegExp(`label: "${label}"`));
  }
  assert.match(sidebar, /segments\[1\] === "changes" && segments\[2\] === "archive"/);
  assert.match(sidebar, /segments\[1\] === "archive"/);
  assert.match(sidebar, /collectDocumentScopes/);
  assert.match(sidebar, /segments\.slice\(0, location\.rootDepth \+ 1\)/);
  assert.match(sidebar, /className={`tree-scope-row/);
  assert.match(sidebar, /className="document-tree-panel"/);
  assert.match(sidebar, /scopeItems\.map/);
  assert.match(sidebar, /role="treeitem"/);
  assert.match(sidebar, /label="Закрыть дерево документов"/);
  assert.match(sidebar, /relativeDepth \* 14/);
  assert.match(sidebar, /className="tree-section-heading"/);
  assert.match(sidebar, /className="tree-section-heading-row"/);
  assert.match(sidebar, /className="tree-section-count"/);
  assert.match(sidebar, /Количество: \$\{sectionScopes\.length\}/);
  assert.match(sidebar, /label="Добавить изменение"/);
  assert.match(sidebar, /onClick={onAddOpenSpecChange}/);
  assert.match(sidebar, /aria-controls=\{sectionContentId\}/);
  assert.match(sidebar, /toggleDirectory\(item\.path\)/);
  assert.match(sidebar, /tabIndex=\{0\} aria-label="Дерево OpenSpec"/);
  assert.match(sidebar, /aria-expanded=\{item\.kind === "directory"/);
  assert.doesNotMatch(sidebar, /disabled=\{item\.kind === "directory"\}/);
  assert.match(sidebar, /getScopeArtifactRole/);
  assert.match(sidebar, /"proposal\.md", "spec", "specs"/);
  assert.match(sidebar, /"design\.md", "tasks\.md"/);
  assert.match(sidebar, /artifactRole === "analyst" \? "АН" : "DEV"/);
  assert.match(sidebar, /aria-label=\{artifactRole \? `\$\{item\.name\}, \$\{artifactRoleLabels\[artifactRole\]\}`/);
  assert.match(css, /\.tree \{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.tree-section-heading \{[^}]*border:\s*1px solid #e3e8e5[^}]*background:\s*#f1f4f2/s);
  assert.match(css, /\.tree-section-heading svg\.expanded \{[^}]*transform:\s*rotate\(90deg\)/s);
  assert.match(css, /\.tree-section-count \{[^}]*margin-left:\s*auto[^}]*border-radius:\s*9px/s);
  assert.match(css, /\.tree-section-heading-row \.tree-section-add/);
  assert.match(css, /\.document-tree-panel \{[^}]*position:\s*relative[^}]*width:\s*auto[^}]*min-width:\s*0[^}]*box-shadow:\s*none/s);
  assert.doesNotMatch(css, /\.document-tree-panel \{[^}]*z-index/s);
  assert.match(css, /\.workspace:has\(> \.document-tree-panel\) \{[^}]*grid-template-columns:\s*260px 280px minmax\(470px, 1fr\)/s);
  assert.match(css, /\.workspace\.agent-settings-open \{[^}]*grid-template-columns:\s*260px minmax\(470px, 1fr\) 310px/s);
  assert.match(css, /\.workspace\.agent-settings-open:has\(> \.document-tree-panel\) \{[^}]*grid-template-columns:\s*260px 280px minmax\(470px, 1fr\) 310px/s);
  assert.doesNotMatch(css, /right-collapsed|\.assistant-panel/);
  assert.match(css, /\.agent-cli-panel \{[^}]*border-left:\s*1px solid var\(--line\)/s);
  assert.doesNotMatch(css, /\.document-tree-panel \{[^}]*position:\s*absolute/s);
  assert.match(css, /\.tree-scope-row\.active/);
  assert.match(css, /\.tree-row\.artifact-analyst \{[^}]*box-shadow:\s*inset 2px 0 #d49a38/s);
  assert.match(css, /\.tree-row\.artifact-developer \{[^}]*box-shadow:\s*inset 2px 0 #6687c7/s);
  assert.match(css, /\.artifact-role-badge/);
  assert.match(header, /className=\{`provider-chevron/);
  assert.match(header, /className="provider-icon" aria-hidden="true">✦</);
  assert.doesNotMatch(header, /className="provider-icon"[^>]*>✣</);
  assert.match(header, /aria-controls=\{agentSettingsOpen \? "agent-cli-panel" : undefined\}/);
  assert.match(header, /aria-expanded=\{agentSettingsOpen\}/);
  assert.match(header, /const modelLabel = provider \? model\?\.trim\(\) \|\| "По умолчанию CLI" : ""/);
  assert.match(header, /title=\{`Выбранная модель: \$\{modelLabel\}`\}/);
  assert.doesNotMatch(header, /aria-haspopup="dialog"/);
  assert.doesNotMatch(header, /: "⌄"/);
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
  assert.match(css, /\.rich-editor-shell \.milkdown \.ProseMirror \{ font-size: 16px/);
  assert.match(css, /button:disabled/);
  assert.match(css, /\.rich-editor-shell \.milkdown \.milkdown-top-bar/);
  assert.match(css, /\.milkdown-top-bar \{\s*z-index: 2/s);
  assert.match(css, /\.milkdown-top-bar \{[^}]*border-bottom:\s*0/s);
  assert.match(css, /\.editor-area \{[^}]*isolation: isolate/s);
  assert.doesNotMatch(css, /(?:^|[;{]\s*)zoom\s*:/m);
  assert.doesNotMatch(css, /transform:\s*scale\(/);
  assert.match(css, /\.milkdown-top-bar \.top-bar-item\s*\{[^}]*margin:\s*2px/s);
  assert.match(css, /\.milkdown-top-bar \.top-bar-divider\s*\{[^}]*margin:\s*6px/s);
  assert.match(css, /\.milkdown-top-bar \.top-bar-inner\s*\{[^}]*border-radius:\s*18px[^}]*backdrop-filter:\s*blur\(22px\) saturate\(170%\)/s);
  assert.match(css, /\.milkdown-top-bar \.top-bar-item:hover/);
  assert.match(css, /\.milkdown-top-bar \.top-bar-item:not\(:disabled\) \.milkdown-icon \{\s*color:\s*#111/s);
  assert.match(css, /\.milkdown-top-bar \.top-bar-item\.active \{[^}]*background:\s*rgba\(15, 112, 80, \.12\)[^}]*color:\s*var\(--green\)/s);
  assert.match(css, /\.milkdown-top-bar \.top-bar-item:disabled \{[^}]*opacity:\s*\.38/s);
  assert.match(css, /\.milkdown-list-item-block > \.list-item > \.children > \.content-dom > p \{[^}]*margin:\s*0[^}]*padding:\s*4px 0/s);
  assert.match(css, /\.milkdown-list-item-block > \.list-item > \.label-wrapper \{[^}]*height:\s*32px[^}]*flex:\s*0 0 24px/s);
  assert.match(css, /\.ProseMirror blockquote > p \{[^}]*margin:\s*0/s);
  assert.match(css, /@media \(max-width: 1344px\)/);
});

test("сохраняет feature-first архитектуру и тонкий route entry point", async () => {
  const [page, workspace, editor, model, uiPrimitive, richEditor] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/workspace/model/workspace-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/IconButton.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/editor/components/RichMarkdownEditor.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /OpenSpecWorkspace/);
  assert.ok(page.split("\n").length <= 8, "route entry point должен оставаться тонким");
  assert.match(workspace, /WorkspaceHeader/);
  assert.match(workspace, /WorkspaceSidebar/);
  assert.match(workspace, /MarkdownEditor/);
  assert.doesNotMatch(workspace, /AiAssistantPanel/);
  assert.match(editor, /interface MarkdownEditorProps/);
  assert.match(model, /export type ViewMode/);
  assert.match(uiPrimitive, /ButtonHTMLAttributes/);
  assert.match(richEditor, /interface RichMarkdownEditorProps/);
  assert.match(richEditor, /\[Crepe\.Feature\.Cursor\]: false/);
});
