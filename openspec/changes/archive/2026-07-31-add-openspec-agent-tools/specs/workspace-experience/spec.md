## ADDED Requirements

### Requirement: Панель управления OpenSpec
Система SHALL предоставлять в workspace отдельную OpenSpec-панель со списком changes, schema, прогрессом, diagnostics и доступными действиями создания, продолжения, проверки и архивирования.

#### Scenario: Выбор change
- **WHEN** пользователь выбирает change в панели
- **THEN** UI показывает его актуальные proposal/specs/design/tasks, завершённые зависимости, следующий доступный action и результат последнего validate

#### Scenario: Change отсутствуют
- **WHEN** Store не содержит активных changes
- **THEN** панель показывает empty state и доступное действие создания change, если OpenSpec CLI и agent настроены

### Requirement: Запуск OpenSpec action из workspace
Система SHALL показывать перед запуском action его цель, выбранный agent, модель, разрешённые input/output artifacts и требуемое подтверждение контекста.

#### Scenario: Подтверждение генерации
- **WHEN** пользователь выбирает подготовку артефакта и подтверждает контекст
- **THEN** UI создаёт операцию, показывает поток прогресса и предоставляет отмену до перехода в review

#### Scenario: Agent не настроен
- **WHEN** OpenSpec action требует генерации, но доступный provider не выбран
- **THEN** UI блокирует только изменяющее agent-действие, предлагает настройку provider и оставляет read-only status/show/validate доступными

### Requirement: Представление результата OpenSpec action
Система SHALL показывать результат через существующий diff review с группировкой по ролям OpenSpec-артефактов, diagnostics validate и явными действиями принять в drafts либо отклонить.

#### Scenario: Review proposal
- **WHEN** agent подготовил `proposal.md`
- **THEN** UI показывает Markdown diff, OpenSpec diagnostics и не помечает proposal готовым до принятия результата и последующего status

#### Scenario: Review archive
- **WHEN** OpenSpec подготовил архивирование с созданием, перемещением или удалением файлов
- **THEN** UI различимо показывает каждый тип мутации и требует подтверждение полного согласованного набора

### Requirement: Состояния и восстановление OpenSpec workflow
Система SHALL иметь различимые loading, ready, blocked, running, awaiting review, validation error, stale, cancelled и unavailable tool состояния с безопасным допустимым действием восстановления.

#### Scenario: Operation отменена
- **WHEN** пользователь отменяет выполняющуюся agent-операцию
- **THEN** панель показывает cancelled, не применяет частичный результат и позволяет обновить status либо повторить действие

#### Scenario: Store изменился извне
- **WHEN** fingerprint Store или OpenSpec status изменился во время подготовленного действия
- **THEN** UI показывает stale state, сбрасывает прежнее подтверждение и предлагает обновить данные перед повторным запуском
