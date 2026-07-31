## Purpose

Просмотр истории и diff Store, восстановление версий в черновик и безопасная доставка выбранных файлов через commit и push.
## Requirements
### Requirement: Git status и diff
Система SHALL показывать staged и unstaged status и diff активного Store worktree.

#### Scenario: Изменённый файл
- **WHEN** файл Store отличается от HEAD
- **THEN** Git-панель показывает его состояние и соответствующий diff

### Requirement: История Markdown-файла
Система SHALL показывать commits выбранного файла, сравнивать версии и загружать содержимое выбранной revision.

#### Scenario: Восстановление версии
- **WHEN** пользователь выбирает старую Git-версию
- **THEN** система создаёт из неё новый черновик без изменения HEAD или working tree

### Requirement: Выборочный commit
Система SHALL создавать commit только из явно выбранных файлов Store после проверки непустого commit message.

#### Scenario: Пустое сообщение
- **WHEN** пользователь запускает commit без содержательного сообщения
- **THEN** операция блокируется, а index и history не изменяются

### Requirement: Push с upstream
Система SHALL выполнять обычный push текущей ветки Store через системный credential helper.

#### Scenario: Upstream существует
- **WHEN** ветка имеет upstream и авторизация успешна
- **THEN** система выполняет push без изменения конфигурации remote

#### Scenario: Upstream отсутствует
- **WHEN** текущая ветка не имеет upstream
- **THEN** UI запрашивает remote и целевую ветку, после чего устанавливает upstream

### Requirement: Безопасность push
Система MUST NOT выполнять force push или автоматически повторять push после non-fast-forward.

#### Scenario: Remote опережает локальную ветку
- **WHEN** Git возвращает non-fast-forward
- **THEN** система возвращает `GIT_NON_FAST_FORWARD` и предлагает пользователю разрешить расхождение вне автоматического сценария

### Requirement: Ограничение репозитория
Система MUST разрешать commit и push через UI только для активного Store.

#### Scenario: Кодовый репозиторий
- **WHEN** API получает запрос доставки для подключённого кодового репозитория
- **THEN** запрос отклоняется до запуска Git

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
