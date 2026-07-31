## 1. Манифест проекта

- [x] 1.1 Добавить YAML dependency и строгий parser `.openspec/context.yaml` с проверкой пути, symlink, размера, полей, типов и одного документа.
- [x] 1.2 Покрыть parser unit-тестами корректного файла, отсутствия, неизвестных полей, неверных типов, пустого имени, symlink и превышения лимитов.

## 2. Domain flow и импорт репозиториев

- [x] 2.1 Расширить project domain опциональной сводкой `contextImport`, ошибками манифеста и двухфазным интерфейсом ContextImporter.
- [x] 2.2 Обновить `CreateFromGit`: применять manifest name, сохранять fallback без манифеста, валидировать весь список до создания проекта и запускать импорт после создания.
- [x] 2.3 Реализовать в repository service валидацию/дедупликацию и последовательный best-effort clone с существующими path, environment, timeout и worktree проверками.
- [x] 2.4 Покрыть project orchestration и repository import unit/integration-тестами, включая полный и частичный успех.

## 3. API и интерфейс

- [x] 3.1 Подключить context importer в production wiring и добавить API mapping для `INVALID_CONTEXT_MANIFEST` и `INVALID_CONTEXT_REPOSITORY_URL`.
- [x] 3.2 Сделать имя в Git-форме fallback-полем, объяснить приоритет `.openspec/context.yaml` и показывать итог автоматического импорта.
- [x] 3.3 Обновить TypeScript/API/rendered-contract тесты для опционального имени и `contextImport`.

## 4. Проверка

- [x] 4.1 Выполнить focused Go/frontend tests, `npm run check`, production build и строгую OpenSpec-валидацию change.
- [x] 4.2 Проверить в локальном браузере форму клонирования и отображение manifest-подсказки без изменения пользовательских репозиториев.
