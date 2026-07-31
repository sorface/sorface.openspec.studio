## ADDED Requirements

### Requirement: Выбор обнаруженного agent CLI
Система SHALL показывать доступные поддерживаемые agent CLI из server capabilities и SHALL позволять сохранить выбранный provider и необязательную модель в проекте.

#### Scenario: Выбор Codex
- **WHEN** backend обнаружил поддерживаемый Codex CLI и пользователь выбирает Codex
- **THEN** UI сохраняет `defaultAiProvider` и модель через Projects API, отображает выбор после перезагрузки и использует его для следующей AI-операции

#### Scenario: Provider отсутствует
- **WHEN** сохранённый provider больше не обнаруживается backend
- **THEN** UI показывает provider как недоступный, блокирует запуск и предлагает выбрать другой обнаруженный CLI

#### Scenario: Provider не выбран
- **WHEN** у проекта отсутствует `defaultAiProvider`
- **THEN** UI явно предлагает настройку и MUST NOT показывать скрытый provider как уже выбранный

### Requirement: Единое состояние provider
Система MUST использовать одинаковые provider и model в header, настройках, проверке доступности и payload запуска agent CLI.

#### Scenario: Перезагрузка workspace
- **WHEN** пользователь повторно открывает проект с сохранёнными provider и model
- **THEN** все элементы workspace показывают и используют одинаковые значения без frontend fallback, отличающегося от метаданных проекта
