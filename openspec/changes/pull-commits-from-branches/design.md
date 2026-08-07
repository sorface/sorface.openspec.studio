## Context

См. `proposal.md` для мотивации. Фактическая кодовая база использует Kotlin/Spring backend и React/Vite frontend. Git Store операции уже сосредоточены в `GitService`, публикуются через `/api/v1/projects/{projectId}/git/*`, а длительные fetch/push представлены как `GitOperation` поверх общего хранилища operations и `ProcessSupervisor`.

Текущий `GitStatus` уже возвращает локальные ветки, remote-tracking ветки, текущий HEAD и dirty state. UI Git-панели использует `useGitStatusController`, polling operation и общий error state.

## Goals / Non-Goals

**Goals:**

- Добавить read-only endpoint для candidate commits из другой ветки относительно текущей.
- Добавить async operation для применения выбранных commits через `cherry-pick`.
- Переиспользовать существующие ограничения активного Store path, cancellation, operation conflict и Git error envelope.
- Дать UI компактный workflow внутри существующей Git-панели без новой навигационной области.

**Non-Goals:**

- Не добавлять merge/rebase branch workflow.
- Не добавлять автоматическое разрешение конфликтов.
- Не выполнять операции над context repositories.
- Не менять модель хранения projects/repositories.

## Decisions

### Candidate commits считаются backend-ом

Endpoint:

- `GET /api/v1/projects/{projectId}/git/branch-commits?branch=<ref>`

Backend валидирует `branch` как существующий local или remote-tracking ref из `GitStatus`, затем выполняет ограниченный `git log --format=... --max-count=50 HEAD..<branch>`. Ответ возвращает typed records: `sha`, `shortSha`, `author`, `authoredAt`, `message`.

Причина: UI не должен формировать Git range и не должен знать CLI-правила quoting/refs. Альтернатива с локальной фильтрацией из истории файла не подходит, потому что нужны commits всей ветки, а не одного документа.

### Применение commits выполняется async operation

Endpoint:

- `POST /api/v1/projects/{projectId}/git/cherry-picks`
- Body: `{ "branch": "...", "commits": ["<sha>", ...], "expectedHead": "..." }`

`expectedHead` защищает от применения устаревшего выбора после внешнего изменения текущей ветки. Перед созданием operation backend проверяет:

- active Store валиден через существующий `storePath(projectId)`;
- worktree clean;
- исходная ветка существует;
- commits непустые, имеют hex-like форму, входят в candidate set для выбранной ветки;
- текущий `HEAD` совпадает с `expectedHead`.

Operation metadata хранит action `cherry-pick`, branch, commits и storePath. Выполнение применяет commits в обратном порядке candidate list: от старых к новым, одним `git cherry-pick -- <sha>` на commit, чтобы корректно остановиться на конфликте.

Альтернатива с одним `git cherry-pick sha1 sha2 ...` проще, но хуже для событий прогресса и явной классификации конфликтного commit.

### Ошибки классифицируются в GitService

Новые стабильные коды:

- `GIT_CHERRY_PICK_CONFLICT` для conflict/merge state.
- `GIT_COMMIT_NOT_FOUND` для SHA, которого нет в candidate set.
- `GIT_HEAD_CHANGED` уже существует для stale выбора.

При конфликте backend не вызывает `cherry-pick --abort`: пользователь должен видеть реальное Git conflict state и решать его вручную. После failed operation polling status покажет изменённые файлы.

### UI живёт внутри GitPanel

`GitPanel` добавляет секцию "Подтянуть commits" рядом с branch controls:

- select с `status.localBranches` и `status.remoteBranches`, исключая текущую ветку;
- загрузка commits при выборе branch;
- checkbox list commits с коротким SHA, сообщением, автором и датой;
- кнопка запуска активна только при clean status и непустом выборе;
- operation polling уже обновляет status после terminal результата.

Компонент не создаёт отдельный modal, потому что действие связано с текущим Git state и должно быть видно вместе с dirty/ahead/behind indicators.

## Risks / Trade-offs

- Конфликт оставляет worktree в промежуточном состоянии → UI показывает failed operation и обновляет status, чтобы пользователь видел конфликтующие файлы.
- Long-lived branch может иметь много commits → backend ограничивает список первыми 50 и UI показывает только этот bounded набор.
- Remote branch может устареть без fetch → пользователь использует существующий Fetch; новый workflow не запускает fetch автоматически.
- Выбранные commits могут устареть между загрузкой и запуском → `expectedHead` и membership check предотвращают скрытое применение к другой базе.

## Migration Plan

Миграция данных не требуется. Изменение добавляет новые API endpoints и frontend controls; rollback сводится к удалению этих endpoints и UI-секции без изменения существующих Git status/commit/push контрактов.
