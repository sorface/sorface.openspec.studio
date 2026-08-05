## Context

См. `proposal.md` — раздел Why. Репозиторий одновременно поддерживает два frontend entrypoint: Vinext/Sites использует Next-style `app`, а локальный standalone frontend использует отдельный Vite entrypoint `web` и собирается внутрь Go binary. Корневые конфигурации запускают оба контура и обращаются к D1 schema, Worker entrypoint и build scripts по относительным путям. Тесты дополнительно читают frontend-файлы напрямую, поэтому миграция путей является сквозной.

## Goals / Non-Goals

**Goals:**

- Установить отдельные project roots `openspec.frontend/` и `openspec.backend/`.
- Сохранить `src/` как внутренний корень TypeScript runtime-кода, feature-first границы `features/*` и независимость Go backend.
- Отделить поддерживающие build/release инструменты от runtime-кода.
- Сделать generated output узнаваемым и полностью игнорируемым.
- Выполнить миграцию атомарно с проверкой local web, Sites и standalone release контуров.

**Non-Goals:**

- Не менять frontend-компоненты, API contracts, database schema или Go package layout.
- Не добавлять package-manager workspaces или новые зависимости.
- Не переносить общерепозиторные `openspec`, `docs`, CI и cross-project release orchestration внутрь одного из модулей.

## Decisions

### 1. Frontend целиком размещается в `openspec.frontend/`

Node manifest и lockfile, frontend configs, `public`, D1 migrations, examples, frontend tests и Sites/Cloudflare metadata перемещаются вместе с runtime-кодом. Внутри модуля alias `@/*` указывает на `src/*`; это минимизирует изменения production imports и оставляет feature-first модель видимой.

Frontend-команды запускаются через `npm --prefix openspec.frontend ...`, поэтому root не содержит frontend-specific package files.

### 2. Backend целиком размещается в `openspec.backend/`

`go.mod`, `go.sum`, `cmd` и `internal` составляют самостоятельный Go module. Встраиваемая frontend-сборка размещается в `openspec.backend/internal/web/dist`, а Go-команды запускаются с `go -C openspec.backend`.

### 3. Tooling разделяется по области ответственности

Cross-project Node scripts остаются в root `tooling/scripts`, потому что оркестрируют оба модуля и root `out/`. Sites Vite plugin переносится в `openspec.frontend/tooling/sites`, поскольку относится только к frontend.

Альтернатива оставить `scripts` в root проще технически, но сохраняет смешение runtime и repository automation, ради устранения которого выполняется change.

### 4. Документирующие изображения объединяются

Tracked screenshots, browser artifacts и корневой preview переносятся в `docs/assets/screenshots/`. Смысловые подпапки сохраняются, а README использует новые пути.

### 5. Управляемый проектом generated output собирается под `out/`

Локальный binary и cross-platform release artifacts получают подпапки `out/bin` и `out/release`. Встраиваемый Go frontend остаётся исключением: `openspec.backend/internal/web/dist` является обязательным build input. `dist`, `.next`, `.vinext` и `.wrangler` принадлежат frontend build tools, располагаются внутри `openspec.frontend/` и исключаются через `.gitignore`.

### 6. Миграция путей проверяется на границах контуров

Проверки включают TypeScript/lint/tests, Sites build, Go tests и standalone build. Тестовые пути обновляются механически, но assertions поведения не ослабляются.

Новые файловые или CLI-возможности не добавляются. Существующие path validation, cancellation, timeout и audit boundaries backend не затрагиваются.

## Risks / Trade-offs

- [Vinext не обнаружит `src/app`] → подтвердить через `npm run build:site` и оставить root configs на месте.
- [Локальный Vite alias разрешится относительно старого root] → явно задать `root: "src/web"` и alias на `src`.
- [Прямые file reads в тестах останутся на старых путях] → выполнить полный поиск старых path prefixes и запустить весь test suite.
- [Release scripts создадут root-каталоги повторно] → централизовать output paths в `tooling/scripts` и обновить ignore rules.
- [Команды будут искать Node или Go manifest в root] → запускать их с явными `npm --prefix openspec.frontend` и `go -C openspec.backend`.
- [Большой rename усложнит review] → не смешивать с функциональными изменениями; Git сможет распознать перемещения по идентичному содержимому.

## Migration Plan

1. Переместить весь frontend project в `openspec.frontend/`, сохранив его внутреннюю структуру.
2. Переместить Go module и backend packages в `openspec.backend/`.
3. Обновить configs, npm scripts, CI, aliases, cross-project tooling и test paths.
4. Обновить README и `.gitignore`.
5. Запустить поиск устаревших путей, frontend check, Sites build, Go tests и standalone/release builds.
6. При откате вернуть модули на прежние пути и восстановить configs; формат данных и API не требуют rollback migration.
