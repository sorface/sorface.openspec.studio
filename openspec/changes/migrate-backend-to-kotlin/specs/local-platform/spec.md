## ADDED Requirements

### Requirement: Kotlin backend с полным контрактным паритетом
Система SHALL реализовывать локальный backend на Kotlin и MUST сохранять поведение всех существующих `/api/v1` endpoints, JSON-полей, HTTP status, error codes, correlation ID и SSE-событий, используемых frontend.

#### Scenario: Совместимый frontend
- **WHEN** неизменённый frontend выполняет любой поддержанный сценарий через Kotlin backend
- **THEN** запросы, ответы, ошибки и последовательности SSE соответствуют зафиксированному API-контракту прежнего backend

#### Scenario: Отсутствие Go backend
- **WHEN** выполняется production build или запуск сервиса
- **THEN** сборка использует только Kotlin backend, а репозиторий не содержит исполняемых Go sources, Go module manifests или Go-команд backend

### Requirement: Совместимость сохранённых данных
Kotlin backend MUST открывать существующий `openspec-studio.db`, сохранять текущие таблицы, колонки, индексы и значения статусов и SHALL применять последующие миграции версионированно без потери пользовательских данных.

#### Scenario: Обновление существующей установки
- **WHEN** Kotlin backend впервые запускается с SQLite-файлом, созданным Go backend
- **THEN** проекты, активные worktrees, repositories, operations, events, audit, drafts и настройки доступны без ручной конвертации

#### Scenario: Новая установка
- **WHEN** файл базы отсутствует
- **THEN** backend создаёт полную актуальную схему и может выполнить все операции чтения и записи

### Requirement: Проверяемые защитные границы
Система MUST сохранять loopback-only bind, Origin/CSRF-проверки, нормализацию и symlink-проверку путей, AI write scope, контролируемое окружение CLI, timeout, cancellation, process-tree termination и безопасный audit.

#### Scenario: Контракт безопасности
- **WHEN** интеграционные тесты передают внешний bind, чужой Origin, неверный CSRF token, traversal, symlink escape, запрещённую AI-мутацию или зависший CLI-процесс
- **THEN** Kotlin backend отклоняет либо завершает действие с тем же безопасным error contract и не изменяет данные вне разрешённой области

### Requirement: Unit- и интеграционное тестирование backend
Backend MUST содержать unit-тесты доменной и прикладной логики, интеграционные тесты HTTP, SQLite, filesystem, CLI lifecycle и SSE и MUST проходить единый Maven verification lifecycle.

#### Scenario: Полная проверка backend
- **WHEN** выполняется `mvn verify`
- **THEN** все unit- и интеграционные тесты завершаются успешно, а любой упавший тест завершает сборку ошибкой

### Requirement: Минимальное покрытие Kotlin backend
Maven verification MUST измерять JaCoCo line coverage production Kotlin-кода и MUST завершаться ошибкой при покрытии ниже 80 процентов.

#### Scenario: Покрытие ниже порога
- **WHEN** совокупное line coverage production Kotlin-кода составляет менее 0.80
- **THEN** JaCoCo quality gate завершает `mvn verify` ошибкой

#### Scenario: Покрытие подтверждено
- **WHEN** все тесты прошли и JaCoCo line coverage не ниже 0.80
- **THEN** сборка создаёт читаемый XML/HTML coverage report и backend quality gate считается выполненным
