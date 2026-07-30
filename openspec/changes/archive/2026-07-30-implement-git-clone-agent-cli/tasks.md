## 1. Сохранённая модель операций

- [x] 1.1 Добавить версионированную SQLite migration для repositories, operations, operation_events, ai_context_entries и operation_audit с foreign keys и индексами; покрыть создание и повторное применение migration storage-тестами.
- [x] 1.2 Реализовать доменную модель operation со строгими допустимыми переходами статусов clone и AI; покрыть terminal, conflict и invalid-transition сценарии unit-тестами.
- [x] 1.3 Реализовать SQLite repositories для подключённых репозиториев, операций, событий, context manifest и audit с атомарными транзакциями; покрыть CRUD, ordering и rollback тестами.
- [x] 1.4 При старте переводить незавершённые операции в failed с `APPLICATION_RESTARTED`; проверить restart-сценарий интеграционным storage/service тестом.

## 2. Безопасная инфраструктура CLI

- [x] 2.1 Реализовать process command policy с абсолютным executable, фиксированными args, stdin, cwd, allowlist окружения, timeout и output limits без shell; покрыть option injection, redaction и environment filtering тестами.
- [x] 2.2 Реализовать bounded stdout/stderr capture и безопасный operation audit; покрыть нормальное завершение, non-zero exit и `AI_OUTPUT_LIMIT_EXCEEDED` fake-process тестами.
- [x] 2.3 Реализовать process supervisor с регистрацией по operation ID, cancellation и graceful/forced shutdown; покрыть отмену и отсутствие orphan-процессов на Unix и Windows-совместимой абстракции.
- [x] 2.4 Подключить supervisor к lifecycle приложения так, чтобы shutdown отменял процессы до закрытия SQLite; добавить backend integration test.

## 3. Git clone application service

- [x] 3.1 Реализовать строгую валидацию HTTPS, `ssh://` и scp-like Git URL, а также canonical target policy для отсутствующего/пустого каталога; покрыть invalid scheme, option injection, symlink escape и protected root тестами.
- [x] 3.2 Реализовать Git adapter для clone progress, remote/HEAD/branch/status/fingerprint и sanitization stderr поверх общего runner; покрыть adapter fake executable и fixture-тестами.
- [x] 3.3 Реализовать чтение `store` из корректного `openspec/config.yaml` и проверку Store ID проекта без неявной записи конфигурации; покрыть match, missing, invalid YAML и `STORE_ID_MISMATCH`.
- [x] 3.4 Реализовать RepositoryService с переходами queued → running → validating → completed, атомарной регистрацией repository и безопасной политикой очистки target; покрыть success, cancel, validation failure и persistence failure интеграционными тестами.

## 4. Git clone HTTP API и SSE

- [x] 4.1 Добавить list repositories и create/get/cancel clone endpoints с project ownership, CSRF, единым error envelope и `202 Accepted`; расширить backend contract tests.
- [x] 4.2 Добавить сохранённый event stream с SSE IDs, `Last-Event-ID`, heartbeat и terminal close; покрыть replay, reconnect, cancel и медленного consumer тестами.
- [x] 4.3 Подключить RepositoryService и supervisor в composition root, сохранив health и Projects API; проверить embedded server integration test.

## 5. Repository frontend vertical slice

- [x] 5.1 Создать `features/repositories` с типами, API client и controller для list/create/get/cancel, SSE reconnect и polling fallback; покрыть transport/controller тестами.
- [x] 5.2 Добавить clone dialog с Git URL, target path, validation, progress, cancel и безопасной ошибкой с correlation ID; покрыть keyboard, submit lock, cancel и retry component tests.
- [x] 5.3 Перевести repository-секцию workspace со статических данных на подтверждённое серверное состояние, включая unavailable, branch/SHA, dirty и `readOnlyForAi`; обновить rendered workspace tests.

## 6. Контекст и изолированный AI workspace

