## Why

Текущий Git workflow переносит в основной интерфейс OpenSpec Studio ветки, stage, commit, fetch, upstream и push. Для аналитика, который работает в контексте Jira-задачи, это создаёт лишнюю техническую нагрузку и блокирует переключение при незакоммиченных изменениях.

## Цель

Сделать пользовательским контекстом номер Jira-задачи, совпадающий с выбранной пользователем Git-веткой, а Git worktree, commit, fetch и push оставить управляемой реализацией. Пользователь должен всегда видеть текущую задачу, свободно переключаться между задачами и публиковать связанные OpenSpec-артефакты одним явным действием.

## Scope

- Постоянный лаконичный selector текущей задачи/ветки в верхней панели workspace.
- Создание либо открытие пользовательской ветки задачи в отдельном управляемом Store worktree.
- Переключение активной задачи сменой worktree без требований commit, stash или чистого working tree.
- Привязка файловых, OpenSpec и agent-операций к неизменяемому task workspace, выбранному при запуске операции.
- Единое действие «Опубликовать» для OpenSpec-изменений текущей задачи без stage, commit message, fetch, upstream и push controls.
- Формирование commit message выбранным локальным agent CLI из точного ограниченного diff публикации с номером задачи, проверкой fingerprint и безопасным fallback.
- Автоматический обычный push ветки задачи без force и с безопасной обработкой remote divergence.
- Компактное подтверждение публикации с перечнем артефактов и сформированным сообщением.
- Техническая Git-диагностика остаётся вторичной и не участвует в основном сценарии.

## Вне scope

- Jira API, загрузка карточки задачи, изменение её полей или построение workflow статусов.
- Merge, rebase, pull, force push, разрешение конфликтов и удаление remote-веток.
- Автоматическая публикация без явного действия пользователя.
- Commit или push подключённых кодовых репозиториев.
- Отправка diff внешнему сервису напрямую: используется только уже настроенный локальный agent CLI проекта.

## What Changes

- **BREAKING**: Git-панель перестаёт быть основным пользовательским workflow; branch/stage/commit/fetch/push controls удаляются из обычного workspace.
- Пользователь сам вводит Jira-номер как имя ветки и видит его во всех рабочих состояниях.
- Каждая открытая задача получает изолированный Store worktree, а активный worktree сохраняется в проекте.
- Публикация формирует точный набор изменений, получает от agent структурированное commit message, повторно проверяет diff и выполняет commit/push.
- Незакоммиченные изменения другой задачи сохраняются в её worktree и никогда не блокируют переключение.

## Capabilities

### New Capabilities

- `task-context`: выбор, создание, хранение и переключение Jira-задачи как пользовательского контекста поверх изолированных Git worktree.

### Modified Capabilities

- `project-store-management`: приложение начинает создавать и переиспользовать управляемые task worktree и сохранять активный task workspace.
- `git-delivery`: ручной Git workflow заменяется публикацией OpenSpec-артефактов текущей задачи с agent-generated commit message и обычным push.
- `workspace-experience`: верхняя панель показывает лаконичный task selector и одно основное действие публикации вместо Git controls.
- `ai-operations`: генерация commit message получает ограниченный diff и привязывается к неизменяемому task workspace без права изменять файлы.
- `openspec-workflow`: OpenSpec чтение, запись и длительные операции выполняются в task workspace, активном на момент запуска.

## Impact

- Backend: task workspace domain/service, SQLite metadata, разрешение активного Store path, Git worktree lifecycle, publication operation и agent adapter.
- API: endpoints списка/открытия task context и подготовки/запуска публикации; существующие низкоуровневые Git endpoints остаются совместимыми, но уходят из основного UI.
- Frontend: новый feature task context, компактный header selector, confirmation popover/modal и упрощение Git workspace.
- Безопасность: каноническая проверка worktree, branch validation, ограниченный diff, fingerprint перед commit, запрет force и запись только в Store.
- Тесты: backend service/API, frontend controller/components, интеграционные сценарии dirty task switching, agent fallback и browser screenshots.

## Риски

- Внешний Git client может изменить ветку либо index task worktree; backend должен повторно проверять identity, HEAD и diff непосредственно перед commit.
- Agent может вернуть некорректное или выдуманное сообщение; результат проверяется структурно и заменяется детерминированным fallback.
- Создание большого числа worktree расходует диск; чистые опубликованные worktree можно считать восстанавливаемым кэшем, но автоматическое удаление не входит в этот change.
- Remote может измениться между проверкой и push; обычный non-fast-forward остаётся безопасной ошибкой публикации без force или автоматического merge.
