## Context

См. `proposal.md` — Why. Backend сейчас имеет HTTP transport, Projects service,
SQLite repository и detector системных tools, но не имеет общего runner,
длительных операций, Git adapter или AI adapter. Frontend уже использует общий
JSON transport и project controller, однако repository/context/AI данные
остаются статическими.

Основные ограничения задают delta specs и baseline `local-platform`,
`repository-context`, `ai-operations` и `diff-review`: браузер не получает
прямого доступа к CLI и файловой системе, кодовые репозитории read-only для AI,
а AI-результат не должен менять реальный Store до review.

## Goals / Non-Goals

**Goals:**

- Ввести одну модель длительной операции для clone и agent execution.
- Изолировать provider-specific аргументы и события за adapter interface.
- Гарантировать, что AI не получает writable-доступ к Store или кодовым
  репозиториям пользователя.
- Сделать сохранённое состояние достаточным для reconnect UI и диагностики.
- Сохранить CGO-free и кроссплатформенную сборку.

**Non-Goals:**

- Универсальный terminal runner или API произвольных команд.
- Продолжение дочернего процесса после перезапуска приложения.
- Управление Git authentication; Git использует штатную конфигурацию и
  credential helper процесса пользователя.
- Полное принятие hunks и запись AI-результата в Store.

## Decisions

### 1. Общий operation service и специализированные application services

Backend получит три границы:

```text
HTTP
 ├─ RepositoryService ─ GitAdapter ─┐
 └─ AiOperationService ─ Provider ──┼─ ProcessRunner
              │                     │
              ├─ ContextBuilder     └─ ProcessSupervisor
              ├─ WorkspaceManager
              └─ ResultAuditor
                     │
                  SQLite
```

`ProcessRunner` принимает только заранее собранную команду: абсолютный
executable, фиксированный массив аргументов, cwd, разрешённое окружение, stdin,
timeout и лимиты вывода. Он не принимает shell string. `ProcessSupervisor`
сопоставляет operation ID с cancellation function и платформенным process
group/job object.

Repository и AI services владеют переходами состояния и транзакциями. Adapters
не пишут в SQLite и не формируют HTTP-ответы.

Альтернатива — реализовать `exec.CommandContext` отдельно в каждом adapter.
Она проще локально, но размножает критичные правила timeout, redaction,
ограничения вывода и завершения process tree.

### 2. Единая сохранённая модель длительных операций

SQLite migration добавит:

- `repositories`: project ID, name, canonical path, remote URL, repository
  fingerprint, selected branch, read-only flag и timestamps;
- `operations`: project ID, kind (`repository_clone | ai`), status, безопасные
  input metadata, provider/model, correlation ID, error code, result metadata
  и timestamps;
- `operation_events`: монотонный sequence, operation ID, event type, безопасный
  JSON payload и timestamp;
- `ai_context_entries`: manifest без полного содержимого — source, relative
  path, size, checksum, inclusion reason;
- `operation_audit`: executable label, redacted args, exit code, stop reason,
  output byte counts и duration.

Prompt и финальный provider response хранятся как данные операции, но никогда
не попадают в диагностический журнал. Контент repository files в SQLite не
копируется. Для первого инкремента schema создаётся idempotent DDL рядом с
существующей схемой; schema version вводится до добавления второй миграции.

При старте незавершённые операции атомарно переводятся в failed с
`APPLICATION_RESTARTED`.

Альтернатива — хранить операции только в памяти. Она не позволяет SSE reconnect,
историю и корректное восстановление после restart.

### 3. REST для команд, SSE только для наблюдения

Предлагаемые маршруты:

```text
GET    /api/v1/projects/{projectId}/repositories
POST   /api/v1/projects/{projectId}/repository-clones
GET    /api/v1/projects/{projectId}/repository-clones/{operationId}
DELETE /api/v1/projects/{projectId}/repository-clones/{operationId}
GET    /api/v1/projects/{projectId}/repository-clones/{operationId}/events

POST   /api/v1/projects/{projectId}/ai/context-manifests
POST   /api/v1/projects/{projectId}/ai/operations
GET    /api/v1/projects/{projectId}/ai/operations/{operationId}
DELETE /api/v1/projects/{projectId}/ai/operations/{operationId}
GET    /api/v1/projects/{projectId}/ai/operations/{operationId}/events
```

