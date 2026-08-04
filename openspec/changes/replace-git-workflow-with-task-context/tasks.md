## 1. Task workspace data and resolution

- [x] 1.1 Добавить additive SQLite schema/repository для task workspaces, active worktree update и effective/base Store path; покрыть migration, CRUD и fallback тестами.
- [x] 1.2 Реализовать backend task workspace manager с branch validation, list/open/reuse и managed `git worktree add`; покрыть новую, существующую и dirty-switch задачи unit/integration тестами.
- [x] 1.3 Добавить task workspace HTTP API, безопасные error mappings и wiring в main; покрыть CSRF, project isolation и отсутствие path input HTTP-тестами.

## 2. Immutable task context

- [x] 2.1 Перевести document, Git status и OpenSpec чтение на effective active Store path и сохранить workspace snapshot в новых длительных операциях; покрыть переключение во время операции тестом.
- [x] 2.2 Сделать task-scoped refresh согласованным после переключения и убедиться, что изменения покидаемого worktree остаются нетронутыми.

## 3. Task publication

- [x] 3.1 Реализовать сбор разрешённых OpenSpec paths/diff, bounded preview token, fingerprint и deterministic conventional commit fallback; покрыть empty, excluded, untracked и stale scenarios тестами.
- [x] 3.2 Добавить read-only agent commit-message generator с JSON contract, timeout/limits и fallback; покрыть valid, invalid, unavailable и task-key validation тестами.
- [x] 3.3 Реализовать confirm publication с повторной optimistic проверкой, точным commit set и обычным push/upstream через operation lifecycle; покрыть success, stale, auth и non-fast-forward тестами.
- [x] 3.4 Добавить publication HTTP API, audit-safe responses и интеграционные тесты полного preview → confirm flow.

## 4. Лаконичный task-first frontend

- [x] 4.1 Добавить `features/task-context` models, API client и controller для list/open/preview/publish с refresh активного проекта и тестами transport/state.
- [x] 4.2 Реализовать компактный header task selector, inline создание/переключение и спокойный local-change indicator с keyboard/focus/error тестами.
- [x] 4.3 Реализовать компактный publication dialog с agent message, secondary regenerate/edit и единственным primary confirm; покрыть loading, empty, stale и success UI-тестами.
- [x] 4.4 Удалить Git mode и технические Git controls из основной sidebar/footer, сохранить secondary diagnostics и проверить responsive layout.
- [x] 4.5 Упростить header task selector до однострочного номера задачи с индикатором и chevron, убрать декоративную карточку и сократить popover до поля и списка; обновить UI-тесты.

## 5. Проверка результата

- [x] 5.1 Пройти `gofmt`, backend tests, frontend lint/typecheck/tests, `openspec validate --strict` и `npm run check`, исправив только относящиеся к change ошибки.
- [x] 5.2 Запустить локальное приложение с тестовым Store, проверить task switch и publication визуально в browser и сохранить desktop/mobile screenshots результата.
- [x] 5.3 Проверить минималистичный selector визуально в browser и сохранить актуальный screenshot.
