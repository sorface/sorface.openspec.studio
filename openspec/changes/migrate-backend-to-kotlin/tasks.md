## 1. Контракты и основа Kotlin backend

- [x] 1.1 Зафиксировать inventory Go endpoint, DTO, SQLite schema и frontend-вызовов в contract fixtures; проверить fixtures автоматическим тестом полноты маршрутов.
- [x] 1.2 Создать Maven/Kotlin/Spring Boot модуль с package-границами, JaCoCo 80%, Surefire/Failsafe и минимальным unit/integration smoke test; выполнить `mvn verify`.
- [x] 1.3 Реализовать безопасную конфигурацию loopback, lifecycle, embedded frontend, health/session/capabilities, correlation/error/origin/CSRF filters и их unit/integration tests.

## 2. Хранение и проекты

- [x] 2.1 Описать существующую SQLite schema Liquibase YAML, реализовать JDBC repositories и recovery interrupted operations; проверить новую и legacy database integration fixtures.
- [x] 2.2 Перенести project model/service, context manifest и Store initialization вместе с unit tests и HTTP integration tests project CRUD/from-git.

## 3. Файлы и репозитории

- [x] 3.1 Реализовать `ScopedPathResolver` и document service/API с history/annotations/write, включая traversal/symlink/atomic-write unit и filesystem integration tests.
- [x] 3.2 Реализовать безопасный `ProcessRunner`/supervisor, CLI environment/audit/cancellation/timeout и detector, включая unit и platform integration tests.
- [x] 3.3 Перенести repository clone/update/branch services и SSE API с unit tests и интеграционными тестами на временных Git repositories.
- [x] 3.4 Перенести Git status/stage/unstage/commit/branch/fetch/push services и SSE API, проверив запрет commit/push кодовых repositories unit- и Git integration tests.

## 4. Task context, OpenSpec и AI

- [x] 4.1 Перенести task workspace и publication services/API, включая remote-sync, scope, stale preview, commit/push и error mapping tests.
- [x] 4.2 Перенести OpenSpec CLI/service, action operations, creation drafts и accepted/rejected draft lifecycle вместе с unit и end-to-end CLI integration tests.
- [x] 4.3 Перенести AI operations, context manifest, commit-message generation, write-scope enforcement и SSE lifecycle вместе с unit и fake-CLI integration tests.

## 5. Frontend и поставка

- [x] 5.1 Перевести frontend dev/test/build/start orchestration и proxy на Kotlin backend; выполнить frontend API integration tests против реального Kotlin HTTP server.
- [x] 5.2 Встроить production frontend в Spring Boot artifact и реализовать self-contained application image/release matrix для всех target с release workflow tests.
- [x] 5.3 Удалить Go sources, `go.mod`/`go.sum`, Go-команды и остаточные ссылки; добавить автоматическую проверку их отсутствия.

## 6. Итоговая проверка

- [x] 6.1 Выполнить `npm --prefix openspec.frontend run check`, полный `mvn verify` с JaCoCo line coverage не ниже 80%, Sites build, standalone application image, release tests и strict OpenSpec validation; устранить все ошибки.
