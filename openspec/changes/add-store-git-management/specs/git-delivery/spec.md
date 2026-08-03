## MODIFIED Requirements

### Requirement: Git status и diff
Система SHALL показывать текущую ветку, HEAD, upstream, ahead/behind, staged и unstaged status и diff активного Store worktree.

#### Scenario: Изменённый файл
- **WHEN** файл Store отличается от HEAD
- **THEN** Git-панель показывает его staged/unstaged состояние и соответствующий ограниченный diff

#### Scenario: Ветка с upstream
- **WHEN** текущая ветка отслеживает remote-ветку и remote refs доступны локально
- **THEN** Git-панель показывает точную upstream-ветку и число локальных ahead/behind commits

#### Scenario: Ветка без upstream
- **WHEN** текущая ветка не имеет upstream
- **THEN** Git-панель явно показывает отсутствие upstream и не представляет локальное состояние как синхронизированное

### Requirement: Выборочный commit
Система SHALL создавать commit только из явно подтверждённого набора staged-файлов активного Store после проверки непустого сообщения в conventional commits формате.

#### Scenario: Успешный выборочный commit
- **WHEN** пользователь подтверждает непустой набор staged-файлов и допустимое сообщение, а index совпадает с подтверждённым набором
- **THEN** система создаёт один commit только с этими файлами и возвращает новый HEAD

#### Scenario: Пустое сообщение
- **WHEN** пользователь запускает commit без содержательного сообщения
- **THEN** операция блокируется, а index и history не изменяются

#### Scenario: Некорректный conventional commit
- **WHEN** первая строка сообщения не соответствует поддерживаемому conventional commits формату
- **THEN** UI и API отклоняют запрос до запуска Git и объясняют ожидаемый формат

#### Scenario: Index изменился после подтверждения
- **WHEN** фактический набор staged-файлов перед commit отличается от подтверждённого пользователем набора
- **THEN** система возвращает `GIT_INDEX_CHANGED`, не создаёт commit и обновляет показанное состояние

### Requirement: Push с upstream
Система SHALL выполнять обычный push текущей ветки Store через системный credential helper или ssh-agent как отменяемую отслеживаемую операцию.

#### Scenario: Upstream существует
- **WHEN** ветка имеет upstream и авторизация успешна
- **THEN** система выполняет push именно в настроенный upstream без изменения remote configuration и после завершения обновляет status

#### Scenario: Upstream отсутствует
- **WHEN** текущая ветка не имеет upstream
- **THEN** UI запрашивает remote и целевую ветку, показывает точную цель и устанавливает upstream только после явного подтверждения пользователя

#### Scenario: Detached HEAD
- **WHEN** пользователь запускает push в состоянии detached HEAD
- **THEN** система возвращает `GIT_DETACHED_HEAD` до запуска сетевой операции

### Requirement: Локальный API просмотра Git
Система SHALL возвращать ветку, HEAD, upstream, ahead/behind, доступные local и remote-tracking ветки, remotes, staged и unstaged изменения и ограниченный unified diff только для активного Store проекта.

#### Scenario: Изменённый Store
- **WHEN** активный Store является доступным Git worktree и содержит изменения
- **THEN** API и Git-панель показывают актуальное состояние репозитория, список изменённых файлов и diff

#### Scenario: Чистый Store
- **WHEN** активный Store не отличается от HEAD
- **THEN** Git-панель показывает empty state «Изменений нет», сохраняя доступ к fetch и безопасному управлению веткой

#### Scenario: Store не является Git worktree
- **WHEN** сохранённый локальный Store недоступен или не принадлежит Git worktree
- **THEN** API возвращает безопасную ошибку `INVALID_STORE`, а UI показывает действие исправления проекта

#### Scenario: Слишком большой diff
- **WHEN** полный diff превышает серверный предел
- **THEN** система возвращает усечённый diff с явным признаком truncation и не расходует память без ограничения

