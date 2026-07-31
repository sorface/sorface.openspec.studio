## Context

См. `proposal.md` и delta specs. В проекте уже есть обнаружение OpenSpec/Codex/GigaCode, безопасный process runner, AI operation lifecycle, SSE, document drafts и diff review. Однако frontend пока использует OpenSpec только как дерево файлов, а backend не предоставляет отдельный schema-aware orchestration слой для `status`, `instructions`, `validate`, генерации артефактов и архивирования.

OpenSpec CLI является источником истины для schema, зависимостей и статуса. Содержимое Store и возвращаемые CLI поля `context`, `rules`, `template` являются входом prompt, но не могут менять системные разрешения процесса. Все изменяющие действия должны оставаться изолированными от активного Store до review.

## Goals / Non-Goals

**Goals:**

- Ввести один типизированный orchestration путь от OpenSpec action до agent operation и diff review.
- Изолировать версионные различия CLI в adapter, а продуктовый workflow строить по нормализованным DTO.
- Вычислять минимальную writable область из выбранного action и проверять её до и после provider/OpenSpec процессов.
- Переиспользовать operation, SSE, drafts и provider adapters вместо параллельного механизма фоновых задач.
- Сохранить read-only OpenSpec-команды доступными независимо от настройки AI.

**Non-Goals:**

- Не интерпретировать schema или порядок артефактов на frontend.
- Не давать agent прямой доступ к реальному Store и не запускать произвольные команды из prompt.
- Не объединять принятие draft, запись на диск и Git delivery в одно действие.
- Не гарантировать совместимость с неизвестным CLI: неподдерживаемый контракт блокируется явно.

## Decisions

### 1. Нормализованный OpenSpec adapter поверх безопасного runner

Backend adapter предоставляет типизированные операции capability detection, list, status, instructions, show, validate, new change и archive. Он запускает только фиксированные argv, устанавливает Store как рабочий каталог, ограничивает timeout/output, не использует shell и нормализует JSON/diagnostics в стабильные внутренние DTO.

Выбор adapter вместо прямых CLI-вызовов из handlers изолирует различия версий и позволяет unit-тестировать fixtures. Альтернатива — зафиксировать одну версию OpenSpec — противоречит baseline capability detection и усложняет автономную поставку.

### 2. Backend вычисляет action model

Application service объединяет status и instructions в `OpenSpecAction`: project ID, change ID, schema, artifact/action kind, status fingerprint, dependency paths, output patterns, read roots и write patterns. Frontend получает готовые `available`, `blocked` и `reason`, но не вычисляет зависимости самостоятельно.

Fingerprint строится из нормализованного status, instruction metadata и контрольных сумм зависимостей. Перед созданием operation service повторяет read и возвращает `OPENSPEC_STATUS_STALE` при расхождении.

### 3. API разделяет read model и изменяющие intents

Read API:

- `GET /api/v1/projects/{id}/openspec/changes`
- `GET /api/v1/projects/{id}/openspec/changes/{change}`
- `POST /api/v1/projects/{id}/openspec/validate`

Изменяющий intent:

- `POST /api/v1/projects/{id}/openspec/actions` с `kind`, change/name, artifact, user goal, provider/model и status fingerprint.

Endpoint действий не принимает executable, argv, working directory, output path или raw OpenSpec instruction от клиента. Создание change, продолжение/исправление артефакта и archive представлены разными `kind`, но используют общий operation lifecycle.

### 4. Двухфазный operation workspace

Для действия создаётся снимок активного Store в управляемом каталоге операции под `~/.osstudio`. Все OpenSpec read-команды и agent выполняются в нём; подключённые кодовые репозитории монтируются только как read-only context. Для нового change adapter сначала создаёт scaffold в снимке. Для archive CLI также работает только в снимке.

После процесса audit сравнивает snapshot и workspace. Результат не копируется в активный Store: он преобразуется в набор file mutations (`create`, `update`, `delete`, при необходимости согласованные пары rename) и normalised diff. Альтернатива — временный Git worktree — сильнее зависит от чистоты и ветки Store; файловый snapshot соответствует существующей AI-изоляции.

