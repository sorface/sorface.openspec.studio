## 1. Store validation and clone

- [x] 1.1 Добавить общий backend validator локального Store и тесты для Git worktree, `.openspec-store/store.yaml`, `openspec/`, URL вместо пути и symlink/path edge cases
- [x] 1.2 Добавить безопасный сервис и `POST /api/v1/projects/from-git` для SSH/HTTPS clone, атомарного создания проекта, cleanup и классификации ошибок; покрыть API и service тестами
- [x] 1.3 Обновить создание локального проекта так, чтобы оно валидировало Store до persistence и возвращало безопасные коды ошибок
- [x] 1.4 Расширить мастер проекта режимами локального Store и Git clone, pending/error состояниями и автоматическим выбором созданного проекта; добавить frontend/API тесты
- [x] 1.5 Перенести все управляемые данные под `~/.osstudio`, изолировать Store и контекстные репозитории по project-space, убрать `targetPath` из пользовательских форм и API payload, обновить тесты
- [x] 1.6 Снять ограничения на OpenSpec-структуру и YAML-ключи для Store и контекстных репозиториев, сохранить проверку Git worktree и показывать пустое OpenSpec-состояние; покрыть произвольный репозиторий тестами

## 2. Read-only Git panel

- [x] 2.1 Реализовать backend Git status/diff service и `GET /api/v1/projects/{id}/git/status` с проверкой Store, лимитом diff и тестами
- [x] 2.2 Добавить frontend Git client/controller/panel со статусами loading, clean, changed и error
- [x] 2.3 Подключить sidebar/footer Git controls к переключению workspace и убрать ложные commit/push действия из доступного состояния

## 3. Agent CLI settings

- [x] 3.1 Обновить Projects controller для сохранения provider/model и синхронизации server response
- [x] 3.2 Сделать AI provider control рабочим: показать обнаруженные поддерживаемые CLI, сохранить provider/model и отобразить unavailable/error состояния
- [x] 3.3 Убрать скрытый fallback provider и согласовать блокировку, context review и запуск AI с сохранёнными настройками проекта

## 4. Verification

- [x] 4.1 Добавить интеграционные проверки новых API и rendered UI без disabled-заглушек для доступных Git/agent controls
- [x] 4.2 Запустить форматирование, Go/TypeScript тесты, `npm run check`, production build и `openspec validate --strict`
- [x] 4.3 Перезапустить локальные frontend/backend и проверить в браузере создание проекта из SSH формы, Git-панель и сохранение Codex provider
- [x] 4.4 Исправить написание названия раздела sidebar на `OpenSpec` и проверить rendered UI
- [x] 4.5 Увеличить масштаб desktop UI до 120%, скорректировать responsive breakpoints и проверить отсутствие пересечений в браузере
- [x] 4.6 Убрать корневой CSS `zoom`, увеличить UI через обычные CSS-размеры, нормализовать toolbar Milkdown и проверить в браузере позиционирование caret/selection и отсутствие overflow
- [x] 4.7 Добавить независимый vertical scroll дерева OpenSpec, рабочее сворачивание каталогов и корректный chevron selector agent CLI; покрыть rendered UI тестами и проверить в браузере
- [x] 4.8 Нормализовать baseline, отступы и вертикальный ритм списков, task-list, цитат и вложенных блоков Milkdown; покрыть CSS assertions и проверить геометрию в браузере
- [x] 4.9 Заменить ведущую иконку selector agent CLI на `✦`, обновить rendered UI assertion и проверить отображение в браузере
- [x] 4.10 Заменить сырой `<pre>` Preview на read-only Milkdown renderer, синхронизировать Split через `replaceAll`, добавить тесты семантического DOM и проверить текущий документ в браузере
- [x] 4.11 Не учитывать initialization-события Milkdown как изменение документа, сохранить предупреждение после реального ввода и проверить переключение неизменённых Markdown-файлов
- [x] 4.12 Упорядочить артефакты каждого OpenSpec change как `proposal.md` → `specs/` → `design.md` → `tasks.md`, покрыть backend-тестом и проверить дерево в браузере
- [x] 4.13 Визуально разделить аналитические (`proposal.md`, `specs/`) и разработческие (`design.md`, `tasks.md`) артефакты текстовыми метками, цветом и доступными именами; покрыть rendered UI и проверить дерево в браузере
- [x] 4.14 Реализовать read-only Git-историю выбранного Markdown-файла через backend API и UI-панель с loading, empty, error/retry; покрыть backend/frontend тестами и проверить в браузере
- [x] 4.15 Восстановить undo/redo визуального редактора и платформенный Save shortcut (`Cmd` macOS, `Ctrl` Windows/Linux) с capture-перехватом; покрыть frontend тестами и проверить в браузере