## ADDED Requirements

### Requirement: Получение состояния remote
Система SHALL выполнять явный fetch выбранного настроенного remote активного Store без merge, rebase или изменения working tree.

#### Scenario: Успешный fetch
- **WHEN** пользователь выбирает существующий remote и подтверждает fetch
- **THEN** система обновляет remote-tracking refs как отслеживаемую операцию и пересчитывает branches и ahead/behind

#### Scenario: Неизвестный remote
- **WHEN** запрос содержит remote, отсутствующий в конфигурации активного Store
- **THEN** система возвращает `GIT_REMOTE_NOT_FOUND` до запуска Git

#### Scenario: Ошибка авторизации
- **WHEN** remote отклоняет системную Git-аутентификацию
- **THEN** операция завершается с `GIT_AUTH_FAILED` без передачи credentials или сырого stderr в UI

### Requirement: Управление ветками Store
Система SHALL создавать локальные ветки и переключать local либо remote-tracking ветки активного Store только при чистом index и working tree.

#### Scenario: Создание локальной ветки
- **WHEN** пользователь вводит допустимое свободное имя ветки при чистом Store и подтверждает создание
- **THEN** система создаёт ветку от текущего HEAD, переключается на неё и возвращает обновлённый status

#### Scenario: Переключение локальной ветки
- **WHEN** пользователь выбирает существующую локальную ветку при чистом Store
- **THEN** система переключает HEAD на выбранную ветку без stash, reset или изменения remote

#### Scenario: Переключение remote-tracking ветки
- **WHEN** пользователь выбирает существующую remote-tracking ветку без соответствующей локальной ветки при чистом Store
- **THEN** система создаёт локальную tracking-ветку только после показа local и upstream имён и явного подтверждения

#### Scenario: Грязный Store
- **WHEN** index либо working tree содержит изменения
- **THEN** создание или переключение ветки блокируется с `WORKTREE_DIRTY` без автоматического stash, commit или discard

#### Scenario: Недопустимое имя ветки
- **WHEN** имя новой ветки пусто, занято или не проходит Git check-ref-format
- **THEN** система возвращает `GIT_INVALID_BRANCH` без изменения refs или HEAD

### Requirement: Явное управление index Store
Система SHALL добавлять в index и удалять из index только явно выбранные относительные пути внутри активного Store.

#### Scenario: Подготовка выбранных файлов
- **WHEN** пользователь выбирает существующие изменённые файлы Store и запускает stage
- **THEN** система добавляет в index только выбранные пути и возвращает обновлённые status и diff

#### Scenario: Исключение выбранных файлов из index
- **WHEN** пользователь выбирает staged-файлы и запускает unstage
- **THEN** система удаляет из index только выбранные пути, не изменяя их содержимое в working tree

#### Scenario: Путь вне Store
- **WHEN** запрос stage или unstage содержит абсолютный путь, traversal либо путь за пределами канонического Store
- **THEN** система возвращает `INVALID_STORE_PATH` до запуска Git

### Requirement: Безопасное выполнение изменяющих Git-операций
Система MUST ограничивать branch, stage, commit, fetch и push активным Store, явным пользовательским действием и неинтерактивным ограниченным процессом.

#### Scenario: Подключённый кодовый репозиторий
- **WHEN** mutating Git API получает идентификатор или путь подключённого кодового репозитория
- **THEN** запрос отклоняется до запуска Git

#### Scenario: Отмена сетевой операции
- **WHEN** пользователь отменяет выполняющийся fetch или push
- **THEN** система завершает дочерний Git-процесс, помечает operation отменённой и повторно читает фактический status без предположения об откате remote

#### Scenario: Запрещённый аргумент
- **WHEN** запрос пытается выполнить force, произвольный refspec или дополнительный Git argument
- **THEN** API отклоняет запрос, потому что формирует команды только из типизированных разрешённых полей
