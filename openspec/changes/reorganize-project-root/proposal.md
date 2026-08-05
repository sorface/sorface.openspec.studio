## Why

Исходники frontend, Sites/Cloudflare entrypoints, tooling и визуальные артефакты сейчас расположены рядом с обязательными корневыми конфигурационными файлами. Из-за этого назначение каталогов неочевидно, навигация по репозиторию усложняется, а добавление новых файлов продолжает перегружать root.

## Цель

Сделать корневую структуру репозитория компактной и предсказуемой: весь frontend должен находиться в `openspec.frontend/`, весь backend — в `openspec.backend/`, а в root остаются только общерепозиторные файлы. Пользовательское поведение OpenSpec Studio, публичные API и формат поставки не меняются.

## Scope

- Сгруппировать frontend-исходники, зависимости, тесты, конфигурацию, public assets и Sites/Cloudflare-файлы в `openspec.frontend/`, сохранив внутреннюю `src/` feature-first организацию.
- Сгруппировать Go module и backend-исходники в `openspec.backend/`.
- Оставить в root только общерепозиторные build/release scripts и метаданные проекта.
- Перенести изображения и снимки интерфейса в `docs/assets/`.
- Обновить импорты, конфигурацию TypeScript/Vite/Drizzle, npm scripts, тесты и README под новые пути.
- Сохранить обязательные tool-discovery файлы и каталоги в root.
- Перенаправить управляемые проектом binary/release outputs из root в единый игнорируемый каталог `out/`, сохранив conventional output сторонних build tools.

## Вне scope

- Изменение поведения UI, backend API или доменной модели.
- Изменение границ feature-модулей или Go packages.
- Замена npm, Vite, Vinext, Cloudflare, Drizzle или OpenSpec.
- Публикация новой версии приложения.

## What Changes

- **BREAKING для внутренних путей репозитория:** весь Node/frontend project перемещается в `openspec.frontend/`; его runtime-код остаётся организован внутри `openspec.frontend/src/`.
- **BREAKING для внутренних путей репозитория:** Go module и backend packages перемещаются в `openspec.backend/`.
- Sites-specific tooling располагается в `openspec.frontend/tooling/sites`, а общие build/release scripts остаются в root `tooling/scripts` и оркестрируют оба модуля.
- Скриншоты и корневой preview image объединяются в `docs/assets/screenshots/`.
- Generated outputs `bin` и `release` объединяются под `out/`; `dist`, `.next`, `.vinext` и `.wrangler` остаются на ожидаемых сторонними инструментами путях и игнорируются.
- Все внутренние ссылки и проверки обновляются атомарно.

## Capabilities

### New Capabilities

Нет. Change является чистым рефакторингом структуры репозитория и использует `skip_specs: true`.

### Modified Capabilities

Нет. Наблюдаемое поведение baseline capabilities не меняется.

## Impact

Затронуты пути обоих модулей, frontend-исходников, Sites worker и D1 schema, Go module, локальный Vite entrypoint, build/release scripts, CI, тестовые fixture paths и архитектурное описание в README. Runtime API, хранилище, безопасность и пользовательские сценарии остаются без изменений.

## Риски

- Пропущенный путь может нарушить одну из локальной, Sites или standalone-бинарной сборок.
- Перемещение entrypoints может изменить разрешение alias или относительных CSS imports.
- Generated output может быть случайно добавлен в Git, если ignore rules и scripts разойдутся.
- Незакоммиченные пользовательские изменения необходимо сохранить без перезаписи.
