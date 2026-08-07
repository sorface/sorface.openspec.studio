## ADDED Requirements

### Requirement: UI подтягивания commits в текущую задачу
Workspace SHALL предоставлять в Git/task интерфейсе сценарий выбора исходной ветки и commits для подтягивания в текущую задачу.

#### Scenario: Открытие сценария
- **WHEN** выбран проект с активным Store worktree и доступной Git-панелью
- **THEN** UI показывает действие подтягивания commits и список доступных локальных и remote веток кроме текущей

#### Scenario: Выбор исходной ветки
- **WHEN** пользователь выбирает исходную ветку
- **THEN** UI загружает candidate commits из backend и показывает hash, автора, дату и сообщение каждого commit

#### Scenario: Применение выбранных commits
- **WHEN** пользователь выбирает commits и подтверждает действие
- **THEN** UI запускает Git operation, показывает состояние выполнения и обновляет Git status после terminal результата

#### Scenario: Нет candidate commits
- **WHEN** backend возвращает пустой список commits для выбранной ветки
- **THEN** UI показывает empty state без кнопки запуска изменяющей операции

#### Scenario: Ошибка подтягивания
- **WHEN** backend возвращает ошибку валидации или failed operation для подтягивания commits
- **THEN** UI показывает безопасное сообщение, correlation ID при наличии и доступное действие обновления Git status
