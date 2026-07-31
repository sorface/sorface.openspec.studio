## 1. SSH environment policy

- [x] 1.1 Разрешить process runner принимать явно переданный `SSH_AUTH_SOCK`, не наследуя остальные `SSH_*` variables.
- [x] 1.2 Передать непустой agent socket из окружения приложения только в Git clone command.
- [x] 1.3 Покрыть allowlist и Git command environment Go-тестами.

## 2. Безопасные clone errors

- [x] 2.1 Классифицировать SSH auth и host-key stderr в `GIT_AUTH_FAILED` и `SSH_HOST_KEY_FAILED`.
- [x] 2.2 Сохранить только безопасные сообщения операции и покрыть классификацию тестами без утечки credentials.

## 3. Frontend terminal state

- [x] 3.1 Преобразовать failed clone operation в видимый `ApiError` с code, message и correlation ID.
- [x] 3.2 Сохранить введённые SSH URL/target и открывать форму повторно по retry, добавив конкретные recovery hints.
- [x] 3.3 Обновить frontend tests для failed SSH clone flow.

## 4. Проверка

- [x] 4.1 Выполнить Go tests, `npm run check`, production build и strict OpenSpec validation.
- [x] 4.2 Перезапустить backend и проверить SSH clone с доступным системным agent либо безопасный `GIT_AUTH_FAILED` при отсутствии ключа.
