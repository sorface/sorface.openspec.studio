## Why

Аналитик уже редактирует OpenSpec-артефакты внутри Store, но для создания ветки, фиксации результата и отправки изменений вынужден переходить в терминал. Это разрывает основной workflow и не даёт приложению применить существующие ограничения безопасности Store к операциям Git.

## Цель

Дать аналитику безопасный управляемый Git workflow для активного Store: выбрать или создать ветку, проверить изменения, сформировать выборочный commit и отправить текущую ветку в remote, не предоставляя опасных или неявных операций.

## Scope

- Управление только Git-репозиторием активного Store.
- Просмотр текущей ветки, HEAD, upstream, ahead/behind и состояния working tree.
- Обновление сведений о remote через явный fetch.
- Создание локальной ветки и переключение локальных либо remote-tracking веток только при чистом working tree.
- Явный выбор файлов Store для stage/unstage и commit с обязательным сообщением в conventional commits формате.
- Обычный push текущей ветки; при отсутствии upstream — явный выбор remote и имени целевой ветки.
- Понятные состояния выполнения, безопасные ошибки и обновление Git status после каждой операции.
- Явный пользовательский выбор существующей ветки подключённого репозитория контекста и получение её обновлений только fast-forward способом; AI-доступ остаётся read-only.

## Вне scope

- Commit, push и любые AI-записи в подключённые кодовые репозитории.
- Создание, удаление или публикация веток подключённых репозиториев, а также merge/rebase при их обновлении.
- Force push, reset, rebase, merge, pull, stash, discard, amend и удаление веток.
- Разрешение конфликтов и автоматическое исправление non-fast-forward.
- Хранение Git credentials, SSH-ключей или токенов приложением.
- Автоматический commit либо push после записи файла или применения AI diff.

## What Changes

- Git-панель Store становится рабочим центром доставки: показывает ветку, upstream, расхождение с remote, staged/unstaged изменения и diff.
- Добавляются безопасные действия fetch, создание ветки и переключение ветки с блокировкой при грязном working tree.
- Аналитик может явно подготовить или исключить отдельные файлы Store, ввести проверяемое commit message и создать выборочный commit.
- Аналитик может выполнить обычный push текущей ветки; установка upstream требует отдельного явного выбора.
- Все изменяющие Git API ограничиваются каноническим путём активного Store, защищаются CSRF и выполняются как отслеживаемые операции без интерактивного ввода credentials.
- Ошибки dirty worktree, detached HEAD, auth failure, missing upstream, non-fast-forward и исчезнувший remote возвращаются как безопасные коды без автоматического обхода.
- На странице контекста карточка подключённого репозитория получает selector существующих local/remote-tracking веток и действие «Получить обновления»; backend разрешает switch и `pull --ff-only` только для сохранённого репозитория выбранного проекта.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `git-delivery`: расширить baseline безопасным управлением ветками Store, fetch, stage/unstage, выборочным commit и контролируемым push с upstream.
- `workspace-experience`: добавить наблюдаемый аналитический workflow управления Store Git, подтверждения опасных границ и состояния выполнения операций.

## Impact

- Frontend: `features/git` — модели, API-клиент, controller и Git-панель; композиция workspace и уведомления.
- Backend: новые Store Git application service и HTTP endpoints для branch, fetch, stage, commit и push; переиспользование безопасного process runner и project Store validator.
- API: расширение `/api/v1/projects/{projectId}/git/*` типизированными read/write контрактами и безопасными кодами ошибок.
- Тесты: frontend transport/controller/UI contracts, backend service и HTTP integration, защита границ Store и Git failure scenarios.
- Системы: локальный Git CLI и существующий системный credential helper/ssh-agent; новые runtime-зависимости не требуются.

## Риски

- Гонка между показанным status и mutating operation может привести к commit другого набора файлов; backend должен повторно проверять выбранные пути и состояние index непосредственно перед commit.
- Ошибочная установка upstream может отправить ветку не в тот remote; UI и API должны требовать явные значения и показывать точную цель до push.
- Долгие fetch/push нельзя выполнять в HTTP handler без lifecycle; операции должны поддерживать status, cancel и безопасный timeout.
- Git stderr может содержать remote URL или credential hints; наружу возвращаются только нормализованные сообщения и correlation ID.
