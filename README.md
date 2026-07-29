# OpenSpec Studio

Локальное рабочее пространство для OpenSpec Store, связанных кодовых
репозиториев, Markdown-черновиков, Git и AI-провайдеров.

## Самый простой запуск

Для сборки из исходников нужны Node.js 22+ и Go 1.24+. Затем:

```bash
npm run setup
```

Команда установит зависимости, выполнит проверки, соберёт единый локальный
бинарник и запустит его. Сервер выберет свободный loopback-порт и откроет
браузер автоматически.

Для последующих запусков достаточно:

```bash
npm start
```

## Команды разработки

```bash
npm run dev       # локальная разработка с автообновлением
npm run build     # frontend + единый бинарник текущей ОС
npm run release   # бинарники macOS, Linux и Windows
npm test          # frontend- и backend-тесты
npm run check     # типы/правила, сборка и тесты
```

## Архитектура

Проект построен по feature-first принципу: бизнес-функции сгруппированы по
предметной области, а не по техническому типу файла.

```text
app/                              маршруты, layout и глобальный entry CSS
components/ui/                    небольшие переиспользуемые UI-примитивы
features/
  editor/                         визуальный Markdown-редактор
  system/                         API-клиент и состояние local server
  workspace/
    components/                   композиция и панели workspace
    model/                        типы и данные предметной области
    styles/                       стили только этой функции
backend/
  cmd/openspec-studio/            точка входа единого бинарника
  internal/
    config/                       безопасная локальная конфигурация
    httpapi/                      REST API, CSRF, origin и correlation ID
    project/                      доменная модель и application service
    storage/                      SQLite repository и миграция
    tools/                        обнаружение Git/OpenSpec/AI CLI
    platform/browser/             открытие browser на трёх ОС
    web/                          встроенный собранный frontend
scripts/                          dev, build, start и cross-platform release
tests/                            интеграционные и архитектурные тесты
```

Правила зависимостей:

- `app` только собирает страницы из готовых features;
- feature может использовать `components/ui`, но UI-примитивы не знают о
  feature;
- типы и данные предметной области находятся в `model`;
- компоненты получают зависимости через типизированные props;
- внешний CLI, Git и файловая система подключаются через отдельные adapters,
  чтобы UI и доменная логика оставались тестируемыми;
- новые пользовательские сценарии добавляются вместе с тестами.

## Что реализовано в текущем инкременте

- полноценный workspace с деревом specs/changes/archive;
- визуальный Markdown-редактор с режимами Edit, Preview и Split;
- постоянная панель форматирования, slash-команды, заголовки, списки, ссылки,
  таблицы, code blocks, drag-and-drop блоков и undo/redo;
- Markdown остаётся исходным форматом: редактор принимает и возвращает `.md`
  без промежуточного HTML-хранилища;
- состояние внутреннего черновика и явная запись в working tree;
- AI-панель с быстрыми действиями и review контекста;
- состояние Store, worktree, подключённых репозиториев и Git;
- адаптивные сворачиваемые панели и доступные подписи controls;
- Go local server, доступный только через loopback;
- автоматический выбор свободного порта и открытие browser;
- встроенный frontend внутри Go-бинарника;
- SQLite-хранилище проектов, сохраняющее данные после перезапуска;
- `/api/v1/system/health`, session/CSRF и capability detection;
- CRUD API проектов;
- origin-, CSRF- и correlation ID middleware;
- обнаружение Git, OpenSpec, Codex и GigaCode CLI;
- отмена server lifecycle через системные сигналы;
- CGO-free сборка для macOS, Linux и Windows;
- тесты реализованных frontend- и backend-сценариев.

Визуальные паттерны следуют Untitled UI: компактные application panels,
segmented controls, utility buttons, badges, tabs, textarea composer и
notifications. Код компонентов реализован локально; библиотека Untitled UI не
подключается и не загружается.

Для markdown-native WYSIWYG используется Milkdown Crepe. Он изолирован внутри
`features/editor`, загружается только в browser и уничтожается при размонтировании
компонента. Аналитику не требуется знать Markdown-синтаксис, но итоговый файл
остаётся обычным переносимым `.md`.

## Локальные данные и безопасность

SQLite создаётся в системной директории конфигурации пользователя. Сервер
отклоняет внешний bind address, произвольный web origin и изменяющие запросы без
CSRF token. Секреты Git и AI приложением не сохраняются.

Следующие инкременты подключат Git/OpenSpec/AI adapters, файловые черновики,
diff/hunk review и остальные API из полной MVP-спецификации.
