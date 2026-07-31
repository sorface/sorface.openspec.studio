## ADDED Requirements

### Requirement: Локальный API просмотра Git
Система SHALL возвращать ветку, HEAD, staged и unstaged изменения и ограниченный unified diff только для активного Store проекта.

#### Scenario: Изменённый Store
- **WHEN** активный Store является доступным Git worktree и содержит изменения
- **THEN** API и Git-панель показывают текущую ветку, HEAD, список изменённых файлов, их staged/unstaged состояние и diff

#### Scenario: Чистый Store
- **WHEN** активный Store не отличается от HEAD
- **THEN** Git-панель показывает empty state «Изменений нет» без имитации commit или push

#### Scenario: Store не является Git worktree
- **WHEN** сохранённый локальный Store недоступен или не принадлежит Git worktree
- **THEN** API возвращает безопасную ошибку `INVALID_STORE`, а UI показывает действие исправления проекта

#### Scenario: Слишком большой diff
- **WHEN** полный diff превышает серверный предел
- **THEN** система возвращает усечённый diff с явным признаком truncation и не расходует память без ограничения
