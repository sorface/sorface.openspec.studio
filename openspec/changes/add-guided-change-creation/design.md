## Context

См. `proposal.md` — Why и delta specs для наблюдаемого поведения. Сейчас `OpenSpecPanel` хранит описание и имя локально, `explore` является одной terminal operation с текстовым `finalResponse`, а `create_change` заново запускает agent и последовательно генерирует proposal и specs. Codex работает с `--ephemeral`, GigaCode — с `--non-interactive`, поэтому ожидание ответа пользователя внутри одного provider-процесса недоступно и не должно становиться контрактом Studio.

Существующие operation workspace, diff audit, accept/draft/write и SSE уже обеспечивают безопасную границу AI. SQLite уже является metadata storage проекта, а визуальный Markdown editor доступен как изолируемый React-компонент.

## Goals / Non-Goals

**Goals:**

- Ввести восстанавливаемую project-scoped state machine создания change, не смешивая её с lifecycle отдельной OpenSpec operation.
- Поддержать итеративные вопросы и ответы через последовательность read-only agent-операций.
- Получать proposal и предлагаемые имена структурированно и безопасно разбирать provider output.
- Материализовать после принятия имени только proposal и сохранить существующий review-before-write.
- После успешной записи открыть фактический `proposal.md` через Documents API и общий редактор.

**Non-Goals:**

- Возобновлять нативную provider session или отправлять ответы через stdin работающему процессу.
- Делать draft-сессию источником OpenSpec status; до записи источником истины остаётся только активный Store.
- Давать AI права записи во время исследования либо расширять область записи подключённых repositories.
- Создавать отдельный Markdown-формат для замысла: это session payload, а не скрытый файл Store.

## Decisions

### 1. Draft-сессия хранится в SQLite как версионированный JSON payload

Добавляется таблица `openspec_change_drafts` с `project_id` как primary/foreign key, `payload_json`, `created_at` и `updated_at`. Domain DTO содержит schema version, `intent`, `stage`, `summary`, `questions`, `answers`, `assumptions`, `proposal`, `suggestedNames`, `proposalAccepted`, `changeName` и исследованный fingerprint.

Project-scoped API предоставляет GET, PUT и DELETE одного draft. PUT принимает полное валидированное состояние и используется frontend с debounce; сервер ограничивает размер Markdown, количество вопросов/вариантов и допустимые stage. Удаление проекта каскадно удаляет draft.

Альтернатива — `localStorage`. Она проще, но не принадлежит backend project model, сложнее тестируется рядом с API и теряется при смене browser profile. Предыдущий одноразовый wizard не требовал долговечности; итеративный сценарий меняет это предположение.

### 2. Creation session state отделена от operation status

Сессия использует состояния `intent | clarifying | proposal | naming | creating`. Каждая AI-операция сохраняет прежние статусы `queued | running | validating | awaiting_review | ...`; `needs_input` является результатом раунда, а не новым статусом process supervisor.

Frontend controller после terminal explore разбирает `ActionResult.exploration`, обновляет session и сохраняет её. Отмена останавливает только текущий процесс, не удаляя Markdown или предыдущие ответы.

Альтернатива — добавить `awaiting_input` в operation state machine. Она создала бы ложное ожидание живого provider-процесса и усложнила cancellation/restart.

### 3. Explore возвращает строгий структурированный контракт

`BuildExplorePrompt` получает актуальный Markdown и компактную историю Q/A и требует один JSON object без Markdown fences:

```json
{
  "state": "needs_input | proposal_ready",
  "summary": "...",
  "questions": [{"id":"...","prompt":"...","why":"...","kind":"text|single_choice|multi_choice","options":[]}],
  "assumptions": ["..."],
  "proposal": "...",
  "suggestedNames": ["..."]
}
```

Backend parser извлекает object даже при допустимой code fence-обёртке, валидирует enum, размеры, уникальность question id, максимум пять вопросов, kebab-case имена и наличие proposal в `proposal_ready`. Некорректная структура завершает operation безопасной ошибкой `AI_RESULT_INVALID`. В `ActionResult` сохраняются структурированное поле и короткий `finalResponse` для совместимости.

Prompt требует исследовать baseline specs и `openspec/config.yaml`, но не раскрывает UI скрытые reasoning, команды или сырые provider events. Для каждого раунда сохраняются cancellable context, отсутствие timeout для explore и audit пустого diff.

