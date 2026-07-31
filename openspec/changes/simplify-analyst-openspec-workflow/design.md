## Context

См. `proposal.md` — Why. В Studio уже есть project-scoped OpenSpec overview/details/validate API, action service для reviewable AI-операций, draft review/write и панель технических действий. Требуется собрать эти примитивы в понятный сценарий аналитика и добавить безопасную read-only фазу explore.

## Goals / Non-Goals

**Goals:**

- Свести создание change к одному пошаговому modal flow без знания CLI-команд.
- Не создавать change до успешного explore и явного подтверждения имени.
- Переиспользовать существующий lifecycle operation → review → draft → write для всех изменений Store.
- Сделать фактический validate заметным состоянием выбранного change.
- Сохранять введённую задачу и результат explore при исправимых ошибках UI.

**Non-Goals:**

- Не вводить отдельный workflow engine или собственные статусы OpenSpec.
- Не записывать AI-результат автоматически и не обходить существующий diff review.
- Не объединять создание всех артефактов в одну непрозрачную backend-команду: стартовый change включает только последовательно подготовленные `proposal` и `specs`, показывает общий diff, а `design` и `tasks` остаются отдельными шагами.
- Не хранить незавершённый wizard между перезапусками приложения.

## Decisions

### 1. Explore как отдельная read-only OpenSpec action

Action API получает kind `explore`, для которого обязательны prompt/provider, но не change. Action service запускает agent в изолированном снимке Store с инструкцией исследовать задачу и не менять файлы. После завершения post-operation audit требует пустой diff; итоговый текст операции возвращается UI как результат исследования без draft/write стадии.

Альтернатива — обычный чат AI-панели — отклонена: он не даёт продуктовой гарантии, что explore предшествовал созданию, и не связывает результат с последующим handoff.

### 2. Modal wizard хранит только presentation state

`OpenSpecPanel` открывает модальное окно со стадиями `describe`, `exploring`, `review` и `creating`. Долговечные состояния операции остаются в существующем controller/backend; modal хранит описание задачи, исследование и выбранное имя. Закрытие во время running требует отмены или завершения операции.

Альтернатива — отдельная таблица wizard session в SQLite — отклонена как избыточная для локального single-user сценария.

### 3. Handoff explore → create использует существующую reviewable операцию

После explore UI отправляет `create_change` с выбранным change и goal, составленным из исходного описания и результата исследования. Backend повторно проверяет kebab-case/уникальность, последовательно получает актуальные OpenSpec instructions для `proposal` и ставшего доступным `specs`, затем показывает оба результата одним reviewable diff. Только после accept и write overview и document tree обновляются, созданный change выбирается автоматически. Эта цепочка не создаёт `design` и `tasks` и не обходит зависимости схемы.

Альтернатива — выполнить `openspec new change` непосредственно из modal — отклонена: она изменила бы Store до review и нарушила invariant явной записи.

### 4. Рекомендуемые артефактные действия поверх фактического status

Controller продолжает получать `details.actions`, но UI группирует их в человекочитаемый следующий шаг. Для готового proposal и доступных specs действие называется «Обновить спецификацию»; backend по-прежнему запускает `prepare_artifact`/`fix_artifact` с конкретным artifact из status/instructions. Ручное редактирование остаётся в общем Markdown editor.

### 5. Validation — самостоятельная state machine UI

Controller хранит `validationStatus: idle | checking | valid | invalid | error` и результат диагностики. Статус сбрасывается при выборе другого change или успешной записи draft, затем автоматически запускается для выбранного change после refresh. UI показывает компактный badge в заголовке и подробности рядом с рекомендуемыми действиями.

Альтернатива — выводить validate только после нажатия в нижней части страницы — отклонена: аналитик не видит, можно ли доверять текущим артефактам.

### 6. Безопасность и выполнение

Все mutating routes сохраняют CSRF и project scope. Agent получает writable только изолированный Store snapshot, подключённые repositories остаются read-only. Explore имеет явную cancellation и audit пустого diff; create/update проходят существующий scope audit и review-before-write.

### 7. Контекстное редактирование переиспользует OpenSpec action

`RichMarkdownEditor` добавляет собственный элемент в Crepe toolbar и передаёт выбранный текст наружу, не включая встроенный AI runtime редактора. Диалог формирует инструкцию из активного пути, выделения и пользовательского запроса. Controller загружает свежие details change, сопоставляет файл с server-provided artifact action и запускает `fix_artifact` с актуальным fingerprint. После запуска workspace открывает OpenSpec workflow, где остаются стандартные cancel, full diff, accept и write.

Альтернатива — отправлять запрос через общий AI assistant — отклонена: у него нет artifact-level scope и полного OpenSpec draft/write lifecycle.

### 8. Explore сообщает безопасную активность без deadline

Backend построчно разбирает JSONL-поток agent CLI и преобразует только типы событий в throttled `provider_event`: подготовка плана, изучение контекста, сопоставление фактов, формирование результата и проверка read-only границ. Текст скрытых рассуждений, команды, prompt и содержимое файлов не передаются в UI. Controller сохраняет ограниченную ленту уникальных этапов и время от `createdAt`; modal явно сообщает, что исследование не ограничено по времени, и сохраняет ручную отмену.

Для `explore` process runner использует родительский cancellable context без `WithTimeout`. Операция завершается только результатом или ошибкой provider, явной отменой, остановкой процесса либо перезапуском приложения. Настроенный общий timeout продолжает действовать для остальных AI/OpenSpec actions.

Альтернатива — передавать сырой поток рассуждений модели — отклонена: он может содержать внутренний prompt, команды и данные файлов, а также не является стабильным пользовательским контрактом. Один spinner без ленты этапов также отклонён: работающий provider визуально не отличается от зависшего процесса.

### 9. Иконка добавления в разделе «Изменения» переиспользует мастер

`WorkspaceSidebar` показывает рядом с заголовком «Изменения» отдельную доступную icon-button. Она не вложена в кнопку раскрытия раздела: клик передаёт в workspace одноразовый запрос, переключает центральную область в режим OpenSpec и открывает существующий modal wizard через `OpenSpecPanel`. После обработки запрос сбрасывается, поэтому обычное возвращение в OpenSpec не открывает мастер повторно.

Альтернатива — только переключать пользователя на экран управления — отклонена: иконка добавления должна приводить непосредственно к форме создания, а не требовать второго клика.

## Risks / Trade-offs

- [Agent во время explore изменил snapshot] → отклонять результат как scope/read-only violation и показывать повтор.
- [Большой explore result раздувает create prompt] → ограничить размер итогового текста и сохранять исходную задачу как приоритетный ввод.
- [Wizard закрыт во время операции] → не терять backend operation; при повторном открытии восстанавливать текущий operation из controller в пределах сессии.
- [Validate устарел после записи] → сбрасывать статус на write и запускать повторную проверку после refresh.
- [Действия status отличаются между версиями OpenSpec] → выбирать действие из server-provided actions, а не строить CLI-команды во frontend.

## Migration Plan

1. Расширить OpenSpec action model/service и contract tests read-only kind `explore`.
2. Добавить controller state и modal wizard с rendered/frontend tests.
3. Добавить рекомендуемые artifact actions и постоянный validate status.
4. Проверить полный browser flow на реальном Store без автоматической записи результата.

Rollback: скрыть modal entry point и kind `explore`; существующая техническая OpenSpec-панель и API actions остаются совместимыми.
