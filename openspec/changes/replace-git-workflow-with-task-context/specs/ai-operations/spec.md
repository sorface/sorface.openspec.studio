## ADDED Requirements

### Requirement: Read-only генерация commit message
Система SHALL запускать генерацию commit message только по явному запросу пользователя как ограниченную read-only agent-операцию, привязанную к project, task workspace, HEAD и diff fingerprint, и MUST NOT предоставлять provider writable workspace или произвольный файловый контекст.

#### Scenario: Корректная генерация
- **WHEN** пользователь запрашивает генерацию для непустого разрешённого diff и проект имеет доступный provider
- **THEN** agent получает только задачу, paths, bounded diff и правила результата и возвращает русский subject `<branch>: <короткое сообщение>` и body как маркированный список изменений

#### Scenario: Попытка provider изменить файлы
- **WHEN** provider либо его adapter пытается изменить Store или подключённый репозиторий
- **THEN** audit отклоняет результат, сохраняет исходные файлы и оставляет доступным пользовательский текст публикации

#### Scenario: Переключение текущей задачи
- **WHEN** пользователь переключает task selector во время генерации
- **THEN** операция продолжает использовать сохранённые task workspace, HEAD и fingerprint исходной задачи

### Requirement: Минимизация agent-контекста публикации
Система MUST исключать из commit-message prompt секретные, бинарные, несвязанные и превышающие лимит данные и MUST NOT сохранять полный diff в operation events либо диагностическом журнале.

#### Scenario: Запрещённый путь
- **WHEN** изменённый путь не относится к разрешённым OpenSpec-артефактам
- **THEN** файл отсутствует в prompt и fingerprint публикации, а причина исключения доступна в локальном preview

#### Scenario: Аудит генерации
- **WHEN** agent завершает генерацию
- **THEN** audit содержит provider, task, fingerprint, размеры ввода/вывода, duration и result code без полного содержимого diff
