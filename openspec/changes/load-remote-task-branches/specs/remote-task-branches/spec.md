## Purpose

Capability позволяет пользователю видеть известные Git remote-ветки Store и открывать их как изолированные task workspaces без ручного создания локальной tracking-ветки.

## ADDED Requirements

### Requirement: API перечисляет локальные и удалённые ветки раздельно
Система SHALL возвращать в обзоре task workspaces детерминированно отсортированные локальные ветки и известные remote-ветки `origin`, исключая символический `origin/HEAD`.

#### Scenario: В Store есть remote-only ветка
- **WHEN** локальный Git содержит `refs/remotes/origin/feature/CGA-1244`, но не содержит одноимённую локальную ветку
- **THEN** API возвращает `main` среди локальных веток и `origin/feature/CGA-1244` среди удалённых веток

#### Scenario: Символический remote HEAD
- **WHEN** Git содержит символический ref `origin/HEAD`
- **THEN** API не включает его в список выбираемых remote-веток

### Requirement: Selector показывает доступные remote-only ветки
Система SHALL показывать remote-ветки в selector контекста задачи отдельно от локальных веток и SHALL не дублировать remote-ветку, если одноимённая локальная ветка уже доступна.

#### Scenario: Пользователь открывает selector
- **WHEN** обзор содержит локальную ветку `main` и remote-ветку `origin/feature/CGA-1244`
- **THEN** selector показывает `main` в локальной группе и `origin/feature/CGA-1244` в группе удалённых веток

#### Scenario: Локальная tracking-ветка уже существует
- **WHEN** обзор содержит локальную ветку `feature/CGA-1244` и remote-ветку `origin/feature/CGA-1244`
- **THEN** selector предлагает пользователю только локальную ветку `feature/CGA-1244`

### Requirement: Выбор remote-ветки создаёт tracking task workspace
Система MUST нормализовать выбранную ветку `origin/<branch>` до локального имени `<branch>`, проверить известный remote ref и создать task workspace с локальной веткой, отслеживающей `origin/<branch>`.

#### Scenario: Успешное открытие remote-only ветки
- **WHEN** пользователь выбирает `origin/feature/CGA-1244`, а соответствующий remote ref существует
- **THEN** система создаёт локальную ветку `feature/CGA-1244`, настраивает upstream `origin/feature/CGA-1244` и делает её активным task workspace

#### Scenario: Remote ref устарел или исчез
- **WHEN** пользователь выбирает remote-ветку, которой больше нет среди локально известных refs
- **THEN** система отклоняет переключение безопасной прикладной ошибкой и не создаёт ветку от текущего `HEAD`
