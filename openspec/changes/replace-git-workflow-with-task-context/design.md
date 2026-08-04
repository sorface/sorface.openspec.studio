## Context

См. `proposal.md` — Why. Текущий проект хранит `active_worktree_id`, но не имеет таблицы worktree и все сервисы фактически читают `Project.StorePath`. Branch create/switch выполняется в одном каталоге и запрещён при dirty state. Git-панель напрямую предлагает stage, commit, fetch и push.

Store остаётся единственным writable repository. Существующие document, OpenSpec, AI и Git сервисы уже получают проект через repository interface, поэтому разрешение эффективного Store path можно централизовать без передачи filesystem path из frontend. Сетевые Git и agent процессы должны оставаться bounded, cancel-aware и неинтерактивными.

## Goals / Non-Goals

**Goals:**

- Ввести устойчивую связь project → task branch → managed worktree и сделать активный task workspace источником Store path.
- Исключить checkout покидаемого worktree из переключения задачи.
- Привязать preview и публикацию к branch, HEAD, path set и fingerprint.
- Переиспользовать process runner, provider CLI и Git error mapping без новых runtime-зависимостей.
- Свести основной UI к task selector, спокойному local-change indicator и одному действию публикации.

**Non-Goals:**

- Синхронизация с Jira или вывод Jira metadata.
- Универсальный менеджер worktree и произвольных filesystem paths.
- Автоматическое разрешение divergence и удаление task worktree.
- Замена существующего draft review перед записью agent-результата.

## Decisions

### 1. Task workspace является отдельной доменной сущностью без статуса

SQLite получает таблицу `task_workspaces`: `id`, `project_id`, `branch`, `path`, timestamps. Уникальность задаётся по `(project_id, branch)` и по `path`. `projects.active_worktree_id` указывает на выбранную запись; для исходного Store создаётся/возвращается виртуальный либо сохранённый workspace фактической текущей ветки.

Публичная модель содержит только identity, branch, active, dirty и lastOpenedAt. Никаких Jira status, transition или workflow полей нет. Branch является точным пользовательским номером задачи; внутренний UUID используется только для ссылочной целостности и path naming.

Альтернатива — считать список задач из `git branch`. Она не хранит управляемый path и не отличает доступный task workspace от произвольной ветки, поэтому усложняет безопасное переключение.

### 2. Эффективный Store path разрешается в storage/project boundary

`Get/List Project` возвращают `StorePath`, разрешённый через активную запись `task_workspaces`, а также `BaseStorePath` только для внутренних backend-сервисов. Task workspace manager читает исходный Store через отдельный `GetBaseProject`, чтобы избежать рекурсии. Все существующие синхронные document, Git status и OpenSpec services автоматически переходят на active worktree.

Длительные операции должны сохранить resolved path в operation metadata при старте. В этом change publication и новые task операции делают это обязательно; существующие OpenSpec/AI operation metadata расширяются workspace ID/path fingerprint по месту их создания, а run phase не перечитывает изменяемый active pointer.

Альтернатива — обновлять `projects.store_path` при каждом переключении. Она теряет исходный Store, затрудняет восстановление и смешивает постоянную конфигурацию с текущим пользовательским контекстом.

### 3. Worktree создаётся только backend в управляемом каталоге

Manager строит target как `<dataDir>/task-worktrees/<project-id>/<workspace-id>` и никогда не принимает path от HTTP. Branch проверяется `git check-ref-format --branch`. После `git worktree add` manager сверяет `rev-parse --show-toplevel`, common Git dir и фактическую ветку, затем сохраняет запись и active pointer.

Если локальная ветка существует, создаётся worktree этой ветки. Если существует только `origin/<branch>`, создаётся одноимённая tracking branch. Иначе создаётся новая ветка от HEAD исходного Store. Существующая зарегистрированная запись переиспользуется после повторной canonical validation. Покидаемый worktree не проверяется на чистоту и не изменяется.

Команда имеет короткий timeout, bounded output и массив аргументов без shell. Ошибка после создания каталога удаляет только новый каталог текущей операции через `git worktree remove` или узко ограниченный cleanup после проверки target root.

### 4. Publication preview является неизменяемым capability token

`POST .../task-publications/preview` вычисляет текущие task branch и HEAD, собирает только поддерживаемые OpenSpec paths (`openspec/**`, `.openspec.yaml` внутри change при наличии), формирует bounded unified diff, paths и SHA-256 fingerprint. Preview хранится в памяти с TTL как token, аналогично AI manifests, и возвращает task, paths, truncated, message и `generatedBy`.

Agent message generator получает task, paths и diff в read-only режиме через выбранный project provider. Prompt требует один JSON `{subject, body}` и запрещает инструменты/файлы. Subject должен пройти existing conventional commit validation и содержать task branch. Любая ошибка даёт fallback `docs(openspec): publish <task>`; agent не является availability dependency публикации.

Перед commit service повторяет сборку и сравнивает workspace ID, branch, HEAD, paths и fingerprint. Для точного состава используется временный Git index (`GIT_INDEX_FILE`) либо эквивалентный изолированный index flow, чтобы не захватить внешние staged files. После commit выполняется обычный push; без upstream используется существующий `origin` либо первый remote и `HEAD:refs/heads/<task>`. Force flags отсутствуют.

