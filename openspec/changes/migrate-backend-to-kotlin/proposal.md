## Why

Текущий Go backend расходится с целевым JVM-стеком команды и требует отдельного набора инженерных практик, зависимостей и сборочной инфраструктуры. Миграция на Kotlin должна сохранить пользовательское поведение и защитные границы OpenSpec Studio, одновременно установив единый проверяемый стандарт тестирования с покрытием не ниже 80%.

## Цель

Полностью заменить Go backend на Kotlin/Spring Boot backend, переключить локальный frontend на его API и подтвердить функциональную эквивалентность автоматическими unit- и интеграционными тестами с покрытием строк не менее 80%.

## Scope

- Сохранить версионированный `/api/v1`, JSON-контракты, SSE, correlation ID, CSRF/origin-защиту и loopback-only запуск.
- Перенести доменные сценарии, SQLite-хранилище, файловые операции, Git/OpenSpec/AI CLI adapters и управление процессами на Kotlin.
- Встроить собранный frontend в исполняемый Kotlin backend и перевести frontend tooling на его запуск и тестирование.
- Добавить unit-тесты бизнес-логики и интеграционные тесты HTTP, SQLite, безопасности, файловых и процессных границ.
- Настроить обязательный JaCoCo quality gate с минимумом 80% line coverage.
- Удалить Go sources, module manifests, Go-команды и Go-зависимости из CI, документации и release tooling.

## Вне scope

- Изменение пользовательских сценариев, структуры frontend UI или публичных API-контрактов.
- Ослабление ограничений на пути, AI write scope, Git-действия, CSRF, origin или запуск внешних процессов.
- Миграция SQLite-данных в другой формат или СУБД.
- Публикация новой версии приложения.

## What Changes

- **BREAKING для внутренней архитектуры и сборки:** Go 1.24 backend заменяется Kotlin/JVM backend на Spring Boot и Maven.
- Публичный `/api/v1` и существующая SQLite-схема сохраняются совместимыми.
- Frontend-команды разработки, проверки, сборки и запуска обращаются только к Kotlin backend.
- Release quality gate требует успешных unit- и интеграционных тестов Kotlin и JaCoCo line coverage не ниже 80%.
- **BREAKING для формата поставки:** автономный CGO-free Go executable заменяется self-contained application image для каждой поддерживаемой платформы, не требующий установленной JVM.
- Go backend и все остаточные ссылки на Go удаляются после прохождения эквивалентных Kotlin-проверок.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `local-platform`: локальный API, хранение и защищённые adapters должны предоставляться Kotlin backend с обязательным unit- и интеграционным покрытием.
- `distribution-release`: поставка переходит с Go executable на self-contained JVM application image, а release gate получает порог покрытия backend не ниже 80%.

## Impact

Затронуты весь `openspec.backend`, Maven dependencies и плагины, frontend npm scripts, cross-project tooling, GitHub Actions release workflow, embedded static assets, README и тесты. Публичные API, SQLite-файл пользователя и frontend model/types сохраняются без миграции.

## Риски

- Незамеченное расхождение JSON, HTTP status или SSE-событий нарушит frontend-сценарии; это контролируется контрактными интеграционными тестами.
- Различия JVM и Go в управлении process tree, filesystem paths и сигналами могут ослабить безопасность; соответствующие границы фиксируются отдельными тестами.
- SQLite driver или ORM может изменить схему либо сериализацию; миграции и совместимость существующего файла проверяются интеграционно.
- Self-contained runtime images увеличат release assets и усложнят cross-platform сборку; release tooling проверяется для каждого целевого target.
- Порог покрытия может стимулировать формальные тесты; quality gate дополняется сценарными assertions на публичное поведение.
