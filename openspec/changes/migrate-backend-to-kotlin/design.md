## Context

См. `proposal.md` — Why. Текущий Go backend содержит 59 HTTP routes, четыре SSE endpoints, 11 SQLite-таблиц, около 10 тысяч строк production-кода и 135 Go-тестов. Frontend уже изолирован за `/api/v1`, поэтому его модели и пользовательские сценарии становятся главным контрактом совместимости.

Большинство серверных операций блокирующие: SQLite JDBC, filesystem, Git, OpenSpec и AI CLI. Сервер должен работать локально на macOS, Linux и Windows, восстанавливать существующую SQLite-базу, завершать деревья дочерних процессов и сохранять review-before-write.

## Goals / Non-Goals

**Goals:**

- Заменить production backend на Kotlin без временного сужения функций.
- Сохранить публичные HTTP/SSE/JSON/error и SQLite-контракты.
- Сохранить application/domain/adapters границы и thin controllers.
- Сделать unit, integration и coverage gates обязательной частью `mvn verify`.
- Удалить Go только после автоматического доказательства Kotlin-паритета.

**Non-Goals:**

- Не менять frontend API и пользовательские сценарии.
- Не вводить JPA-модель поверх существующей SQLite-схемы и не переименовывать таблицы.
- Не запускать Go и Kotlin как одновременных writers одной пользовательской базы.
- Не заменять системные CLI библиотечными реализациями.

## Decisions

### 1. Maven multi-layer Spring Boot MVC backend

Backend остаётся в каталоге `openspec.backend`, но Go module заменяется Maven-проектом Kotlin. Используется Spring Boot MVC с virtual threads: JDBC, filesystem и CLI являются блокирующими, поэтому WebFlux добавил бы риск блокировки event loop без продуктовой выгоды.

Пакеты организуются по функциональным областям с подпакетами `api`, `application`, `domain`, `infrastructure` и общими `config`, `process`, `storage`, `security`. Controllers валидируют transport DTO и делегируют use case interfaces; правила путей, статусов и scope не размещаются в controllers.

Альтернатива Ktor отклонена: она легче, но потребовала бы больше собственной инфраструктуры для lifecycle, validation, exception mapping, JDBC transactions, SSE и native metadata. Spring выбран ради проверенных модулей и единообразной production-поддержки.

### 2. Существующая SQLite-схема сохраняется через Spring JDBC и Liquibase

Используется SQLite JDBC с одним writer connection, `foreign_keys=ON`, `busy_timeout=5000` и WAL. Spring JDBC выполняет явные SQL-запросы и транзакции; JPA не используется, чтобы не менять имена таблиц/колонок, ordering, status serialization и конфликтные проверки draft mutations.

`master-databasechangeset.yaml` подключает baseline changeset и последующие YAML changesets. Baseline имеет preconditions: при пустой базе создаёт текущие 11 таблиц и индексы, при существующей совместимой схеме помечается выполненным без пересоздания данных. Author каждого changeset — `Sorface Developer`, у каждого есть comment и preconditions.

### 3. Совместимость фиксируется transport fixtures и black-box integration tests

Текущие frontend types, Go handler tests и сохранённые JSON fixtures используются как контракт. MockMvc/real HTTP integration tests проверяют все routes, status, content type, JSON names, errors, CSRF/Origin и correlation ID. SSE проверяется реальным подключением с `Last-Event-ID`, replay и terminal events.

Unit tests покрывают state transitions, validators, path policy, command construction, redaction, diff/draft conflict, fingerprint и parsers. Integration tests используют временную SQLite-базу, временные Store/repositories и fake executable scripts вместо пользовательских CLI.

JaCoCo считает line coverage всего production Kotlin package; исключаются только generated Spring bootstrap classes, но не controllers, services, adapters, validators или storage. Maven Failsafe запускает `*IT`, Surefire — `*Test`; `jacoco:check` после обоих наборов требует ratio `0.80`.

### 4. ProcessSupervisor является отдельной инфраструктурной границей

