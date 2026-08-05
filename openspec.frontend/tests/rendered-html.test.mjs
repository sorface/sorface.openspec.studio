import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: serverEntry } = await import(workerUrl.href);
  const handleRequest = typeof serverEntry === "function"
    ? serverEntry
    : serverEntry.fetch.bind(serverEntry);

  return handleRequest(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
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
  assert.doesNotMatch(html, /Локально · изменения разделены по задачам|Файл сохранён/);
  assert.match(html, /Задача/);
  assert.match(html, /task-context-chevron/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/i);
});

test("показывает loading landing до завершения анимации и инициализации проекта", async () => {
  const [workspace, landing, css] = await Promise.all([
    readFile(new URL("../src/features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/ProjectLoadingLanding.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(landing, /PROJECT_LOADING_ANIMATION_MAX_MS = 1_600/);
  assert.match(landing, /setAnimationComplete\(true\)/);
  assert.match(landing, /if \(!animationComplete \|\| !initializationComplete \|\| phase !== "visible"\) return/);
  assert.match(landing, /className="project-loading-flight" aria-hidden="true"/);
  assert.match(landing, /className="project-loading-swallow"/);
  assert.match(landing, /<LogoMark \/>/);
  assert.match(landing, /<strong>OpenSpec<\/strong>/);
  assert.match(landing, /<span>Studio<\/span>/);
  assert.match(workspace, /projects\.status !== "loading"/);
  assert.match(workspace, /tasks\.status !== "loading"/);
  assert.match(workspace, /documents\.status !== "loading"/);
  assert.match(workspace, /openSpec\.status !== "loading"/);
  assert.match(workspace, /<ProjectLoadingLanding initializationComplete=\{projectInitializationComplete\} \/>/);
  assert.match(css, /\.project-loading-landing \{[^}]*position:\s*fixed[^}]*z-index:\s*500/s);
  assert.match(css, /@keyframes project-loading-logo/);
  assert.match(css, /@keyframes project-loading-copy/);
  assert.match(css, /offset-path:\s*path\("M -55 27 C 32 -53 158 -73 270 -30"\)/);
  assert.match(css, /offset-distance:\s*0%/);
  assert.match(css, /@keyframes project-loading-bird-flight/);
  assert.doesNotMatch(css, /project-loading-landing::before|project-loading-aura/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("переключатель проекта использует портфель без избыточной подписи", async () => {
  const switcher = await readFile(new URL("../src/features/projects/components/ProjectSwitcher.tsx", import.meta.url), "utf8");
  assert.match(switcher, /className="project-icon"/);
  assert.match(switcher, /<svg viewBox="0 0 24 24"/);
  assert.match(switcher, /className=\{`project-chevron/);
  assert.doesNotMatch(switcher, />ПРОЕКТ</);
  assert.doesNotMatch(switcher, />⌄</);
  assert.match(await readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8"), /\.project-chevron \{[^}]*fill:\s*none[^}]*stroke-width:\s*1\.35/s);
});

test("логотип OpenSpec Studio изображает горные вершины", async () => {
  const logo = await readFile(new URL("../src/components/ui/LogoMark.tsx", import.meta.url), "utf8");
  assert.match(logo, /className="logo-mark-peak logo-mark-peak-back"/);
  assert.match(logo, /className="logo-mark-peak logo-mark-peak-front"/);
  assert.doesNotMatch(logo, /<rect|logo-mark-ground|logo-mark-summits/);
  assert.doesNotMatch(logo, /<i \/>/);
});

test("покрывает навигацию по Store и подключённым репозиториям", async () => {
  const html = await (await render()).text();
  const sidebar = await readFile(new URL("../src/features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8");
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
    readFile(new URL("../src/features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/repositories/components/RepositoriesPanel.tsx", import.meta.url), "utf8"),
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
  assert.match(panel, /Ветка репозитория/);
  assert.match(panel, /Перейти/);
  assert.match(panel, /Получить обновления/);
  assert.match(panel, /AI: read-only/);
});

test("форма проекта поддерживает переносимый .openspec/context.yaml", async () => {
  const [switcher, controller, types, css] = await Promise.all([
    readFile(new URL("../src/features/projects/components/ProjectSwitcher.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/projects/hooks/useProjectsController.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/projects/model/project-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8"),
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
  assert.doesNotMatch(html, /Файл сохранён/);
  assert.match(html, /Записать в файл/);
  assert.match(html, /Scope: Store only/);
});

test("Git-аннотации и история выбранного файла подключены к read-only панели", async () => {
  const [editor, panel, css] = await Promise.all([
    readFile(new URL("../src/features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/documents/components/DocumentHistoryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /label="Git-аннотации файла"/);
  assert.match(editor, /onClick=\{history\.show\}/);
  assert.match(editor, /<DocumentHistoryPanel controller=\{history\}/);
  assert.doesNotMatch(editor, /История файла пока недоступна/);
  assert.match(panel, /Git-аннотации/);
  assert.match(panel, /Аннотации <span>\{annotationLines\.length\}<\/span>/);
  assert.match(panel, /Коммиты <span>\{controller\.items\.length\}<\/span>/);
  assert.match(panel, /Построчные Git-аннотации/);
  assert.match(panel, />Дата<\/span>/);
  assert.match(panel, />Автор<\/span>/);
  assert.match(panel, />Строка<\/span>/);
  assert.match(panel, /entry\.content \|\| " "/);
  assert.match(panel, /Локально/);
  assert.match(panel, /Только просмотр/);
  assert.match(panel, /<time dateTime=\{entry\.committedAt\}>/);
  assert.match(css, /\.file-history-panel \{[^}]*position:\s*absolute[^}]*z-index:\s*12/s);
  assert.match(css, /\.file-history-body \{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.file-history-tabs \{[^}]*grid-template-columns:\s*1fr 1fr/s);
  assert.match(css, /\.file-history-panel\.annotations-view \{[^}]*width:\s*min\(820px/s);
  assert.match(css, /\.file-annotation-table-head, \.file-annotation-row \{[^}]*grid-template-columns:\s*84px minmax\(92px, 126px\) 52px/s);
  assert.match(css, /\.file-annotation-row > code \{[^}]*font:\s*11px\/17px var\(--font-code\)/s);
});

test("Preview использует read-only Milkdown вместо сырого Markdown pre", async () => {
  const [editor, preview] = await Promise.all([
    readFile(new URL("../src/features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/editor/components/MarkdownPreview.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../src/features/editor/components/RichMarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"@milkdown\/crepe"/);
  assert.match(editor, /listener\.markdownUpdated/);
  assert.match(editor, /let editorReady = false/);
  assert.match(editor, /if \(!editorReady\) return/);
  assert.match(editor, /normalizedInitialMarkdown = editor\.getMarkdown\(\);\s*editorReady = true/);
  assert.doesNotMatch(editor, /event\.isTrusted|hasUserInteraction/);
  assert.match(editor, /onChangeRef\.current\(nextMarkdown === normalizedInitialMarkdown \? initialMarkdown : nextMarkdown\)/);
  assert.match(editor, /\[Crepe\.Feature\.TopBar\]: !readOnly/);
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
  assert.doesNotMatch(markdownEditor, /label="Ещё"|Дополнительные действия пока недоступны|•••/);
});

test("heading-селектор использует обычный Paragraph и жирный Heading", async () => {
  const [css, editor] = await Promise.all([
    readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/editor/components/RichMarkdownEditor.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.top-bar-heading-label,[\s\S]*\.top-bar-heading-option\.active:first-child\s*\{[\s\S]*font-weight:\s*400/);
  assert.match(css, /\.top-bar-heading-button\.heading-active \.top-bar-heading-label,[\s\S]*\.top-bar-heading-option\.active:not\(:first-child\)\s*\{[\s\S]*font-weight:\s*700/);
  assert.match(editor, /classList\.toggle\("heading-active", \/\^Heading \[1-6\]\$\//);
  assert.match(editor, /headingSelectorObserver\?\.disconnect\(\)/);
});

test("уровни заголовков редактора визуально отличаются от основного текста", async () => {
  const css = await readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.rich-editor-shell \.milkdown \.ProseMirror h2 \{[^}]*font-size:\s*24px[^}]*font-weight:\s*700/s);
  assert.match(css, /\.rich-editor-shell \.milkdown \.ProseMirror h3 \{[^}]*font-size:\s*19px[^}]*font-weight:\s*650/s);
});

test("code block редактора оформлен как минималистичная карточка", async () => {
  const css = await readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8");
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
  const workspace = await readFile(new URL("../src/features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(html, /AI-ассистент|Чем помочь со спецификацией|Инструкция для AI/);
  assert.doesNotMatch(workspace, /AiAssistantPanel|useAiOperationsController|rightOpen|assistantMode/);
});

test("покрывает задачу и OpenSpec-навигацию без Git-терминов и локальных status-индикаторов", async () => {
  const html = await (await render()).text();
  for (const expected of ["Задача", "OpenSpec"]) {
    assert.match(html, new RegExp(expected));
  }
  assert.match(html, /task-context-chevron/);
  assert.doesNotMatch(html, /Локально · изменения разделены по задачам|Файл сохранён/);
  assert.doesNotMatch(html, /Операции|История операций пока недоступна/);
  assert.doesNotMatch(html, /Git-панель пока недоступна/);
  assert.doesNotMatch(html, /Commit &amp; Push появится вместе с Git-панелью/);
  assert.doesNotMatch(html, />Git<\/b>/);
  assert.doesNotMatch(html, /OPENSpec/);
});

test("сохраняет доступные имена у интерактивных icon-only controls", async () => {
  const html = await (await render()).text();
  const [header, sidebar, agentPanel] = await Promise.all([
    readFile(new URL("../src/features/workspace/components/WorkspaceHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/AgentCliPanel.tsx", import.meta.url), "utf8"),
  ]);
  for (const label of [
    "Свернуть панель",
    "Git-аннотации файла",
  ]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  assert.match(agentPanel, /label="Свернуть панель Agent CLI"/);
  assert.match(agentPanel, /onClick=\{onClose\}>›<\/IconButton>/);
  assert.match(sidebar, /label="Добавить изменение"/);
  assert.doesNotMatch(sidebar, /label="Обновить"/);
  assert.doesNotMatch(header, /Уведомления пока недоступны|Настройки пока недоступны|Профиль пока недоступен|>PT<\/button>/);
});

test("дерево OpenSpec прокручивается, каталоги сворачиваются, а AI selector использует chevron", async () => {
  const [sidebar, header, richEditor, documentActions, workflowController, operationPanel, css] = await Promise.all([
    readFile(new URL("../src/features/workspace/components/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/WorkspaceHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/editor/components/RichMarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/openspec-workflow/components/OpenSpecDocumentActions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/openspec-workflow/hooks/useOpenSpecWorkflowController.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/openspec-workflow/components/OpenSpecOperationPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(sidebar, /collapsedDirectories/);
  assert.match(sidebar, /collapsedSections/);
  assert.match(sidebar, /new Set<NavigationSectionId>\(\["documentation", "archive"\]\)/);
  for (const label of ["Master Spec", "Изменения", "Архив"]) {
    assert.match(sidebar, new RegExp(`label: "${label}"`));
  }
  assert.match(sidebar, /segments\[1\] === "changes" && segments\[2\] === "archive"/);
  assert.match(sidebar, /segments\[1\] === "archive"/);
  assert.match(sidebar, /collectDocumentScopes/);
  assert.match(sidebar, /segments\.slice\(0, location\.rootDepth \+ 1\)/);
  assert.match(sidebar, /const \[selectedScopeId, setSelectedScopeId\] = useState\(""\)/);
  assert.match(sidebar, /scope\.sectionId === "changes"/);
  assert.match(sidebar, /selectedPath\.startsWith\(`\$\{scope\.rootPath\}\/`\)/);
  assert.match(sidebar, /scope\.id === selectedChangeScopeId/);
  assert.match(sidebar, /className={`tree-scope-row/);
  assert.match(sidebar, /className="document-tree-panel"/);
  assert.match(sidebar, /scopeItems\.map/);
  assert.match(sidebar, /role="treeitem"/);
  assert.match(sidebar, /label="Закрыть дерево документов"/);
  assert.match(sidebar, /activeScope\.sectionId !== "changes"/);
  assert.match(sidebar, /if \(activeScope\?\.sectionId !== "changes"\) setSelectedScopeId\(""\)/);
  assert.match(sidebar, /activeScope\.sectionId === "changes"[\s\S]*\? "Изменение"/);
  assert.doesNotMatch(sidebar, /document-tree-next-step|onContinueOpenSpecChange|Записать и продолжить/);
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
  assert.match(sidebar, /artifactRole \? `\$\{item\.name\}, \$\{artifactRoleLabels\[artifactRole\]\}` : undefined/);
  assert.match(css, /\.tree \{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.tree-section-heading \{[^}]*border:\s*1px solid #e3e8e5[^}]*background:\s*#f1f4f2/s);
  assert.match(css, /\.tree-section-heading svg\.expanded \{[^}]*transform:\s*rotate\(90deg\)/s);
  assert.match(css, /\.tree-section-count \{[^}]*margin-left:\s*auto[^}]*border-radius:\s*9px/s);
  assert.match(css, /\.tree-section-heading-row \.tree-section-add/);
  assert.match(css, /\.document-tree-panel \{[^}]*position:\s*relative[^}]*width:\s*auto[^}]*min-width:\s*0[^}]*box-shadow:\s*none/s);
  assert.doesNotMatch(css, /\.document-tree-panel \{[^}]*z-index/s);
  assert.match(css, /\.workspace:has\(> \.document-tree-panel\) \{[^}]*grid-template-columns:\s*260px 280px minmax\(470px, 1fr\)/s);
  assert.match(css, /\.workspace\.left-collapsed:has\(> \.document-tree-panel\) \{[^}]*grid-template-columns:\s*0 280px minmax\(470px, 1fr\)/s);
  assert.match(css, /\.workspace\.agent-settings-open \{[^}]*grid-template-columns:\s*260px minmax\(470px, 1fr\) 310px/s);
  assert.match(css, /\.workspace\.agent-settings-open:has\(> \.document-tree-panel\) \{[^}]*grid-template-columns:\s*260px 280px minmax\(470px, 1fr\) 310px/s);
  assert.doesNotMatch(css, /right-collapsed|\.assistant-panel/);
  assert.match(css, /\.agent-cli-panel \{[^}]*border-left:\s*1px solid var\(--line\)/s);
  assert.doesNotMatch(css, /\.document-tree-panel \{[^}]*position:\s*absolute/s);
  assert.match(css, /\.tree-scope-row\.active/);
  assert.match(css, /\.tree-row\.artifact-analyst \{[^}]*box-shadow:\s*inset 2px 0 #d49a38/s);
  assert.match(css, /\.tree-row\.artifact-developer \{[^}]*box-shadow:\s*inset 2px 0 #6687c7/s);
  assert.match(sidebar, /isMasterSpecPath\(item\.path\)/);
  assert.match(sidebar, /master spec, только просмотр/);
  assert.match(sidebar, /master-spec-badge/);
  assert.match(css, /\.tree-row\.master-spec \{[^}]*box-shadow:\s*inset 2px 0 #16835f/s);
  assert.match(css, /\.tree-row\.master-spec\.active \{[^}]*background:\s*#dff2e9/s);
  assert.match(css, /\.artifact-role-badge/);
  assert.match(richEditor, /\.milkdown-top-bar \.top-bar-inner/);
  assert.match(richEditor, /className="rich-editor-context-actions"/);
  assert.match(css, /\.rich-editor-context-actions \{[^}]*margin-left:\s*auto[^}]*border-left:/s);
  assert.match(css, /\.milkdown-top-bar \.openspec-document-action-button \{[^}]*background:\s*#0f7050[^}]*font-family:\s*inherit[^}]*font-size:\s*12px[^}]*font-weight:\s*650/s);
  assert.match(css, /\.milkdown-top-bar \.openspec-document-action-button:disabled \{[^}]*background:\s*#edf3f0[^}]*color:\s*#44584f[^}]*opacity:\s*1/s);
  assert.match(css, /\.milkdown-top-bar \.openspec-document-action-button\.secondary \{[^}]*height:\s*32px[^}]*border-color:\s*transparent[^}]*background:\s*transparent[^}]*color:\s*#111[^}]*font-size:\s*11px[^}]*font-weight:\s*500/s);
  assert.match(css, /\.milkdown-top-bar \.openspec-document-action-button\.secondary:disabled \{[^}]*background:\s*transparent[^}]*opacity:\s*\.38/s);
  assert.doesNotMatch(css, /\.milkdown-top-bar \.openspec-document-action-button:hover:not\(:disabled\)\s*\{[^}]*transform:/s);
  assert.match(css, /\.editor-content-shell\.with-context-panel \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 390px/s);
  assert.match(css, /\.document-openspec-review \{[^}]*position:\s*relative[^}]*border-left:\s*1px solid var\(--line\)/s);
  assert.match(css, /\.document-openspec-review \{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/s);
  assert.match(css, /\.openspec-operations-list \{[^}]*grid-row:\s*3[^}]*min-height:\s*0[^}]*max-height:\s*none[^}]*overflow-y:\s*auto[^}]*align-content:\s*start/s);
  assert.doesNotMatch(css, /\.openspec-operation-summary|\.openspec-operation-view-button/);
  assert.match(documentActions, /История операций/);
  assert.match(documentActions, /ИСТОРИЯ ОПЕРАЦИЙ/);
  assert.match(documentActions, /className="artifact-refresh-stages"/);
  assert.match(documentActions, /controller\.artifactRefresh\.steps\.map/);
  assert.match(documentActions, /"Выполнено"[\s\S]*"Остановлено"[\s\S]*"Выполняется"[\s\S]*"Запланировано"/);
  assert.match(css, /\.artifact-refresh-stages li\.completed > i \{[^}]*background:\s*#dcefe6[^}]*color:\s*#0f7050/s);
  assert.match(css, /\.artifact-refresh-stages li\.current > i \{[^}]*background:\s*#16835f[^}]*color:\s*#fff/s);
  assert.match(documentActions, /className="open-panel right openspec-operations-open"/);
  assert.match(documentActions, /aria-label=\{`Показать историю операций изменения \$\{change\}`\}/);
  assert.match(documentActions, /<span aria-hidden="true">Операции<\/span>/);
  assert.match(css, /\.open-panel\.right \{[^}]*right:\s*0[^}]*border-radius:\s*7px 0 0 7px/s);
  assert.match(css, /\.editor-content-shell\.with-context-panel:has\(> \.openspec-operations-open\) \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /\.openspec-operations-open \{[^}]*top:\s*66px[^}]*min-height:\s*82px[^}]*place-items:\s*center[^}]*font-size:\s*10px/s);
  assert.match(css, /\.openspec-operations-open span \{[^}]*writing-mode:\s*vertical-rl[^}]*rotate\(180deg\)/s);
  assert.match(documentActions, /controller\.operations\.map/);
  assert.match(documentActions, /controller\.selectOperation\(operation\)/);
  assert.match(workflowController, /const selectsCurrentOperation = operation\?\.id === next\.id;[\s\S]*if \(!selectsCurrentOperation\)[\s\S]*setOperationDialogOpen\(true\)/);
  assert.match(documentActions, /openSpecOperationChangedFiles\(operation\)/);
  assert.match(documentActions, /className="openspec-operation-files"/);
  assert.match(documentActions, /Изменено файлов:/);
  assert.match(documentActions, /openSpecFileName\(mutation\.previousPath\)/);
  assert.match(documentActions, /openSpecFileName\(mutation\.path\)/);
  assert.match(documentActions, /function openSpecFileName\(path: string\)/);
  assert.match(documentActions, /title=\{mutation\.previousPath \? `\$\{mutation\.previousPath\} → \$\{mutation\.path\}` : mutation\.path\}/);
  assert.match(css, /\.openspec-operations-list button \.openspec-operation-files \{[^}]*grid-column:\s*1 \/ -1[^}]*grid-row:\s*3/s);
  assert.match(css, /\.openspec-operation-files i\[data-mutation="delete"\]/);
  assert.match(workflowController, /const \[operationsPanelOpen, setOperationsPanelOpen\] = useState\(false\)/);
  assert.doesNotMatch(workflowController, /const selectChange[\s\S]*?setSelectedChange\(change\);\s*setOperationsPanelOpen\(true\)/);
  assert.match(documentActions, /operation\.provider \? "ai-operation"/);
  assert.match(documentActions, /data-ai-provider=\{operation\.provider \|\| undefined\}/);
  assert.match(documentActions, /data-artifact-kind=\{artifactKind\}/);
  assert.match(documentActions, /className="openspec-operation-artifact"/);
  assert.match(documentActions, /proposal: "P", specs: "S", design: "D", tasks: "T"/);
  assert.match(css, /button\[data-artifact-kind="proposal"\][^}]*--operation-accent:\s*#b77a22/s);
  assert.match(css, /button\[data-artifact-kind="specs"\][^}]*--operation-accent:\s*#16835f/s);
  assert.match(css, /button\[data-artifact-kind="design"\][^}]*--operation-accent:\s*#4878ad/s);
  assert.match(css, /button\[data-artifact-kind="tasks"\][^}]*--operation-accent:\s*#7657a8/s);
  assert.match(css, /\.openspec-operation-artifact > i \{[^}]*background:\s*var\(--operation-tint\)[^}]*color:\s*var\(--operation-accent\)/s);
  assert.doesNotMatch(documentActions, /artifact-refresh-warning|refreshWarningAction/);
  assert.doesNotMatch(css, /\.artifact-refresh-warning/);
  assert.match(css, /\.proposal-comments-count \{[^}]*background:\s*#16835f[^}]*color:\s*#fff/s);
  assert.match(documentActions, /className="openspec-operation-dialog"/);
  assert.match(documentActions, /role="dialog"/);
  assert.match(documentActions, /controller\.operationDialogOpen/);
  assert.doesNotMatch(documentActions, /openspec-operation-view-button|openspec-operation-summary|Просмотреть результат/);
  assert.match(css, /\.openspec-operation-dialog \{[^}]*width:\s*min\(1380px[^}]*height:\s*min\(900px/s);
  assert.match(operationPanel, /className="openspec-split-diff"[\s\S]*role="table"/);
  assert.match(operationPanel, /className="openspec-operation-conclusion"[\s\S]*aria-label="Заключение агента"/);
  assert.match(operationPanel, /ЗАКЛЮЧЕНИЕ[\s\S]*Результат работы агента/);
  assert.match(operationPanel, /parseStructuredOperationConclusion\(markdown\)/);
  assert.match(operationPanel, /Принятые допущения[\s\S]*Предложенные названия/);
  assert.doesNotMatch(operationPanel, /<p>\{controller\.result\.finalResponse\}<\/p>/);
  assert.match(css, /\.openspec-operation-conclusion \{[^}]*border:\s*1px solid #cfe0d8[^}]*border-radius:\s*10px[^}]*background:\s*linear-gradient/s);
  assert.match(css, /\.openspec-operation-conclusion-body \.openspec-markdown-line \{[^}]*font-size:\s*12px[^}]*line-height:\s*1\.55/s);
  assert.doesNotMatch(operationPanel, /openspec-split-diff-number|openspec-split-diff-marker/);
  assert.match(operationPanel, /className="openspec-mutation-toggle"[\s\S]*aria-expanded=\{!collapsed\}[\s\S]*aria-controls=\{contentId\}/);
  assert.match(operationPanel, /className="openspec-mutation-chevron"/);
  assert.match(css, /\.openspec-mutation-toggle \{[^}]*grid-template-columns:\s*18px auto minmax\(0, 1fr\) auto[^}]*cursor:\s*pointer/s);
  assert.match(css, /\.openspec-mutation-toggle:focus-visible \{[^}]*box-shadow:\s*inset/s);
  assert.match(css, /\.openspec-mutation\.is-collapsed \.openspec-mutation-chevron \{[^}]*rotate\(-90deg\)/s);
  assert.match(operationPanel, /className=\{`openspec-markdown-line kind-heading/);
  assert.match(operationPanel, /className="openspec-markdown-line kind-task"/);
  assert.match(operationPanel, /className=\{`markdown-task-box/);
  assert.match(operationPanel, /className="removed">−\{summary\.deletions\}/);
  assert.match(operationPanel, /className="added">\+\{summary\.additions\}/);
  assert.match(css, /\.openspec-mutation-summary i \{[^}]*min-width:\s*28px[^}]*padding:\s*3px 5px[^}]*font-family:\s*var\(--font-code\)[^}]*font-size:\s*8px[^}]*font-weight:\s*750[^}]*line-height:\s*1/s);
  assert.match(operationPanel, /className="openspec-mutation-open-final"[\s\S]*Открыть итоговый Markdown/);
  assert.match(operationPanel, /className="openspec-result-dialog"[\s\S]*aria-modal="true"/);
  assert.match(operationPanel, /className="openspec-result-markdown"/);
  assert.match(operationPanel, /<RichMarkdownEditor[\s\S]*readOnly/);
  assert.match(operationPanel, /onAddComment=\{reviewable \? addComment : undefined\}/);
  assert.doesNotMatch(operationPanel, /comments\.length [<>]=? 8|Комментарии \{comments\.length\}\/8|slice\(0, 1000\)/);
  assert.match(operationPanel, /reviewComments\.map\(reviewCommentFeedback\)/);
  assert.doesNotMatch(operationPanel, /openspec-result-comments/);
  assert.match(operationPanel, /Повторить этап с комментариями/);
  assert.match(operationPanel, /Принять исправления/);
  assert.match(css, /\.openspec-result-dialog-backdrop \{[^}]*position:\s*fixed[^}]*z-index:\s*1300[^}]*inset:\s*0/s);
  assert.match(css, /\.openspec-result-dialog \{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.openspec-result-dialog-content \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /\.openspec-result-markdown > \.rich-editor-shell \{[^}]*height:\s*100%/s);
  assert.match(css, /\.openspec-split-diff-head \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.openspec-split-diff-row \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.openspec-split-diff-cell \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /\.openspec-split-diff-cell\.removed \{[^}]*background:\s*#fff0ee[^}]*#cf6659/s);
  assert.match(css, /\.openspec-split-diff-cell\.added \{[^}]*background:\s*#e9f7ef[^}]*#3f9a71/s);
  assert.doesNotMatch(css, /\.openspec-split-diff-number|\.openspec-split-diff-marker/);
  assert.match(css, /\.openspec-markdown-line \{[^}]*font-size:\s*12px[^}]*line-height:\s*1\.5/s);
  assert.match(css, /\.openspec-markdown-line\.kind-heading\.level-2 \{[^}]*font-size:\s*15px/s);
  assert.match(css, /\.markdown-task-box \{[^}]*border-radius:\s*3px/s);
  assert.match(operationPanel, /className="primary-submit"[\s\S]*Принять весь набор/);
  assert.match(operationPanel, /className="openspec-review-action-error" role="alert"/);
  assert.match(operationPanel, /controller\.pending \? "Принимаем…" : "Принять весь набор"/);
  assert.match(documentActions, /controller\.operationDialogOpen && selectedOperation && createPortal\(/);
  assert.match(operationPanel, /className="openspec-operation-scroll"[\s\S]*className="openspec-operation-footer"/);
  assert.match(css, /\.openspec-operation-dialog \.openspec-operation \{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.openspec-operation-dialog \.openspec-operation-scroll \{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.openspec-operation-dialog \.openspec-operation-footer \{[^}]*box-shadow:/s);
  assert.match(operationPanel, /className="openspec-operation-progress"[\s\S]*<time aria-label=\{`Время выполнения \$\{formatElapsedTime\(controller\.operationElapsedSeconds\)\}`\}>[\s\S]*\{formatElapsedTime\(controller\.operationElapsedSeconds\)\}/);
  assert.match(operationPanel, /className=\{`artifact-refresh-operation-status[\s\S]*<ol aria-label="Этапы пересогласования">/);
  assert.doesNotMatch(operationPanel, /Пересогласование planning-артефактов|Planning-артефакты согласованы|Повторить текущий этап/);
  assert.match(css, /\.artifact-refresh-operation-status \{[^}]*display:\s*flex[^}]*justify-content:\s*center[^}]*\}/s);
  assert.match(css, /\.artifact-refresh-operation-status li \+ li::before \{[^}]*width:\s*42px[^}]*height:\s*1px/s);
  assert.doesNotMatch(css, /\.artifact-refresh-operation-status \{[^}]*border:/s);
  assert.doesNotMatch(operationPanel, /<p>Прошло/);
  assert.doesNotMatch(operationPanel, /реальные файлы не изменяются/);
  assert.match(operationPanel, /className="openspec-draft-card"[\s\S]*className="openspec-draft-status-icon"[\s\S]*className="openspec-draft-copy"/);
  assert.doesNotMatch(operationPanel, /только явная запись изменит Store|Записать \{controller\.draft\.mutations\.length\} изменений в Store/);
  assert.match(operationPanel, /className="openspec-draft-write-button"[\s\S]*Повторить запись в Store/);
  assert.match(css, /\.openspec-review-actions button \{[^}]*min-height:\s*38px[^}]*padding:\s*0 16px[^}]*border-radius:\s*8px/s);
  assert.match(css, /\.openspec-review-actions \.secondary-danger:hover:not\(:disabled\)/);
  assert.match(css, /\.openspec-review-actions \.primary-submit:hover:not\(:disabled\)/);
  assert.match(css, /\.openspec-draft-write-button \{[^}]*min-height:\s*38px[^}]*padding:\s*0 16px[^}]*border:\s*1px solid var\(--green\)[^}]*border-radius:\s*8px[^}]*background:\s*var\(--green\)[^}]*cursor:\s*pointer/s);
  assert.match(css, /\.openspec-draft \{[^}]*display:\s*flex[^}]*justify-content:\s*flex-end[^}]*background:\s*rgba\(250, 252, 251, \.97\)/s);
  assert.match(css, /\.openspec-draft-card \{[^}]*width:\s*min\(660px, 100%\)[^}]*grid-template-columns:\s*32px minmax\(0, 1fr\) auto[^}]*border-radius:\s*10px/s);
  assert.match(css, /\.openspec-draft-write-button:hover:not\(:disabled\) \{[^}]*background:\s*#0c6246/s);
  assert.match(css, /\.openspec-draft-write-button:focus-visible \{[^}]*box-shadow:/s);
  assert.doesNotMatch(css, /\.openspec-draft-write-button:hover:not\(:disabled\) \{[^}]*transform:/s);
  assert.match(operationPanel, /className="openspec-operation-running-header"[\s\S]*className="operation-spinner"[\s\S]*className="openspec-operation-progress"[\s\S]*<time[\s\S]*className="openspec-operation-cancel"/);
  assert.match(css, /\.openspec-operation-running-header \{[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\) auto auto[^}]*align-items:\s*center/s);
  assert.match(css, /\.openspec-operation-running-header time \{[^}]*font-variant-numeric:\s*tabular-nums[^}]*text-align:\s*center/s);
  assert.match(css, /\.openspec-operation-running \{[^}]*margin:\s*12px 24px 0[^}]*padding:\s*14px 0 15px[^}]*display:\s*grid[^}]*gap:\s*10px[^}]*border-top:\s*1px solid #edf1ef[^}]*border-bottom:\s*1px solid #edf1ef/s);
  assert.match(operationPanel, /className="openspec-operation-cancel"[\s\S]*Отменить/);
  assert.match(css, /\.openspec-operation-running-header > \.openspec-operation-cancel \{[^}]*min-height:\s*34px[^}]*padding:\s*0 14px[^}]*border:\s*1px solid #dfbcb6[^}]*border-radius:\s*8px[^}]*color:\s*#9a4339/s);
  assert.match(css, /\.openspec-operation-running-header > \.openspec-operation-cancel:hover \{[^}]*border-color:\s*#c8877d[^}]*background:\s*#fff4f2[^}]*color:\s*#7f3028/s);
  assert.match(css, /\.openspec-operation-running-header time \{[^}]*padding-left:\s*10px[^}]*border-left:\s*1px solid #dce4e0/s);
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
    readFile(new URL("../src/features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8"),
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
  const [page, workspace, editor, model, uiPrimitive, richEditor, css] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/model/workspace-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/IconButton.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/editor/components/RichMarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/styles/workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /OpenSpecWorkspace/);
  assert.ok(page.split("\n").length <= 8, "route entry point должен оставаться тонким");
  assert.match(workspace, /WorkspaceHeader/);
  assert.match(workspace, /WorkspaceSidebar/);
  assert.match(workspace, /MarkdownEditor/);
  assert.match(workspace, /className="openspec-task-progress"/);
  assert.match(workspace, /taskProgressFromMarkdown\(documents\.markdown\)/);
  assert.match(css, /\.openspec-task-progress \{[^}]*border:\s*1px solid #bad5c9[^}]*background:\s*#edf7f2/s);
  assert.doesNotMatch(workspace, /AiAssistantPanel/);
  assert.match(editor, /interface MarkdownEditorProps/);
  assert.match(model, /export type ViewMode/);
  assert.match(uiPrimitive, /ButtonHTMLAttributes/);
  assert.match(richEditor, /interface RichMarkdownEditorProps/);
  assert.match(richEditor, /\[Crepe\.Feature\.Cursor\]: false/);
});

test("открывает baseline и delta specs пользователю только для просмотра", async () => {
  const [workspace, editor, classifier] = await Promise.all([
    readFile(new URL("../src/features/workspace/components/OpenSpecWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/components/MarkdownEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workspace/model/openspec-document.ts", import.meta.url), "utf8"),
  ]);

  assert.match(classifier, /\^openspec\\\/specs\\\/\[\^\/\]\+\\\/spec\\\.md\$/);
  assert.match(classifier, /export function isDeltaSpecPath/);
  assert.match(classifier, /openspec\\\/changes\\\/\[\^\/\]\+\\\/\(\?:spec\|specs\)/);
  assert.match(classifier, /isMasterSpecPath\(path\) \|\| isDeltaSpecPath\(path\)/);
  assert.match(workspace, /const masterSpecReadOnly = isMasterSpecPath\(documents\.selectedPath\)/);
  assert.match(workspace, /const deltaSpecReadOnly = isDeltaSpecPath\(documents\.selectedPath\)/);
  assert.match(workspace, /if \(isUserReadOnlySpecPath\(selectedDocumentPath\)\) return false/);
  assert.match(workspace, /userReadOnly=\{userReadOnlySpec\}/);
  assert.match(workspace, /readOnlyLabel=\{masterSpecReadOnly \? "Master spec · только просмотр" : "Diff spec · только просмотр"\}/);
  assert.match(workspace, /hideHeaderActions=\{masterSpecReadOnly\}/);
  assert.match(editor, /\{!hideHeaderActions && \(/);
  assert.match(editor, /hideHeaderActions\?: boolean/);
  assert.match(workspace, /onChange=\{userReadOnlySpec \? \(\) => undefined : documents\.change\}/);
  assert.match(editor, /const effectiveViewMode: ViewMode = userReadOnly \? "preview" : viewMode/);
  assert.match(editor, /disabled=\{userReadOnly && mode !== "preview"\}/);
  assert.match(editor, /canEdit && !userReadOnly && effectiveViewMode !== "preview"/);
  assert.match(editor, /readOnlyLabel/);
});
