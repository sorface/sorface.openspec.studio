## 1. Runtime source layout

- [x] 1.1 Переместить `app`, `components`, `features`, `db`, `web` и `worker` в `src/`, обновить TypeScript alias, Vite/Vinext/Drizzle entrypoints и CSS imports, затем проверить typecheck и локальную frontend-сборку.
- [x] 1.2 Обновить прямые пути к frontend-файлам в тестах без изменения assertions и выполнить frontend tests.

## 2. Repository tooling and outputs

- [x] 2.1 Переместить Node scripts в `tooling/scripts` и Sites plugin в `tooling/sites`, обновить npm scripts и относительные пути, затем проверить dev/build entrypoints.
- [x] 2.2 Перенаправить local binary и release artifacts в `out/bin` и `out/release`, обновить `.gitignore` и release tests, затем проверить backend/release build.

## 3. Documentation assets

- [x] 3.1 Объединить tracked screenshots, artifacts и root preview image в `docs/assets/screenshots`, обновить ссылки и архитектурное дерево README.

## 4. Final validation

- [x] 4.1 Проверить отсутствие устаревших root path references и выполнить `npm run check`, `npm run build:site` и `npm run build`.

## 5. Module roots

- [x] 5.1 Переместить frontend manifest, lockfile, configs, runtime-код, public assets, migrations, examples, frontend tests и Sites metadata в `openspec.frontend/`; обновить внутренние пути и проверить frontend.
- [x] 5.2 Переместить Go module и backend packages в `openspec.backend/`; обновить embed/build paths и проверить Go tests.
- [x] 5.3 Обновить cross-project tooling, release workflow, README и ignore rules для явных `openspec.frontend` / `openspec.backend` boundaries.

## 6. Two-module validation

- [x] 6.1 Проверить отсутствие frontend/backend-specific файлов в root и выполнить frontend check, Sites build, Go tests, standalone/release builds и strict OpenSpec validation.