CLI запускаются только через `ProcessBuilder` с готовым списком аргументов, фиксированным `cwd`, очищенным environment и stdin. Supervisor хранит process handle по operation id, ограничивает stdout/stderr, применяет timeout и cancellation и завершает descendants через `ProcessHandle.descendants()` перед parent. Platform-specific policy покрывает Windows/macOS/Linux integration tests.

Audit получает только safe executable name, редактированные arguments, exit code, stop reason, byte counts и duration. Prompt, credentials и полный файловый контекст в audit не попадают.

### 5. FileScopePolicy централизует все проверки путей

Относительный путь нормализуется, option-like/absolute/traversal отклоняются, каждый существующий компонент проверяется через real path без следования наружу, а целевой parent проверяется перед create/write. Политика получает явные roots и режим `STORE_WRITE | REPOSITORY_READ | OPENSPEC_DOCUMENT`.

Все document, Git, context, AI и OpenSpec adapters используют одну policy; прямые обращения controller к filesystem запрещены архитектурными тестами.

### 6. Operations и SSE сохраняют единую state machine

Статусы и допустимые переходы моделируются sealed domain types. SQLite transaction атомарно обновляет operation и добавляет event. In-memory broadcaster доставляет новое событие, а SSE endpoint сначала воспроизводит сохранённые events после `Last-Event-ID`, затем подписывается на live stream. После рестарта queued/running/validating переводятся в failed с `APPLICATION_RESTARTED`.

AI/OpenSpec работают в изолированном snapshot активного Store. Audit сравнивает baseline и working tree, создаёт внутренний draft, а запись draft повторно проверяет before-content и scope. Этот lifecycle переносится до удаления Go.

### 7. Self-contained packaging использует jlink/jpackage

Обычная разработка и tests используют JVM, release создаёт platform-specific application image с урезанным runtime, Kotlin backend, SQLite native library и встроенным frontend. Каждая ОС/архитектура собирается на совместимом runner; кросс-компиляция Go больше не предполагается. Launcher сохраняет текущие CLI flags и data-dir semantics.

Native Image рассматривается как последующая оптимизация, но не является условием миграции: jpackage предсказуемее для SQLite JNI, process management и Spring reflection и при этом не требует установленной JVM у пользователя.

### 8. Переход выполняется вертикальными модулями, production остаётся одновариантным

Kotlin-модули переносятся и тестируются внутри Maven-проекта, но пользовательский runtime переключается один раз после полного паритета. Go остаётся эталоном только до финального шага и никогда не работает параллельно с Kotlin на одной базе. После успешных contract tests, frontend check, coverage и package smoke tests Go sources и Go tooling удаляются атомарно.

## Risks / Trade-offs

- [Risk] JSON/SSE несовместимость → transport fixtures, explicit Jackson naming и black-box tests на каждый endpoint.
- [Risk] SQLite JDBC иначе обрабатывает concurrency → один writer, явные transactions, WAL/busy timeout и upgrade integration fixture.
- [Risk] Process cancellation оставит descendants → supervisor сначала завершает descendants, затем parent; сценарии timeout/cancel проверяются реальными subprocess tests.
- [Risk] Покрытие 80% будет достигнуто формально → кроме ratio обязательны интеграционные assertions на API, data persistence и security side effects.
- [Risk] jpackage assets больше Go binaries → принимается ради полной Kotlin-миграции; checksum и platform smoke tests остаются обязательными.
- [Trade-off] До финального cutover в репозитории временно существуют две реализации → build scripts явно выбирают одну, а Go удаляется обязательной финальной задачей.

## Migration Plan

1. Зафиксировать API/error/SSE/SQLite fixtures и создать Maven/Spring skeleton.
2. Перенести storage, project и document vertical slices с unit/integration tests.
3. Перенести repository, Git, task context и publication.
4. Перенести process supervisor, AI и OpenSpec operations/drafts.
5. Переключить frontend dev/build/start и встроить frontend в Kotlin resources.
6. Довести JaCoCo line coverage до 80% и прогнать полный contract suite.
7. Удалить Go sources/module/tooling, собрать platform images и выполнить smoke tests.

Rollback до удаления Go: вернуть build scripts на Go backend и использовать неизменённую SQLite-базу. После удаления Go rollback выполняется возвратом предыдущего release asset; формат базы остаётся совместимым.
