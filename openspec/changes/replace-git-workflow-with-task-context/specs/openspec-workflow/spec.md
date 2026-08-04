## ADDED Requirements

### Requirement: OpenSpec в контексте задачи
Система SHALL выполнять OpenSpec list, show, status, validate, draft write и action в task workspace, активном при создании запроса, и MUST связывать полученный результат с номером задачи и workspace identity.

#### Scenario: Чтение после переключения
- **WHEN** пользователь открывает `BILL-1842`
- **THEN** дерево и overview показывают OpenSpec-артефакты worktree `BILL-1842`, даже если предыдущая задача содержит другие локальные изменения

#### Scenario: Длительная операция и новое переключение
- **WHEN** OpenSpec action запущен в `BILL-1842`, а пользователь затем открывает `BILL-1907`
- **THEN** action проверяет и формирует draft относительно сохранённого worktree `BILL-1842`, не используя новый active path

### Requirement: Область публикации OpenSpec
Система SHALL включать в task publication только переносимые OpenSpec-артефакты и служебные файлы change, относящиеся к текущему Store, и MUST оставлять остальные изменения worktree локальными.

#### Scenario: Изменены несколько changes задачи
- **WHEN** в task worktree изменены артефакты нескольких каталогов `openspec/changes`
- **THEN** preview включает их в одну публикацию ветки задачи и показывает сгруппированный состав

#### Scenario: Изменён исходный код
- **WHEN** task worktree содержит файл вне разрешённой OpenSpec-области
- **THEN** файл не передаётся agent, не попадает в commit публикации и остаётся без изменения в worktree

