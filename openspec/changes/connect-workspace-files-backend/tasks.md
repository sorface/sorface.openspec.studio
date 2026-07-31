## 1. Backend document service

- [x] 1.1 Реализовать project-scoped document service для списка допустимых OpenSpec Markdown-файлов, чтения UTF-8 содержимого и SHA-256 хеша.
- [x] 1.2 Реализовать проверку относительного пути, разрешённых каталогов, расширения, размера и symlink escape с безопасными domain errors.
- [x] 1.3 Реализовать атомарную запись с `baseContentHash`, сохранением permissions и `DRAFT_CONFLICT`.
- [x] 1.4 Покрыть service unit-тестами списка, чтения, записи, конфликта, traversal, symlink escape и недопустимых файлов.

## 2. HTTP API

- [x] 2.1 Добавить project-scoped routes списка документов, чтения содержимого и явной записи.
- [x] 2.2 Сопоставить domain errors с единым API error envelope и защитить PUT существующим CSRF middleware.
- [x] 2.3 Добавить contract-тесты успешных ответов, project not found, validation, conflict и CSRF.

## 3. Frontend integration

- [x] 3.1 Добавить типизированные document model/API client и тесты query/payload/error contract.
- [x] 3.2 Реализовать document controller для загрузки дерева/файла, dirty/saving/conflict/error состояний, retry и защиты смены контекста.
- [x] 3.3 Перевести `WorkspaceSidebar` на server tree с loading, empty, error и выбранным файлом.
- [x] 3.4 Перевести `MarkdownEditor` и «Записать в файл» на server content/save state, сохраняя ввод при ошибке.
- [x] 3.5 Удалить runtime-зависимость workspace от демонстрационного `workspace-data.ts` и покрыть обновлённые состояния frontend-тестами.
- [x] 3.6 Сгруппировать server tree в разделы «Документация», «Изменения» и «Архив», скрыть технические корни, сохранить реальные document paths и покрыть rendered UI-тестом.
- [x] 3.7 Оставить в разделах sidebar только названия сущностей и открывать справа отдельное дерево Markdown выбранной спецификации или change; покрыть двухуровневую навигацию frontend-тестами.
- [x] 3.8 Сделать панель дерева самостоятельной grid-колонкой без перекрытия редактора и покрыть layout frontend-тестом и browser-проверкой.

## 4. Проверка

- [x] 4.1 Выполнить Go tests, frontend `npm run check`, production build и `openspec validate --strict`.
- [ ] 4.2 Проверить локальный browser flow: выбор проекта, загрузка реального дерева/файла, редактирование и запись через backend.
- [x] 4.3 После изменения навигации повторно выполнить frontend `npm run check`, production build и строгую OpenSpec-валидацию.
- [x] 4.4 Проверить двухуровневую навигацию в локальном браузере и повторно выполнить frontend `npm run check`, production build и строгую OpenSpec-валидацию.
