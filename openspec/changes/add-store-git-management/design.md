## Context

См. `proposal.md` — Why. Текущий `gitstatus` service выполняет только read-only команды и Git-панель прямо помечена как режим просмотра. При этом в проекте уже есть проверка канонического пути Store, ограниченный process runner, CSRF/session middleware и общий lifecycle длительных операций. Новое поведение пересекает frontend, HTTP transport, Git adapter и operation lifecycle, поэтому требует отдельного design.

Store остаётся единственным репозиторием, в который приложение может писать. Подключённые кодовые репозитории нельзя принимать как произвольный путь в Git API. Приложение не хранит credentials и не может открывать интерактивный terminal prompt.

## Goals / Non-Goals

**Goals:**

- Расширить существующий read model Git status ветками, remotes, upstream и divergence без второго источника истины.
- Разделить короткие локальные mutations и длительные сетевые операции с едиными проверками Store.
- Сделать commit воспроизводимым: подтверждённый пользователем staged set должен совпадать с фактическим index непосредственно перед commit.
- Сохранить feature-first frontend и типизированные API errors.
- После любой операции перечитывать Git как источник фактического состояния.

**Non-Goals:**

- Универсальный Git client или произвольный command runner.
- Автоматическое разрешение divergence, конфликтов и dirty worktree.
- Собственная credential storage либо UI для паролей и SSH passphrase.
- Фоновая синхронизация remote без пользовательского действия.

## Decisions

### 1. Один Store Git service поверх разрешённых команд

Существующий `backend/internal/storegit` application service расширяется и становится владельцем status, branches, remotes и mutations Store наряду с уже реализованным lifecycle Store clone. Существующий read-only `gitstatus` код будет перенесён либо вызван через этот service, чтобы validation, parsing и error mapping не расходились.

Service получает `projectId`, загружает проект и каждый раз канонически валидирует `StorePath`. HTTP не принимает filesystem path или произвольные Git arguments. Разрешённые команды строятся только из типизированных inputs: action, относительные paths, branch, remote, target branch и commit message.

Альтернатива — добавить mutations прямо в `gitstatus`. Она оставляет package с неверной ответственностью и усложняет тестирование сетевых операций, поэтому отклонена.

### 2. Расширенный status остаётся единственным read model

`GET /api/v1/projects/{projectId}/git/status` возвращает:

- `branch`, `detached`, `head`;
- `upstream`, `ahead`, `behind`;
- массивы `localBranches`, `remoteBranches`, `remotes`;
- `changes`, staged/unstaged diff и `diffTruncated`.

Данные собираются bounded Git-командами с machine-readable delimiters. Отсутствующий upstream является нормальным состоянием, а не ошибкой. После mutation frontend получает новый status в ответе либо немедленно вызывает refresh; сервер не пытается поддерживать параллельный cached Git state в SQLite.

Альтернатива — отдельные endpoints для каждой части status. Она увеличивает число гонок и загрузочных состояний без пользы для локального репозитория.

### 3. Локальные mutations синхронны и optimistic concurrency проверяется сервером

Branch create/switch, stage, unstage и commit выполняются короткими HTTP requests с CSRF. Перед командой service повторно проверяет repository identity и необходимые preconditions.

Stage/unstage принимает непустой список нормализованных относительных путей. Каждый путь должен оставаться внутри Store после canonical resolution. Команда использует path separator `--`; unstage меняет только index.

Commit request содержит `paths`, `message` и ожидаемый `head`. Backend проверяет conventional commit subject, текущий HEAD и точное равенство фактического staged set подтверждённому списку. При расхождении возвращается `GIT_INDEX_CHANGED` или `GIT_HEAD_CHANGED`; автоматического исправления index нет.

Альтернатива — автоматически stage выбранные файлы внутри commit endpoint. Она смешивает два явно разделённых пользовательских решения и может затереть ранее подготовленный index, поэтому отклонена.

### 4. Branch switch разрешён только при полностью чистом Store

Перед create/switch backend проверяет staged, unstaged и untracked изменения. Local switch использует точное существующее ref name. Remote-tracking switch требует отдельные `remoteBranch`, `localBranch` и подтверждение UI; backend проверяет отсутствие local ref и создаёт tracking branch без эвристического выбора.

Branch name проверяется через Git `check-ref-format --branch` и дополнительно передаётся как отдельный argument после разрешённого subcommand. UI выполняет раннюю проверку только для обратной связи; backend остаётся authoritative.

Альтернатива — предлагать stash. Она создаёт скрытое состояние и новый destructive recovery workflow, поэтому исключена.

### 5. Fetch и push используют общий operation lifecycle

`POST .../git/fetch` и `POST .../git/push` создают operation с типом, project ID, branch/remote metadata и возвращают `202 + operationId`. Runner запускает Git без TTY, с timeout, output limit и cancellation context. UI получает status через существующий operation polling/SSE механизм и после terminal state перечитывает Git status.

Push не принимает произвольный refspec. При upstream используется обычный `git push`; без upstream backend принимает существующий remote и проверенное target branch name, затем выполняет эквивалент безопасного `push --set-upstream <remote> HEAD:<target>`. Флаги force не представлены в input model.

Альтернатива — держать fetch/push HTTP request открытым. Она ухудшает cancellation и не согласуется с уже существующей моделью длительных операций.

### 6. Ошибки нормализуются на границе adapter