POST возвращает `202 Accepted` и operation resource. DELETE означает cancel и
идемпотентен для terminal state. SSE использует sequence как `id`; reconnect
читает `Last-Event-ID`, сначала отдаёт сохранённые события, затем подписывает
соединение на in-memory notifier. Heartbeat не содержит бизнес-данных.

REST polling остаётся fallback и источником окончательного состояния. SSE не
используется для команд, чтобы CSRF и retry semantics оставались обычными.

### 4. Clone выполняется только в подтверждённый безопасный target

Git URL parser разрешает HTTPS, SSH (`ssh://`) и scp-like форму только после
отдельной строгой проверки; локальные пути обрабатываются существующим сценарием
подключения, не clone. Значения не начинаются с option и всегда следуют после
`--` там, где Git поддерживает separator.

Target:

1. преобразуется в абсолютный clean path;
2. проверяется как отсутствующий либо пустой каталог;
3. проверяется, что его ancestor не является файлом и target не равен Store,
   data dir или уже подключённому repository;
4. после создания проверяется повторно через canonical path;
5. помечается operation marker в SQLite до запуска Git.

Adapter запускает `git clone --progress -- <url> <target>`. Git progress из
stderr преобразуется в ограниченные progress events; raw remote messages не
возвращаются без sanitization.

После exit code 0 Git adapter получает remote, HEAD, branch/status, repository
fingerprint и проверяет `openspec/config.yaml`. Только затем repository и
terminal operation event сохраняются одной транзакцией.

При cancel/failure автоматически удаляется target лишь когда operation создала
его, marker/fingerprint совпадает и в каталоге нет признаков внешней подмены.
При validation или SQLite error после успешного clone каталог сохраняется и UI
предлагает явное удаление.

Альтернатива — clone во внутренний managed directory. Явный target соответствует
baseline UX и не создаёт неочевидное владение пользовательскими репозиториями.

### 5. AI работает в изолированном operation workspace

До запуска `WorkspaceManager`:

1. повторно проверяет активный Store root и context checksums;
2. создаёт уникальный каталог внутри application data dir;
3. копирует только разрешённые Store text files в `baseline/` и `working/`,
   сохраняя relative paths и запрещая symlink/device files;
4. делает `working/` единственным provider cwd;
5. формирует prompt envelope с инструкцией, manifest и содержимым выбранных
   read-only context files в пределах лимита.

Подключённые code repositories не передаются через Codex `--add-dir`: этот
аргумент делает каталоги writable. Их выбранные текстовые файлы включаются в
stdin envelope с source labels и контрольными суммами.

Codex adapter для обнаруженной версии использует эквивалент:

```text
codex exec --json --ephemeral --sandbox workspace-write
  --skip-git-repo-check --cd <operation-working-dir> [--model <model>] -
```

Prompt передаётся через stdin, `--dangerously-bypass-approvals-and-sandbox` и
произвольные `-c` запрещены. Adapter игнорирует пользовательские дополнительные
аргументы, пока не появится отдельная allowlist spec.

GigaCode adapter реализует тот же interface, но его точные аргументы выбираются
после capability probe установленной версии. Если поддерживаемого
неинтерактивного режима нет, provider доступен для detection, но запуск
возвращает `AI_PROVIDER_UNSUPPORTED`.

После процесса `ResultAuditor`:

- повторно проверяет Store и code repositories на отсутствие изменений;
- отклоняет symlink, device, binary, secret и path escape в `working/`;
- сравнивает `baseline/` и `working/`;
- сохраняет нормализованный diff и финальный response;
- переводит операцию в awaiting_review;
- удаляет workspace после сохранения результата либо сохраняет его на короткий
  диагностический TTL при internal error.

Альтернатива — запуск в реальном Store с последующим rollback. Она небезопасна
при исходно грязном tree, cancellation и crash между изменением и rollback.
Временный Git worktree также отвергнут: baseline запрещает автоматическое
создание worktree и это меняет metadata пользовательского repository.

