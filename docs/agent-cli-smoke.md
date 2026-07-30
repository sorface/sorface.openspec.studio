# Agent CLI smoke-проверка

Проверка не использует production credentials и не отправляет запросы внешней
модели. Сквозной запуск выполняется backend-тестом с локальным fake executable:

```bash
go test ./backend/internal/ai -run TestFakeAgentEndToEnd -v
```

Тест подтверждает поток context review → изолированный workspace → JSONL output
→ diff → `awaiting_review` и проверяет, что реальный Store не изменился.

Локально проверенная версия Codex CLI: `codex-cli 0.137.0`. Поддерживаемый
неинтерактивный вызов:

```text
codex exec --json --ephemeral --sandbox workspace-write
  --skip-git-repo-check --cd <isolated-working-dir> [--model <model>] -
```

Prompt передаётся только через stdin. OpenSpec Studio не использует
`--dangerously-bypass-approvals-and-sandbox`, `--add-dir`, произвольные `-c` или
production credential fixtures.

GigaCode проверяется через `gigacode --help`. Adapter разрешает запуск только
если CLI одновременно объявляет `--non-interactive`, `--json` и `--cwd`;
иначе возвращается `AI_PROVIDER_UNSUPPORTED`. Этот контракт покрывается fake CLI
fixture без секретов.
