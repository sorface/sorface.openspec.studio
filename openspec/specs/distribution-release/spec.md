## Purpose

Простая установка и воспроизводимый выпуск автономных OpenSpec Studio binaries для поддерживаемых настольных операционных систем.

## Requirements

### Requirement: Автономный бинарник
Система SHALL поставляться как CGO-free executable со встроенным frontend, не требующий Node.js или Go на машине конечного пользователя.

#### Scenario: Первый запуск
- **WHEN** пользователь запускает binary поддерживаемой платформы
- **THEN** приложение создаёт локальную директорию данных, выбирает loopback-порт и открывает browser

### Requirement: Поддерживаемые release targets
Release-процесс SHALL собирать darwin/amd64, darwin/arm64, linux/amd64, linux/arm64 и windows/amd64.

#### Scenario: Формирование релиза
- **WHEN** в GitHub отправлен валидный тег `vMAJOR.MINOR.PATCH`
- **THEN** workflow создаёт отдельный упакованный asset для каждого target

### Requirement: Release quality gate
Release-процесс MUST выполнить lint, typecheck, frontend-тесты, backend-тесты и cross-platform build до публикации assets.

#### Scenario: Проверка не прошла
- **WHEN** любая обязательная проверка или сборка завершается ошибкой
- **THEN** GitHub Release не создаётся и assets не публикуются

### Requirement: Проверка целостности
Release-процесс SHALL публиковать SHA-256 checksum каждого распространяемого архива.

#### Scenario: Успешная упаковка
- **WHEN** все platform assets созданы
- **THEN** Release содержит `SHA256SUMS` для проверки скачанных файлов

### Requirement: Повторяемость релиза
Release-процесс SHALL позволять безопасно повторить workflow для существующего тега с заменой assets того же Release.

#### Scenario: Ручной повтор
- **WHEN** пользователь запускает workflow для существующего валидного тега
- **THEN** assets обновляются без создания второго Release с тем же тегом
