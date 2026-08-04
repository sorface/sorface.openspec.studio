## Why

Верхний selector контекста задачи показывает только локальные Git-ветки Store, хотя backend уже обнаруживает remote-tracking refs. Пользователь не видит доступные удалённые задачи и вынужден вводить имя ветки вручную.

## Цель

Сделать доступные remote-ветки Store видимыми в selector контекста задачи и позволить открыть их с автоматическим созданием локальной tracking-ветки.

## What Changes

- Task workspace API возвращает локальные и удалённые ветки раздельно.
- Remote ref `origin/<branch>` отображается в selector как удалённая ветка без дублирования уже существующей локальной ветки.
- Выбор remote-ветки открывает task workspace и создаёт локальную ветку, отслеживающую соответствующий remote ref.
- Список не включает символический `origin/HEAD` и сохраняет детерминированную сортировку.

## Scope

- Чтение уже доступных `refs/remotes` Store.
- Additive расширение task workspace HTTP response.
- Отображение и выбор remote-веток в header selector.
- Backend, API и frontend regression-тесты.

## Вне scope

- Периодический background fetch и автоматическое сетевое обновление refs.
- Поддержка произвольного remote вместо текущего `origin`.
- Изменение publication и push flow.

## Capabilities

### New Capabilities

- `remote-task-branches`: обнаружение, отображение и открытие удалённых веток как task workspaces.

### Modified Capabilities

- Нет. Capability `task-context` ещё находится в отдельном активном change и не синхронизирована в baseline; этот change добавляет самостоятельный совместимый контракт.

## Impact

- Backend: `backend/internal/taskcontext`, task workspace HTTP payload.
- Frontend: `features/task-context` model и selector.
- Совместимость: новое поле ответа additive; существующие клиенты продолжают работать.
- Зависимости и схема SQLite не меняются.

## Риски

- Remote refs могут устареть без явного fetch; интерфейс должен показывать только локально известные refs.
- Одинаковая локальная и remote-ветка не должна появляться в списке дважды.
- Remote ref нельзя передавать в Git-команды без валидации и нормализации.
