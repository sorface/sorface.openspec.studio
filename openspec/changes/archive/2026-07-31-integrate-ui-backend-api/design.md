## Context

См. `proposal.md` — Why. Backend уже обслуживает встроенный frontend и реализует health, session/CSRF, capabilities и Projects CRUD под `/api/v1`. Frontend использует feature-first структуру, но сейчас имеет только отдельный health client, а workspace опирается на статические данные.

Интеграция пересекает transport, состояние React и несколько UI-компонентов. Backend и SQLite-схема не требуют изменений; граница безопасности остаётся на локальном сервере.

## Goals / Non-Goals

**Goals:**

- Сформировать единый предсказуемый frontend transport для JSON API и ошибок.
- Сосредоточить project state и мутации в feature-модуле, не распределяя `fetch` по компонентам.
- Обеспечить детерминированный выбор активного проекта и согласованное optimistic-free обновление UI.
- Сохранить работоспособность одного origin в embedded build и Vite proxy в локальной разработке.

**Non-Goals:**

- Не вводить глобальный state manager или query-библиотеку.
- Не моделировать на клиенте данные, для которых backend ещё не предоставляет endpoints.
- Не менять domain/service/storage слои backend и не добавлять обход прямым доступом к файлам.
- Не превращать текущий workspace в полноценный project onboarding flow.

## Decisions

### 1. Общий API transport и feature-клиенты

Создать небольшой общий transport, который выполняет JSON-запросы, разбирает стандартный error envelope и выбрасывает типизированную `ApiError` с `status`, `code`, `message`, `details` и `correlationId`. System и projects feature-клиенты задают конкретные endpoint-типы и не раскрывают компонентам `Response`.

Это выбрано вместо прямых `fetch` в hooks, чтобы единообразно обрабатывать ошибки и CSRF. Полноценная библиотека запросов не добавляется: объём API мал, SSR cache и сложная инвалидация пока не нужны.

### 2. Ленивый session/CSRF с одним безопасным повтором

Transport кэширует promise получения `/api/v1/system/session` в памяти browser-сессии. Для изменяющих методов он добавляет `X-CSRF-Token`. При `403` с `CSRF_REJECTED` кэш сбрасывается, session получается заново, и исходный запрос повторяется ровно один раз.

Повтор ограничен одним разом, чтобы исключить цикл при постоянной ошибке безопасности. GET-запросы не получают CSRF header.

### 3. Project controller hook как владелец серверного состояния

Feature hook загружает projects и capabilities параллельно после подтверждения доступности API, хранит `loading | ready | empty | error | unavailable`, активный project ID и флаги мутаций. Create/update/delete применяются к state только после успешного ответа backend; optimistic updates не используются.

Активный ID сохраняется в `localStorage` как preference, но валидируется по каждому свежему списку. При отсутствии ID выбирается первый проект; после удаления — следующий доступный. `localStorage` не считается источником project metadata.

Альтернатива — React Context на всё приложение. На текущем единственном workspace-экране это избыточно; hook поднимается в `OpenSpecWorkspace`, а данные и callbacks передаются явными props.

### 4. Project switcher с управлением без отдельного route

Текущий header switcher становится доступным popover/menu: список проектов, выбор и действия создать, переименовать, удалить. Формы должны иметь labels, клавиатурный focus и блокировать submit на время запроса. Удаление требует явного подтверждения с уточнением, что каталоги не удаляются.

Так сохраняется текущая информационная архитектура. Полноценный project list/master остаётся отдельной будущей реализацией.

### 5. Честная граница интеграции workspace

Header использует реальные name, storePath, default provider/model и capabilities. Документ, дерево OpenSpec, Git-данные, AI prompt и кнопки записи не становятся «подключёнными» без соответствующих endpoints. Недоступные серверные действия остаются явно disabled/помеченными как пока недоступные, а локальный ввод редактора не очищается при сетевой ошибке.

Это предотвращает смешение подтверждённых данных и демонстрационного состояния.

### 6. Тестовая стратегия

Transport и feature controller покрываются тестами с подменённым `fetch`: success, error envelope, network error, CSRF header и единственный retry. Компонентные сценарии покрывают loading, empty, выбор, ошибку и подтверждение удаления. Существующие Go contract tests остаются проверкой backend endpoints.

## Risks / Trade-offs

- [Ручное управление request state может усложниться с ростом API] → Сохранить transport и feature boundaries, перейти на query library только при появлении cache/invalidation требований.
- [Ответ старого запроса может перезаписать новое состояние] → Использовать `AbortController` для lifecycle-загрузки и сериализовать project mutations.
- [Backend перезапустился между session и mutation] → Один refresh/retry только для `CSRF_REJECTED`.
- [Popover может ухудшить клавиатурную доступность] → Использовать нативные элементы формы, управление Escape/focus и доступные имена.
- [Поля backend пока не описывают фактический Store worktree] → Показывать `storePath` как путь Store и не выдавать его за подтверждённую ветку/worktree.

## Migration Plan

1. Добавить transport и типы без изменения существующего health поведения.
2. Подключить system session/capabilities и project controller.
3. Перевести header/project switcher на реальные данные и добавить состояния.
4. Удалить только те статические подписи, для которых появился серверный источник.
5. Прогнать frontend, backend и OpenSpec проверки; embedded build остаётся совместимым благодаря относительным `/api/v1` URL.

Rollback выполняется удалением frontend-интеграции: backend API и SQLite не меняются, миграции данных отсутствуют.
