## MODIFIED Requirements

### Requirement: Автономное приложение
Система SHALL поставляться как self-contained platform-specific application image со встроенными Kotlin backend, JVM runtime и frontend, не требующий Node.js, Go или отдельно установленной JVM на машине конечного пользователя.

#### Scenario: Первый запуск
- **WHEN** пользователь запускает launcher поддерживаемой платформы
- **THEN** приложение создаёт локальную директорию данных, выбирает loopback-порт и открывает browser

### Requirement: Release quality gate
Release-процесс MUST выполнить frontend lint и typecheck, frontend-тесты, Kotlin unit- и интеграционные тесты, JaCoCo line coverage не ниже 80 процентов и platform build до публикации assets.

#### Scenario: Проверка не прошла
- **WHEN** любая обязательная проверка, coverage gate или platform build завершается ошибкой
- **THEN** GitHub Release не создаётся и assets не публикуются