- [x] 6.1 Реализовать path resolver и ContextBuilder с trusted roots, symlink resolution, denylist, binary/secret filtering, file/count/total limits и SHA-256 manifest; покрыть traversal, stale, oversized и secret fixtures.
- [x] 6.2 Реализовать короткоживущий review token и повторную checksum-проверку при создании AI operation; покрыть tampering, expiry и `AI_CONTEXT_STALE`.
- [x] 6.3 Реализовать WorkspaceManager, создающий baseline/working snapshot внутри data dir без symlink/device files и очищающий terminal workspace; проверить, что реальный Store не изменяется.
- [x] 6.4 Реализовать prompt envelope, который передаёт выбранные repository files только как ограниченный текстовый контекст без раскрытия writable repository paths; покрыть source labels, truncation и отсутствие secrets.

## 7. Agent adapters и аудит результата

- [x] 7.1 Определить provider interface и capability probe для non-interactive mode, models и normalized events; покрыть unavailable и unsupported provider тестами.
- [x] 7.2 Реализовать Codex adapter для `codex exec --json --ephemeral --sandbox workspace-write --skip-git-repo-check`, prompt через stdin и allowlisted model; покрыть args, JSONL fixtures, unknown events и final response тестами.
- [x] 7.3 Реализовать GigaCode adapter по capability probe поддерживаемой версии и fake CLI fixtures, возвращая `AI_PROVIDER_UNSUPPORTED`, когда безопасный non-interactive режим отсутствует.
- [x] 7.4 Реализовать ResultAuditor для baseline/working diff, запрещённых путей/типов файлов и проверки неизменности Store/code repositories; покрыть success, empty diff и `AI_SCOPE_VIOLATION`.

## 8. AI operation service и API

- [x] 8.1 Реализовать AiOperationService с project-level exclusivity и переходами queued → running → validating → awaiting_review/cancelled/failed; покрыть conflict, unavailable provider, timeout и cancellation.
- [x] 8.2 Сохранять prompt, provider/model, context manifest, normalized events, final response, diff и redacted audit без secrets; покрыть persistence и redaction интеграционными тестами.
- [x] 8.3 Добавить context manifest и create/get/cancel AI endpoints с CSRF, ownership и стабильными error codes; расширить backend contract tests.
- [x] 8.4 Подключить AI SSE к общему replay/reconnect механизму и проверить resume после сохранённых событий, terminal state и correlation ID.

## 9. AI frontend vertical slice

- [x] 9.1 Создать `features/ai-operations` с context manifest client, operation client, SSE event reducer, polling fallback и active-project cancellation; покрыть controller tests.
- [x] 9.2 Перевести Context panel на server manifest с included/excluded reasons, лимитами и обязательным review token; покрыть stale context и недоступные файлы component tests.
- [x] 9.3 Перевести AI assistant на реальные provider/model capabilities, send/progress/cancel/error/reconnect состояния, сохраняя prompt при ошибке; покрыть unavailable, conflict, cancel и retry tests.
- [x] 9.4 Добавить awaiting-review представление final response и нормализованного file diff без действий записи/commit; удалить только заменённые статические AI/context данные и обновить rendered tests.

## 10. Сквозная безопасность и поставка

- [x] 10.1 Добавить end-to-end backend тест: локальный bare remote → clone → Store ID validation → repository registration → restart recovery.
- [x] 10.2 Добавить end-to-end тест с fake agent: context review → isolated execution → SSE → diff → awaiting_review, проверяя неизменность реального Store и code repository.
- [x] 10.3 Выполнить локальный smoke test с установленным Codex CLI без обращения к production credentials, используя безопасный fake/local provider path; задокументировать проверенные version/flags.
- [x] 10.4 Выполнить `npm run check`, `npm run build` и `npm run release`; устранить ошибки и подтвердить CGO-free сборки macOS, Linux и Windows.
- [x] 10.5 Выполнить `openspec validate implement-git-clone-agent-cli --strict` и сверить реализованные API/error codes с delta specs перед завершением change.
