## 1. Backend preview и безопасность

- [x] 1.1 Добавить модель deletion preview/result и построение отсортированного snapshot файлов активного change.
- [x] 1.2 Расширить fingerprint содержимым полного дерева change и покрыть изменения состава тестами.
- [x] 1.3 Реализовать безопасное удаление с проверкой kebab-case, confirmation, fingerprint, archive и symlink/path escape.
- [x] 1.4 Добавить DELETE API, безопасные error codes и backend integration tests.

## 2. Frontend workflow

- [x] 2.1 Расширить OpenSpec API/types/controller данными preview и методом удаления.
- [x] 2.2 Добавить действие и dialog с предупреждением, списком файлов, точным вводом имени, Escape и отменой.
- [x] 2.3 После удаления обновлять OpenSpec workflow и дерево документов без устаревшего выбранного файла.
- [x] 2.4 Добавить frontend contract tests и стили доступного danger-сценария.

## 3. Проверка

- [x] 3.1 Выполнить форматирование, unit/integration tests, `npm run check` и релевантную сборку.
- [ ] 3.2 Проверить preview, отмену и защиту подтверждения в локальном UI без удаления пользовательского change.
