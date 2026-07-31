## MODIFIED Requirements

### Requirement: Понятное исправление ошибок
Система SHALL показывать пользователю безопасное объяснение ошибки, correlation ID при его наличии и конкретное допустимое действие для восстановления.

#### Scenario: Git auth failed
- **WHEN** clone или push завершается `GIT_AUTH_FAILED`
- **THEN** UI предлагает проверить системный ssh-agent или credential helper без отображения credentials

#### Scenario: SSH host key failed
- **WHEN** clone завершается `SSH_HOST_KEY_FAILED`
- **THEN** UI предлагает проверить host fingerprint и пользовательский `known_hosts`, не принимая ключ автоматически
