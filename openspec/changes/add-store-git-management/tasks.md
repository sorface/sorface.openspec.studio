## 1. Расширенная модель Store Git

- [x] 1.1 Расширить backend-модель status полями detached, upstream, ahead/behind, local/remote branches и remotes, сохранив совместимость текущего API, и покрыть parsing чистого, dirty, detached и no-upstream репозитория unit-тестами.
- [x] 1.2 Перенести или переиспользовать read-only `gitstatus` внутри существующего `storegit` service так, чтобы project lookup, canonical Store validation, bounded diff и безопасные ошибки использовали один путь; обновить backend и HTTP regression-тесты.
- [x] 1.3 Расширить frontend Git types/client/controller новым read model и добавить transport/controller тесты загрузки, refresh, empty, truncated diff и recoverable error states.

## 2. Безопасные локальные Git mutations

- [x] 2.1 Реализовать типизированные stage/unstage inputs с нормализацией относительных путей, canonical containment, `--` separator и обновлённым status в ответе; покрыть выбранные файлы, untracked/deleted paths, traversal и путь вне Store backend-тестами.
- [x] 2.2 Реализовать conventional commit validation и commit с expected HEAD и точным сравнением подтверждённого staged set; покрыть успешный commit, пустой/некорректный message, пустой selection, `GIT_INDEX_CHANGED`, `GIT_HEAD_CHANGED` и hook failure.
- [x] 2.3 Добавить CSRF-protected HTTP endpoints stage, unstage и commit, типизированные DTO/error mapping и integration-тесты, подтверждающие запрет произвольного пути и операций над подключённым code repository.
- [x] 2.4 Добавить в Git-панель выбор файлов, явные stage/unstage controls и commit composer с точным summary и сохранением ввода при recoverable error; покрыть доступность, disabled states и успешный controller flow frontend-тестами.

## 3. Управление ветками Store

- [x] 3.1 Реализовать server-side branch name validation, проверку полностью чистого Store и создание локальной ветки от текущего HEAD; покрыть valid, occupied, invalid, dirty и detached-compatible cases unit-тестами.
- [x] 3.2 Реализовать переключение существующей local branch и подтверждённое создание local tracking branch из точной remote-tracking branch без stash/reset; покрыть dirty worktree, missing/ambiguous ref и collision локального имени.
- [x] 3.3 Добавить CSRF-protected branch create/switch endpoints и integration-тесты неизменности HEAD/refs при любом отклонённом запросе.
- [x] 3.4 Добавить в Git-панель branch selector, создание ветки и modal подтверждения remote tracking с focus management; блокировать controls при dirty Store и покрыть keyboard/UI state тестами.

## 4. Fetch и push operation lifecycle

- [x] 4.1 Расширить operation model типами Store Git fetch/push и metadata project/remote/branch без хранения credentials или raw URL; покрыть переходы queued/running/completed/failed/cancelled тестами.
- [x] 4.2 Реализовать fetch только существующего remote через bounded non-interactive runner с timeout/cancel и нормализацией `GIT_REMOTE_NOT_FOUND`, `GIT_AUTH_FAILED`, `GIT_TIMEOUT`; после terminal state перечитывать status.
- [x] 4.3 Реализовать обычный push существующего upstream и явно подтверждённый `--set-upstream` без произвольного refspec/force; покрыть success, detached HEAD, no upstream, unknown remote, auth failure и non-fast-forward.
- [x] 4.4 Добавить start/status/events/cancel HTTP flow для fetch и push, CSRF и correlation ID, а также integration-тесты отмены process group и отсутствия raw stderr/credentials в ответах.
- [x] 4.5 Подключить frontend client/controller к operation lifecycle и добавить Git-панели fetch, push, upstream dialog, progress и cancel states; покрыть блокировку только конфликтующих actions и refresh после terminal state.

## 5. Композиция и UX восстановления

- [x] 5.1 Обновить workspace notifications и capability states для нового Git workflow, заменить read-only footer и добавить понятные recovery hints для всех стабильных Git error codes.
- [x] 5.2 Проверить responsive layout, scroll и modal stacking Git-панели на desktop breakpoints, доступные имена и focus order; зафиксировать UI contracts автоматическими тестами.
- [x] 5.3 Провести локальный browser smoke flow: создать ветку, stage/unstage, commit, fetch, push с upstream и обработать dirty/non-fast-forward сценарии на временном remote без изменения пользовательских репозиториев.

## 6. Финальная проверка

- [x] 6.1 Выполнить `npm run check` и исправить frontend, backend и strict OpenSpec validation failures.
- [x] 6.2 Выполнить `npm run build`, запустить автономный бинарник и проверить health endpoint и встроенный frontend с новым Store Git workflow.

## 7. Управление веткой репозитория контекста

- [x] 7.1 Добавить live branch/upstream read model подключённых репозиториев, CSRF-protected switch existing branch и fast-forward update endpoints с canonical project/repository validation, dirty/non-fast-forward/auth error mapping; добавить branch selector и «Получить обновления» в карточку, покрыть backend, controller/source-contract тестами и browser smoke.