Альтернатива — парсить вопросы из произвольного Markdown. Такой контракт нестабилен, не позволяет надёжно выбрать widget ответа и плохо тестируется.

### 4. Каждый ответ запускает новую ephemeral/non-interactive operation

Frontend собирает bounded handoff: исходный intent, последнее summary, структурированные вопросы/ответы, допущения и необязательный feedback к proposal. Полная история технических событий не передаётся. Изменение intent очищает proposal acceptance и отмечает результат устаревшим.

Контекст Store проверяется fingerprint при начале раунда и перед созданием. При внешнем изменении UI сохраняет пользовательский ввод, но требует повторного исследования.

### 5. `create_change` материализует принятый proposal без повторной генерации AI

`StartOpenSpecActionInput` получает `proposal`. Для `create_change` provider и goal больше не обязательны: backend создаёт change только в изолированном operation workspace через adapter, получает фактический proposal output path из OpenSpec instructions, проверяет его нахождение внутри нового change и записывает принятый Markdown. Затем общий audit показывает единственную ожидаемую create-мутацию proposal плюс служебные файлы, созданные CLI, если они входят в change scope.

Операция проходит существующие `awaiting_review → accepted draft → written` стадии. Delta specs не генерируются. После write controller удаляет creation draft, обновляет overview/documents, выбирает change и сообщает workspace путь `openspec/changes/<name>/proposal.md`.

Альтернатива — повторно попросить agent создать proposal после выбора имени. Это может изменить уже принятый пользователем текст и делает review этап недостоверным.

### 6. UI выносится в отдельную страницу ChangeCreationWizard

`OpenSpecPanel` остаётся точкой запуска и отображения существующих changes, а новый компонент получает controller/session и render-функции этапов. При запуске `OpenSpecPanel` переключает свою основную content-area на самостоятельную страницу мастера: без backdrop, modal dialog и затемнения соседнего интерфейса. Страница занимает всю доступную область workspace, использует общий `RichMarkdownEditor` для intent и proposal с разными `documentId`, а справа показывает onboarding, progress/activity, question cards, assumptions и naming suggestions.

Основные действия имеют AI-иконку и текст. Вопросы поддерживают text и варианты, все controls имеют label, error/status regions используют `aria-live`. Мастер является обычной landmark-страницей и не удерживает focus; закрытие или возврат восстанавливает OpenSpec overview, не удаляя draft. На узкой ширине grid становится одной колонкой.

После успешного `write` parent callback переключает `workspaceMode` в `documents` и вызывает Documents controller для открытия реального proposal path. Технический OpenSpec panel остаётся доступен для specs/design/tasks, validate и archive.

WorkspaceSidebar хранит идентификатор явно выбранной document scope и дополнительно выводит change scope из пути открытого `openspec/changes/<name>/...` документа. Такой derived scope восстанавливает панель после загрузки и после программного открытия нового proposal. Для change scope close-control не рендерится; документация и архив остаются закрываемыми.

Сворачивание основной навигации управляет только её grid-колонкой. Если активен change scope, `selectedScopeId` не очищается, а отдельная колонка `document-tree-panel` сохраняет ширину на desktop и адаптивных breakpoints.

### 7. Documents запускает последовательные действия change из toolbar открытого proposal

Для открытого `openspec/changes/<name>/proposal.md` Workspace связывает документ с тем же change и добавляет в Milkdown toolbar компактное контекстное действие: «Сформировать specs» до появления delta specs и «Обновить specs» после их появления. Кнопка видна только для активного proposal, использует общий UI-шрифт и не перегружает панель техническими командами OpenSpec. Enabled-состояние использует явный green action, а disabled-состояние сохраняет непрозрачные нейтральные фон, border, иконку и текст с достаточным контрастом; tooltip объясняет причину недоступности.

До готовности specs toolbar `proposal.md` показывает только действие specs. Когда specs имеют status `done`, presentation показывает вторичное действие «Перегенерировать diff specs» и основное design-действие: «Создать design.md» до появления design и «Обновить design.md» после. Действие tasks в контексте proposal никогда не отображается.

