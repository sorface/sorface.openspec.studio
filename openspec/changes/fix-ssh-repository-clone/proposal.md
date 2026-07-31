## Why

Клонирование SSH URL проходит валидацию, но Git-процесс не получает `SSH_AUTH_SOCK` и поэтому не видит ключи системного ssh-agent. После terminal failure UI скрывает сохранённую ошибку операции, из-за чего пользователь не понимает причину сбоя.

## Цель

Сделать клонирование Git-репозиториев по SSH работоспособным с уже настроенным системным ssh-agent и показывать безопасную, полезную диагностику при ошибке.

## What Changes

- Передавать Git-процессу только явно разрешённый `SSH_AUTH_SOCK` из окружения приложения.
- Не включать интерактивные password/passphrase prompts; SSH clone использует заранее настроенный agent и known_hosts пользователя.
- Классифицировать SSH authentication/host-key failures безопасными кодами и сообщениями.
- Показывать terminal clone error, correlation ID и действие повторного открытия формы в frontend.
- Добавить тесты environment policy, SSH clone command и terminal error state.

## Scope

- SSH URLs вида `git@host:owner/repository.git` и `ssh://git@host/owner/repository.git`.
- Использование ключей, уже доступных через системный `ssh-agent`.
- Безопасная frontend-диагностика failed clone operations.

## Вне scope

- Ввод, хранение или импорт приватных ключей и passphrase в OpenSpec Studio.
- Обход host key verification или автоматическое изменение `known_hosts`.
- Поддержка password authentication и custom `GIT_SSH_COMMAND`.
- Изменение HTTPS credential flow.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `repository-context`: SSH clone использует системный ssh-agent и возвращает различимые безопасные ошибки аутентификации.
- `local-platform`: контролируемое CLI-окружение явно разрешает только socket системного SSH agent для Git-операции.
- `workspace-experience`: terminal clone failure остаётся видимым и предлагает корректное восстановление.

## Impact

- Backend process policy и repository clone adapter.
- Frontend repository controller/panel.
- Go и frontend integration tests.
- Новые runtime-зависимости и миграции данных не требуются.

## Риски

- Недействительный или недоступный socket всё равно приводит к auth failure; UI должен предложить проверить `ssh-add -l`.
- Host key неизвестен или изменён; приложение не должно автоматически принимать ключ сервера.
- Расширение environment allowlist может ослабить изоляцию; разрешается только точное имя `SSH_AUTH_SOCK`.
