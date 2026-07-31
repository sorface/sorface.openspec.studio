## Context

См. `proposal.md` — Why. Repository adapter уже принимает SSH URL и запускает Git через общий process runner. Runner строит изолированное окружение, наследуя только `PATH` и `HOME`; точное значение `SSH_AUTH_SOCK` сейчас отбрасывается. Failed operation сохраняет error fields, но repository controller не преобразует их в видимую UI-ошибку.

## Goals / Non-Goals

**Goals:**

- Сохранить неинтерактивный clone и существующую изоляцию CLI.
- Дать Git доступ только к уже настроенному системному ssh-agent.
- Различать auth и host-key failures без вывода сырого stderr.
- Сохранить terminal failure в UI до явного повторного действия.

**Non-Goals:**

- Не запускать отдельный ssh-agent и не управлять ключами.
- Не передавать `GIT_SSH_COMMAND`, `SSH_ASKPASS` или произвольные SSH variables.
- Не ослаблять host key verification.

## Decisions

### 1. Точное разрешение `SSH_AUTH_SOCK`

Общий process runner принимает `SSH_AUTH_SOCK` только когда adapter явно передал это имя в `Command.Environment`. Repository service копирует непустое значение из окружения приложения для Git clone. Runner не наследует его автоматически для AI или других CLI.

Автоматическое наследование всех `SSH_*` отклонено: оно передало бы неизвестные настройки дочерним процессам и нарушило allowlist policy.

### 2. Неинтерактивный SSH

Сохраняется `GIT_TERMINAL_PROMPT=0`. Ключ с passphrase должен быть заранее загружен в agent. `HOME` остаётся доступным для стандартных SSH config и `known_hosts`, но приложение не изменяет их.

### 3. Классификация stderr внутри adapter

Repository adapter сопоставляет известные безопасные признаки `Permission denied`, `publickey`, `Could not read from remote repository` с `GIT_AUTH_FAILED`, а host-key verification failures — с `SSH_HOST_KEY_FAILED`. В operation сохраняется только подготовленное сообщение, сырой stderr не возвращается frontend.

### 4. Terminal operation error в controller

После каждого refresh controller проверяет terminal status. Для failed он создаёт `ApiError` из `errorCode`, `errorMessage` и `correlationId`, закрывает stream/poll и оставляет ошибку видимой. Кнопка повторения повторно открывает clone form с сохранёнными значениями; reload списка остаётся отдельным действием.

## Risks / Trade-offs

- [Приложение запущено вне пользовательской shell и не имеет agent socket] → Показать `GIT_AUTH_FAILED` и инструкцию проверить `SSH_AUTH_SOCK`/`ssh-add -l`.
- [Разные реализации SSH формулируют stderr по-разному] → Покрыть распространённые OpenSSH формулировки и использовать безопасный общий fallback.
- [Старый socket указывает на недоступный файл] → Передавать его без попытки открытия приложением; Git/SSH возвращает контролируемую ошибку.

## Migration Plan

Изменения применяются без миграций. После обновления нужно перезапустить backend, чтобы он получил актуальный `SSH_AUTH_SOCK`. Rollback возвращает прежнюю allowlist policy и UI-обработку terminal status.