### 5. Prompt builder имеет фиксированные секции доверия

Prompt собирается backend в порядке: системная цель действия и запреты; нормализованная OpenSpec instruction; context/rules/template как помеченный недоверенный input; завершённые dependency artifacts; пользовательская цель; подтверждённый manifest контекста; точные output patterns.

Provider получает prompt через stdin и operation workspace как единственный writable root. Текст из Store не преобразуется в команды и не расширяет environment/executable allowlist.

### 6. Action-specific аудит и post-validation

Для artifact action допустимы только output paths, возвращённые instructions, внутри выбранного change. Для создания change допустим только новый каталог этого change. Для archive допустимы выбранный change, соответствующий archive target и baseline specs, изменённые самим CLI archive.

Audit сначала проверяет канонические пути и symlink escapes, затем типы мутаций и лимиты, после чего повторно запускает status/validate в operation workspace. Любой путь вне action scope отклоняет результат целиком. Diagnostics сохраняются с operation и показываются рядом с diff; структурная ошибка не становится completed action.

### 7. Draft mutation set расширяет существующий review

Существующий diff review переиспользуется для create/update. Для archive он получает атомарный mutation set с delete/rename semantics. Принятие создаёт внутренние draft revisions и tombstones, но не меняет working tree. Отдельный существующий Save/Write workflow применяет согласованный набор с optimistic concurrency и rollback при конфликте.

Это сохраняет продуктовый инвариант явной записи. Альтернатива — применять archive сразу после подтверждения — обходит drafts и делает частичное восстановление сложнее.

### 8. OpenSpec frontend как отдельная feature

Feature `openspec-workflow` содержит API client, controller/state machine и панель. Контроллер загружает overview, хранит выбранный change, запускает validate/action, подписывается на существующий SSE и передаёт awaiting-review operation существующему diff review.

Дерево документов остаётся навигацией по файлам. OpenSpec-панель отвечает за lifecycle и показывает progress, dependencies, diagnostics и recovery actions. После принятия/записи либо внешнего изменения Store controller инвалидирует snapshot и заново запрашивает backend status.

### 9. Cancellation, limits и аудит

OpenSpec и provider процессы получают общий operation context с cancellation и отдельными timeout. Останавливается всё дерево дочерних процессов. Ограничиваются число/размер dependency files, общий prompt, stdout/stderr и итоговый diff.

Аудит сохраняет project/change/action, schema, provider/model, безопасный argv kind, timestamps, exit code, status fingerprints и correlation ID без prompt content, secrets или полного содержимого документов.

## Risks / Trade-offs

- [CLI JSON меняется между версиями] → Использовать versioned fixtures, capability probe и fail-closed `TOOL_VERSION_UNSUPPORTED`.
- [Snapshot большого Store дорогой] → Переиспользовать существующий snapshot primitive, исключать `.git` objects из копирования там, где это безопасно, и вводить лимиты/отмену.
- [Archive затрагивает много типов файлов] → Представлять результат атомарным mutation set и не разрешать частичное принятие archive.
- [Status меняется после подготовки UI] → Проверять fingerprint непосредственно перед запуском и перед принятием.
- [Prompt injection из Store] → Маркировать входы недоверенными, фиксировать executable/action scope вне prompt и проводить post-operation audit.
- [Validate может быть медленным] → Выполнять с timeout, потоковым состоянием и возможностью повтора; не кэшировать его как источник истины.
- [Draft tombstones усложняют запись] → Добавить транзакционный apply и rollback, покрыть create/update/delete/rename конфликтами.

## Migration Plan

1. Добавить OpenSpec adapter и read API за недоступным по умолчанию frontend route.
2. Добавить action model, operation metadata и action-specific audit с backend тестами.
3. Расширить diff/draft mutation model для archive без изменения существующих Markdown draft сценариев.
4. Подключить OpenSpec feature panel и read-only status/show/validate.
5. Включить agent actions создания и подготовки артефактов, затем archive preview.
6. При rollback скрыть панель и routes; незавершённые operations пометить failed/cancelled, не удаляя Store или принятые drafts.
