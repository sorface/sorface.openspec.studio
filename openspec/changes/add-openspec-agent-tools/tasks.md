## 1. OpenSpec read model

- [x] 1.1 Добавить нормализованные backend-типы OpenSpec capability, change status, artifact, action и diagnostics с unit-тестами JSON fixtures поддерживаемой и неподдерживаемой версии CLI
- [x] 1.2 Реализовать безопасный OpenSpec adapter для `list`, `show`, `status`, `instructions` и `validate` через process runner с фиксированными argv, timeout, output limits и проверкой read-only поведения
- [x] 1.3 Реализовать application service обзора changes и вычисления available/blocked actions из status/instructions, включая fingerprint зависимостей и тесты stale/blocked состояний
- [x] 1.4 Добавить read API списка/деталей changes и validate с безопасными кодами ошибок, correlation ID и интеграционными HTTP-тестами

## 2. OpenSpec agent orchestration

- [x] 2.1 Расширить модель и persistence AI operation полями OpenSpec action kind, change, schema, artifact и status fingerprint с обратной совместимостью существующих операций и storage-тестами
- [x] 2.2 Реализовать создание изолированного operation workspace и безопасные primitives `new change`/`archive`, включая cancellation, cleanup, symlink/path проверки и adapter/service тесты
- [x] 2.3 Реализовать backend prompt builder из user goal, instruction, context/rules/template, dependency artifacts и подтверждённого manifest с лимитами и тестами недоверенных инструкций
- [x] 2.4 Добавить action-specific scope resolver и post-operation audit для create/update artifact/archive, отклоняющий несвязанные changes, baseline specs вне archive и read-only repositories
- [x] 2.5 Добавить post-operation `status`/`validate`, сохранение diagnostics и переход в awaiting_review только для полного разрешённого результата
- [x] 2.6 Реализовать `POST /api/v1/projects/{id}/openspec/actions` для create/continue/fix/archive с повторной проверкой fingerprint, provider availability, operation conflict и API-тестами

## 3. Review и draft mutations

- [x] 3.1 Расширить diff result типами file mutation `create`, `update`, `delete` и согласованным `rename`, сохранив совместимость существующего AI diff review
- [x] 3.2 Реализовать атомарные draft revisions/tombstones для принятого mutation set и транзакционную запись create/update/delete/rename с optimistic concurrency и rollback тестами
- [x] 3.3 Подключить OpenSpec operation result к accept/reject workflow, запретить частичное принятие archive и обновлять status только после принятия и явной записи

## 4. OpenSpec workspace

- [x] 4.1 Добавить frontend feature `openspec-workflow` с типами, API client и controller/state machine для overview, выбранного change, validate, action, SSE progress и stale refresh
- [x] 4.2 Реализовать OpenSpec-панель со списком changes, schema, прогрессом, dependencies, diagnostics и loading/empty/blocked/error/unavailable состояниями
- [x] 4.3 Реализовать формы создания change и запуска доступного artifact action с user goal, provider/model, review разрешённого контекста и безопасным отображением причин блокировки
- [x] 4.4 Интегрировать awaiting-review OpenSpec operation с существующим diff UI, показывать роли артефактов и create/update/delete/rename, а для archive требовать принятия полного набора
- [x] 4.5 Добавить frontend-тесты доступности read-only действий без agent, запуска/отмены операции, stale status, validate diagnostics, review результата и повторной загрузки следующего action

## 5. Сквозная проверка

- [x] 5.1 Добавить интеграционный сценарий `create change → proposal → specs → design → tasks` через mock provider с проверкой status после каждого принятого и записанного артефакта
- [x] 5.2 Добавить интеграционные сценарии validate/fix и archive preview, включая scope violation, неподдерживаемую версию CLI, конфликт Store и отсутствие изменений реального worktree до явной записи
- [x] 5.3 Запустить форматирование, Go и TypeScript тесты, `npm run check`, production build и `openspec validate add-openspec-agent-tools --strict`
- [x] 5.4 Перезапустить локальные backend/frontend и проверить в браузере OpenSpec-панель, создание change через agent, progress/cancel, diff review, validate и archive preview