### 5. Публикация синхронно создаёт commit и запускает отслеживаемый push

Preview остаётся коротким HTTP request, включая bounded agent generation с отдельным небольшим timeout. Подтверждение создаёт commit после optimistic checks и запускает существующую Store Git operation для push, возвращая publication result с operation ID. UI закрывает dialog после commit и отображает progress push через существующий polling.

Agent timeout и Git local mutation используют context запроса. Push использует supervisor cancellation и сетевой timeout. Audit сохраняет task, paths count, fingerprint, provider result code, commit SHA и operation ID, но не полный diff.

### 6. Task-first UI заменяет постоянные Git controls

Новый `features/task-context` содержит API, модели, controller, selector и publication dialog. Controller загружает task context и Git status для компактного dirty indicator независимо от workspace mode, выполняет switch/open, после успеха вызывает общий project/documents/OpenSpec refresh key.

`WorkspaceHeader` получает selector между project switcher и spacer и кнопку «Опубликовать». Закрытый selector является одной компактной строкой: только номер задачи, спокойный local-change indicator и chevron — без декоративной иконки, подписи категории и карточной рамки. Popover имеет одно input, компактный список workspaces и inline error без вводного описания Git-механики. Dialog показывает task, file count и message; ручная правка и regeneration вторичны. Git mode удаляется из sidebar/footer и `WorkspaceMode`, но `features/git` и endpoints сохраняются для диагностики и обратной совместимости.

Визуальный язык использует существующие tokens: белая поверхность, мягкая граница только у раскрытого popover, green accent только для primary action, 8–10 px radii, короткие labels и responsive wrapping. На узком viewport provider/server details скрываются раньше task selector.

### 7. Ошибки переводятся в предметный язык

Новые коды: `TASK_BRANCH_INVALID`, `TASK_WORKSPACE_UNAVAILABLE`, `TASK_WORKSPACE_CONFLICT`, `PUBLICATION_EMPTY`, `PUBLICATION_STALE`, `PUBLICATION_SCOPE_INVALID`. Raw command, absolute paths и stderr наружу не выходят.

`GIT_NON_FAST_FORWARD` отображается как «Ветка задачи обновлена в другом месте», auth failure — «Не удалось подключиться к хранилищу», dirty state не участвует в switch task. Correlation ID остаётся во вторичной диагностике.

## Data flow

1. Header загружает `GET .../task-workspaces` и status активного Store.
2. Пользователь выбирает branch; backend валидирует base Store, создаёт/проверяет worktree и атомарно сохраняет active ID.
3. Frontend перечитывает project и зависимые document/OpenSpec controllers; другие task worktree не меняются.
4. «Опубликовать» запрашивает preview; backend собирает разрешённый diff и просит agent сформировать message либо применяет fallback.
5. Пользователь подтверждает token; backend повторяет fingerprint, создаёт точный commit и запускает обычный push.
6. UI показывает progress и после terminal state обновляет local-change indicator.

## Path validation, cancellation, timeout и аудит

- Base Store и worktree каждый раз проходят canonical validator и проверку общего Git repository identity.
- HTTP не принимает filesystem path, refspec, Git flags или executable.
- Branch передаётся только после `check-ref-format`, а worktree target строится из backend UUID внутри configured data root.
- Worktree creation и preview имеют короткие deadlines; agent generation ограничена по времени и размеру; push отменяется через supervisor.
- Cleanup применяется только к target, созданному текущей неуспешной операцией, после проверки parent root и workspace ID.
- Audit хранит task/workspace IDs, action, duration, result code, counts и hashes без diff, credentials и absolute paths.

## Risks / Trade-offs

- [Существующие operation services местами перечитывают Project при run] → Сохранить workspace metadata в input при Start и постепенно перевести run paths на immutable snapshot; покрыть переключение интеграционными тестами.
- [Git запрещает одну ветку одновременно в двух worktree] → Переиспользовать зарегистрированный worktree и возвращать предметный conflict для внешнего незарегистрированного checkout.
- [Agent увеличивает latency preview] → Малый timeout, loading state и немедленный deterministic fallback.
- [Внешний terminal меняет index] → Изолированный index и повторная проверка HEAD/fingerprint перед commit.
- [Низкоуровневые Git endpoints остаются доступны] → Убрать их из основной навигации, сохранить backend для совместимости и диагностических инструментов.
- [Dirty indicator считает несвязанные файлы] → Основной indicator строить по разрешённой publication scope, а полный status показывать только в диагностике.

## Migration Plan

1. Добавить additive SQLite schema и repository methods; существующие projects получают исходный Store как fallback до первого task open.
2. Подключить effective Store resolution и task workspace API, сохранив прежние project/Git contracts.
3. Добавить publication preview/confirm и agent fallback без удаления legacy endpoints.
4. Переключить header/sidebar/footer на task-first UI и убрать Git mode из основной навигации.
5. Пройти backend, frontend, integration и browser проверки; existing users начинают с фактической текущей ветки как task context.

Rollback: вернуть прежние frontend controls и отключить task/publication endpoints. Additive таблица остаётся неиспользуемой; исходный `projects.store_path` не изменяется, task worktree и ветки сохраняются на диске без удаления данных.