Git exit status и ограниченный stderr преобразуются в стабильные коды: `WORKTREE_DIRTY`, `GIT_INVALID_BRANCH`, `GIT_BRANCH_EXISTS`, `GIT_REMOTE_NOT_FOUND`, `GIT_DETACHED_HEAD`, `GIT_INDEX_CHANGED`, `GIT_HEAD_CHANGED`, `GIT_AUTH_FAILED`, `GIT_NON_FAST_FORWARD`, `GIT_TIMEOUT` и общий `GIT_OPERATION_FAILED`.

В API не возвращаются command line, абсолютный путь, raw stderr, remote credentials или environment. Correlation ID и operation events дают достаточный аудит. Локально допустимо логировать только action, project ID, нормализованный result code, duration и operation ID.

### 7. Git-панель строится как state-driven workflow

`features/git` получает единый controller с `status`, form state и текущей operation. Панель состоит из:

- header branch/upstream/ahead-behind и меню branch;
- action row для fetch и push;
- change list с явным staged/unstaged selection;
- diff review;
- commit composer с subject validation и точным summary.

Branch и upstream confirmations являются modal dialogs с focus management. Во время операции блокируются только конфликтующие mutations; чтение status и навигация остаются доступными. Введённые branch/message значения сохраняются при recoverable error.

### 8. Пользователь управляет checkout репозиториев контекста без расширения AI-прав

`repository.Service` при каждом list/switch/update заново разрешает сохранённый repository ID внутри выбранного project, проверяет canonical path в управляемом каталоге и перечитывает Git state. В read model добавляются local branches, remote-tracking branches, upstream и ahead/behind; SQLite не становится источником актуального branch state.

Switch принимает только типизированные `branch` и `remote` значения, сверяет их с фактическими refs и разрешён лишь при полностью чистом worktree. Для remote-tracking ref backend создаёт локальную tracking branch с однозначно выведенным именем. Update выполняет `fetch --prune` и `pull --ff-only` для текущего upstream; merge, rebase, stash, reset, commit и push не представлены в API.

Карточка репозитория на странице «Контекст» содержит branch selector и кнопку «Получить обновления». Действия отправляются через CSRF-protected endpoints, блокируются только для выбранной карточки и после ответа заменяют её данными backend. Маркер `read-only` переименовывается в понятный `AI: read-only`, поскольку пользовательский checkout не меняет права agent.

## Data flow

1. Controller запрашивает расширенный status для активного project ID.
2. Пользователь выбирает типизированное действие; UI валидирует форму и отправляет CSRF-protected request.
3. HTTP handler передаёт project ID и DTO в Store Git service.
4. Service повторно валидирует Store, preconditions и значения, затем вызывает разрешённую Git-команду через bounded runner.
5. Локальная mutation возвращает новый status; fetch/push возвращает operation ID и публикует lifecycle events.
6. Controller применяет только серверный status; после terminal operation выполняет refresh.
7. Для репозитория контекста controller отправляет repository ID и точный branch target либо update, затем применяет только перечитанный сервером `RepositoryLink`.

## Path validation, cancellation, timeout и аудит

- Store path берётся только из project repository и проходит существующий canonical validator на каждом request.
- File paths принимаются только как относительные, очищаются, разрешаются внутри Store и передаются Git после `--`.
- Branch/remote values никогда не интерпретируются shell; runner получает executable и массив arguments.
- Local mutations имеют короткий timeout и bounded stdout/stderr; fetch/push получают отдельный сетевой timeout и cancellation context.
- Cancel завершает process group через существующий platform-specific runner и переводит operation в `cancelled`.
- Аудит не содержит diff, содержимое файлов, credentials или raw remote URL с userinfo.

## Risks / Trade-offs

- [Status может устареть между review и action] → Проверять expected HEAD и staged set непосредственно перед mutation и возвращать recoverable conflict code.
- [Git hooks могут менять время выполнения или отклонить commit] → Ограничить процесс timeout, показать нормализованную ошибку; hooks не обходить автоматически.
- [Отмена push не гарантирует отсутствие remote side effect] → После cancel честно перечитать local status и не утверждать, что remote откатился.
- [Remote refs до fetch могут быть устаревшими] → Показывать время последнего успешного fetch в session state и не называть divergence серверно актуальным без fetch.
- [Conventional commit regex может оказаться слишком строгим] → Проверять стабильный минимальный subject `<type>(<optional-scope>)?: <description>` с фиксированным набором type; body не ограничивать кроме общего размера.
- [Checkout контекста может скрыто затереть локальную работу] → Перед switch/update требовать полностью чистый worktree и никогда не выполнять stash/reset/discard.
- [Pull может создать merge commit] → Разрешать только `pull --ff-only`; divergence возвращать как recoverable error.

## Migration Plan

1. Расширить backend read model и тесты, сохранив совместимость существующих полей status.
2. Добавить local mutation endpoints и UI controls под capability detection Git.
3. Подключить fetch/push к operation lifecycle и безопасному error mapping.
4. Заменить footer «Только просмотр» на доступные state-driven действия после прохождения интеграционных тестов.
5. SQLite migration не требуется; Git остаётся источником branch/upstream state.

Rollback: скрыть новые controls и routes, вернув read-only Git-панель. Созданные пользователем commits/branches и уже выполненный remote push являются внешним Git state и автоматически не откатываются.