Для открытого `design.md` Workspace передаёт в то же toolbar-действие контекст artifact `design`. Presentation выбирает только tasks action, если specs и design имеют status `done`: до появления tasks label равен «Создать tasks.md», после — «Обновить tasks.md». Operation review остаётся привязан к тому же change и показывается без навигации из design.

Для открытого `openspec/changes/<name>/tasks.md` Workspace вычисляет progress из текущего Markdown draft, а не из сохранённого OpenSpec status: все строки task-list с пустым checkbox входят в total, checkbox `x` либо `X` — также в completed. Компактный `completed/total` badge передаётся в существующий portal контекстных toolbar actions и поэтому обновляется синхронно с `documents.markdown`, включая несохранённые изменения.

Hover-состояния обеих кнопок изменяют цвет, border и shadow без `transform`, поэтому не сдвигают controls и соседние элементы toolbar.

Если proposal изменён, любое artifact-действие сначала выполняет обычный Documents save; при ошибке сохранения agent не запускается. После записи controller заново получает details и fingerprint change, чтобы не отправить операцию с устаревшим контекстом, и запускает выбранное доступное действие с безопасной целью по умолчанию.

Progress и bounded-история OpenSpec-операций выбранного project/change отображаются в сворачиваемой правой колонке Documents workspace. Выбор записи, а также переход активной операции в `awaiting_review`, открывает отдельный modal dialog шириной до 1380 px: полный результат и диагностика находятся над двухколоночными read-only Markdown editors «До / После», а reject/accept и последующая запись draft остаются внутри этого диалога. Backend не возвращает `input_json`, общий `OpenSpecOperationPanel` сохраняет review-before-write и Store-only scope, а `workspaceMode` и выбранный документ не меняются.

После успешного `writeOpenSpecDraft` callback изменения Store обновляет две независимые модели чтения: Documents перечитывает дерево файлов, а Task Context повторно вычисляет `git status` активного worktree. Это устраняет устаревший `dirty` в topbar после создания agent нового файла; дополнительная запись документа для обнаружения Git-изменения не требуется.

### 8. Path validation, cancellation, timeout и аудит

- Draft API принимает только существующий project id; пользовательские значения не используются как файловые пути.
- Имя change проходит текущую kebab-case, traversal, option-like, symlink и uniqueness проверки.
- Proposal output path берётся из adapter instructions и после `filepath.Rel` обязан находиться внутри `openspec/changes/<name>` operation workspace.
- Explore остаётся read-only и отменяемым без deadline; create использует существующий ограниченный timeout и supervisor.
- Audit обязан подтвердить пустой diff для explore и change-scoped diff для create; Store меняется только через write принятого draft set.
- Audit записи, commit и push code repositories остаются запрещены.

### 9. Task-context и публикация образуют одну группу topbar

Селектор текущей задачи остаётся основным текстовым элементом контекста. Компактная publish-иконка размещается непосредственно после него в том же flex-контейнере, а не внутри удалённого блока server/save status. Так пользователь считывает действие как публикацию артефактов выбранной ветки, при этом статусы workspace сохраняют независимое центральное положение.

Кнопка сохраняет доступное `aria-label` и tooltip, явные hover/focus/disabled-состояния и не увеличивает визуальную высоту селектора. На узкой ширине группа сжимается как единое целое, не меняя порядок элементов.

### 10. Master specs доступны пользователю только для просмотра

Путь `openspec/specs/<capability>/spec.md` классифицируется frontend как baseline master spec. Дерево документов использует отдельный зелёный marker и badge `MASTER`, а редактор вычисляет эффективный режим `preview` и не рендерит в header документа mode switcher, историю, меню дополнительных действий и save. Зелёная метка read-only остаётся видимой. Отдельный presentation-флаг применяется только к master spec, чтобы не менять самостоятельно поведение delta specs. Ограничение находится только на presentation/controller boundary: Documents API и OpenSpec agent workflow остаются способными записывать baseline specs после предусмотренного review.

Тот же пользовательский read-only boundary применяется к delta specs по путям `openspec/changes/<change>/specs/<capability>/spec.md` и legacy `spec/<capability>/spec.md`, но с отдельной подписью `Diff spec`. Обновление delta specs выполняется через контекстное agent-действие и review-before-write, а не прямой Markdown editor.

### 11. Remote-обновление task-ветки выполняется только fast-forward

