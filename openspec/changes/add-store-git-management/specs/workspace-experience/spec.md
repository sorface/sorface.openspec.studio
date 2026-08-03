## ADDED Requirements

### Requirement: Управление Git активного Store
Workspace SHALL предоставлять аналитику единый Git workflow активного Store для просмотра веток и изменений, явного stage/unstage, выборочного commit, fetch и обычного push, сохраняя доступными только допустимые действия текущего состояния.

#### Scenario: Чистая рабочая ветка
- **WHEN** Git-панель открыта для чистого Store на локальной ветке
- **THEN** интерфейс показывает branch, HEAD, upstream и ahead/behind, а также действия fetch, создания и переключения ветки

#### Scenario: Есть изменения
- **WHEN** Store содержит staged или unstaged изменения
- **THEN** интерфейс показывает каждый файл, его состояние, diff и отдельный явный выбор для stage либо unstage

#### Scenario: Подготовка commit
- **WHEN** пользователь выбрал staged-файлы для commit
- **THEN** интерфейс показывает точный список, требует conventional commit message и не активирует commit при ошибке валидации

#### Scenario: Commit завершён
- **WHEN** backend успешно создал commit
- **THEN** workspace показывает новый сокращённый HEAD, обновляет status и сохраняет push отдельным явным действием

#### Scenario: Push без upstream
- **WHEN** пользователь запускает push ветки без upstream
- **THEN** workspace открывает подтверждение с выбором существующего remote, проверяемым именем целевой ветки и точным отображением направления push

#### Scenario: Git-операция выполняется
- **WHEN** fetch или push возвращает operation ID
- **THEN** Git-панель показывает тип операции, целевой remote, состояние и действие отмены, блокируя только конфликтующие Git controls

#### Scenario: Безопасная ошибка Git
- **WHEN** branch, stage, commit, fetch или push отклонены backend
- **THEN** workspace сохраняет введённые пользователем значения, показывает безопасный код, понятное восстановление и correlation ID при наличии

#### Scenario: Недоступное опасное действие
- **WHEN** пользователь просматривает управление Store Git
- **THEN** workspace не предлагает force push, reset, rebase, merge, pull, stash, discard, amend или удаление ветки