### 6. Контекст имеет review token, а не доверяет списку путей из browser

`POST .../context-manifests` принимает intent (открытый документ, selection,
spec/change и выбранные repository files). Backend разрешает пути относительно
доверенных roots, проверяет symlink, denylist, текстовый формат и лимиты, затем
возвращает manifest и короткоживущий opaque review token.

Создание AI operation передаёт token, prompt, provider и model. Backend заново
вычисляет checksums; browser не может добавить путь после review. Default
limits: 100 файлов, 1 MiB на файл, 4 MiB суммарно и 1 MiB stdout/stderr на
операцию. Значения находятся в server config и возвращаются в capabilities.

Альтернатива — передавать полное содержимое из browser. Это создаёт второй,
менее надёжный путь чтения и позволяет расходиться с файловым состоянием.

### 7. Frontend разделяется на repositories и ai-operations features

`features/repositories` содержит API types/client/controller и clone dialog.
Controller загружает server state по active project, подключается к SSE только
для активной операции, умеет fallback polling и abort при смене проекта.

`features/ai-operations` содержит context manifest review, operation client,
event reducer и result view. `AiAssistantPanel` становится представлением над
controller: unavailable provider, context review, queued/running/cancelled,
error с correlation ID и awaiting_review diff.

Статические repository/context данные удаляются только после появления
server-backed эквивалента. Локальный prompt сохраняется при network error.

### 8. Cancellation, timeout и завершение process tree платформенно изолированы

Runner использует context timeout и двухфазное завершение: graceful signal,
короткий grace period, затем force kill. Unix adapter создаёт отдельную process
group; Windows adapter использует Job Object или изолированный fallback с
явно задокументированной гарантией.

Clone timeout по умолчанию 30 минут, AI timeout — 10 минут. Application shutdown
отменяет все supervisor entries до закрытия SQLite и ожидает их завершения в
ограниченный срок.

## Risks / Trade-offs

- [Копирование Store увеличивает latency и disk usage] → Копировать только
  разрешённые файлы, установить size limits и всегда очищать terminal workspace.
- [Codex CLI меняет JSONL schema] → Парсер принимает неизвестные события как
  diagnostic и contract tests используют fixtures нескольких версий.
- [GigaCode отсутствует в среде разработки] → Реализовать adapter contract и
  unavailable/unsupported path; успешный end-to-end тест включать только при
  наличии CLI, unit tests работают на fixtures/fake executable.
- [Git credentials могут запросить интерактивный ввод] → Запускать без PTY,
  ограничить timeout и возвращать безопасную authentication error; secrets не
  перехватывать и не сохранять.
- [SSE consumer отстаёт] → Источником истины остаётся SQLite, in-memory channel
  только будит reader; события имеют лимит payload.
- [Права `read-only` не являются OS sandbox для стороннего CLI] → Реальные
  repository roots вообще не передаются provider как directories; snapshot
  audit проверяет отсутствие внешних изменений.
- [Удаление незавершённого clone может затронуть внешние данные] → Удалять
  автоматически только новый target с совпадающим operation marker/fingerprint;
  в остальных случаях требовать явного действия.

## Migration Plan

1. Добавить idempotent schema migration и repositories/operations repositories;
   существующие проекты остаются валидными с пустыми коллекциями.
2. Ввести runner и fake adapters, затем Git clone vertical slice.
3. Подключить repository UI и проверить cancel/restart/error states.
4. Ввести workspace/context/audit и Codex adapter.
5. Добавить AI API/SSE и заменить статическую AI-панель.
6. Добавить GigaCode contract adapter и graceful unavailable behavior.
7. Прогнать `npm run check`, production build и платформенные release builds.

Rollback бинарника не удаляет новые таблицы; старая версия их игнорирует.
Созданные пользователем clone-каталоги не удаляются при rollback. Перед
выключением новая версия переводит активные операции в terminal state.

## Open Questions

- Точные non-interactive flags GigaCode будут определены capability probe и
  fixtures поддерживаемой версии без изменения общего API или lifecycle.
- Значения default limits могут быть скорректированы по измерениям, сохраняя
  обязательность конечных лимитов.