Рядом с task selector и публикацией topbar показывает отдельное действие получения изменений. Backend работает только с активным Store worktree, использует настроенный upstream текущей ветки и выполняет `git pull --ff-only --no-rebase` без интерактивного ввода. Незакоммиченные изменения не stash-ятся и не сбрасываются: Git сохраняет их при безопасном обновлении либо отклоняет операцию при пересечении файлов. Расхождение истории также возвращается как исправимая конфликтная ошибка без merge-коммита.

Успешный ответ сообщает, изменился ли `HEAD`. Frontend в обоих успешных случаях обновляет Task Context, а при новом `HEAD` повторно загружает список документов и содержимое выбранного файла, сохраняя выбранный путь и несохранённый editor draft. Так новые remote-файлы появляются в дереве сразу, а открытый чистый документ получает актуальное содержимое.

### 12. Glob-зависимости OpenSpec instructions раскрываются внутри isolated workspace

`BuildActionPrompt` поддерживает dependency paths OpenSpec как конкретными файлами, так и glob-шаблонами, включая стандартный `specs/**/*.md` для tasks. Шаблон разрешается относительно `changeDir` из instructions, совпадения сортируются и читаются только после проверки, что каждый регулярный файл остаётся внутри isolated Store root. Пустой, некорректный или выходящий за root glob завершает операцию безопасной ошибкой до запуска agent.

### 13. Review actions используют явные primary и secondary-danger варианты

Кнопки в sticky footer широкого operation review не полагаются на браузерное оформление. Общая геометрия задаётся контейнером review actions, принятие использует существующий `primary-submit`, а отклонение — полноценный `secondary-danger` с нейтральным фоном и красным акцентом. Hover и focus меняют только оформление, не размеры или положение кнопок; disabled-состояние остаётся читаемым.

## Risks / Trade-offs

- [Provider периодически нарушает JSON contract] → строгая диагностика, fence-compatible parser, сохранение session и повтор без потери ответов.
- [Большой intent/proposal раздувает SQLite и prompt] → лимиты payload и bounded summary/history.
- [Autosave конфликтует с поздним AI-result] → version/updatedAt optimistic token; UI не применяет устаревший ответ к изменённому intent.
- [Rich editor тяжёлый внутри отдельной страницы] → lazy initialization и разные document id только при смене смыслового документа.
- [Create operation создаёт служебный `.openspec.yaml`] → показывать его в полном diff и разрешать только внутри нового change; не скрывать мутации.
- [Автоматическое открытие файла опережает refresh дерева] → Documents API загружает известный proposal path напрямую, а дерево обновляется независимо.
- [Запись agent draft обновляет только Documents] → единый callback Store change обновляет Documents и Task Context, сохраняя Git источником истины.
- [Remote pull пересекается с локальными правками] → только fast-forward без autostash/reset; Git отклоняет небезопасное обновление, UI показывает отдельную конфликтную ошибку.
- [OpenSpec dependency использует glob вместо файла] → раскрывать bounded-набор совпадений относительно changeDir и повторно проверять scope каждого файла перед добавлением в prompt.
- [Нативное оформление browser делает review actions визуально несогласованными] → назначать явные варианты кнопок и проверять их CSS-контракт rendered-тестом.
- [Общий read-only флаг скрывает controls и у delta specs] → передавать отдельный master-only presentation-флаг для полного удаления header actions.
- [OpenSpec status отстаёт от несохранённых checkbox-правок] → считать progress непосредственно из текущего Markdown editor draft.

## Migration Plan

1. Добавить SQLite schema/table, storage methods и draft API без изменения существующего UI.
2. Расширить explore result/parser и proposal-only create path, сохранив совместимость чтения старых `finalResponse` операций.
3. Добавить frontend session client/controller и отдельную страницу wizard за существующим entry point.
4. Переключить create flow, обновить названия следующих действий, переход в Documents workspace и явное продолжение из proposal к подготовке specs.
5. Сгруппировать task-context selector и publish-action в topbar.
6. Выполнить backend/frontend/integration/browser проверки; старые незавершённые presentation-only wizard states миграции не требуют.

Rollback: вернуть прежнее модальное представление и старый create prompt. Новая таблица безопасно остаётся неиспользуемой; существующие operation и draft records сохраняют совместимый формат.
