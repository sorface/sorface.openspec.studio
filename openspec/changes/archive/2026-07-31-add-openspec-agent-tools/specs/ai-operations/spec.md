## ADDED Requirements

### Requirement: Типизированная OpenSpec agent-операция
Система SHALL создавать agent-операцию с неизменяемыми идентификаторами проекта, change, schema, artifact/action и снимком OpenSpec status, на основании которых вычисляются prompt и разрешённая область результата.

#### Scenario: Запуск подготовки design
- **WHEN** пользователь подтверждает доступное действие подготовки `design`
- **THEN** операция сохраняет выбранный change, artifact `design`, status fingerprint, provider, model и подтверждённый manifest до запуска agent CLI

#### Scenario: Несоответствие action и prompt
- **WHEN** запрос пытается передать artifact, change или область записи, отличающиеся от подтверждённого OpenSpec action
- **THEN** backend отклоняет операцию с `AI_SCOPE_VIOLATION` до запуска provider

### Requirement: Структурированный OpenSpec prompt
Система SHALL формировать prompt на backend из пользовательской цели, авторитетной OpenSpec instruction, context, rules, template, завершённых dependency artifacts и подтверждённого project context, сохраняя системные ограничения приоритетнее недоверенного содержимого Store.

#### Scenario: Формирование prompt
- **WHEN** все входы действия проверены и provider доступен
- **THEN** agent получает однозначную задачу, конкретный output path, содержимое завершённых зависимостей и запрет изменять файлы вне вычисленного action scope

#### Scenario: Инструкция Store пытается расширить доступ
- **WHEN** OpenSpec context, artifact либо подключённый репозиторий содержит требование выполнить произвольную команду или изменить путь вне Store/action scope
- **THEN** система рассматривает это как недоверенный текстовый контекст и не расширяет executable allowlist, writable roots или полномочия операции

### Requirement: Аудит результата OpenSpec action
Система MUST сравнивать operation workspace со снимком, разрешать только ожидаемые мутации выбранного OpenSpec action и отклонять результат целиком при выходе за область.

#### Scenario: Допустимый результат артефакта
- **WHEN** agent изменил только файлы, соответствующие output paths выбранного artifact и разрешённым schema инструкциям
- **THEN** система формирует нормализованный diff и переводит операцию в `awaiting_review`

#### Scenario: Изменён несвязанный change
- **WHEN** agent изменил файл другого change, baseline spec вне разрешённого archive action или подключённый кодовый репозиторий
- **THEN** операция завершается с `AI_SCOPE_VIOLATION`, показывает затронутые пути и не создаёт принимаемых drafts

#### Scenario: Результат не удовлетворяет OpenSpec
- **WHEN** post-operation status либо validate показывает отсутствующий обязательный output или структурную ошибку
- **THEN** система сохраняет diagnostics, не считает action выполненным и позволяет пользователю отклонить результат либо запустить отдельное исправление

### Requirement: Последовательность OpenSpec agent-действий
Система MUST разрешать не более одной изменяющей OpenSpec/AI-операции проекта одновременно и SHALL вычислять следующее действие только после review результата и повторного получения status.

#### Scenario: Параллельный запуск
- **WHEN** для проекта уже выполняется создание, продолжение, исправление или архивирование change
- **THEN** второй изменяющий запрос получает `AI_OPERATION_CONFLICT` без запуска нового provider или OpenSpec процесса

#### Scenario: Результат отклонён
- **WHEN** пользователь отклоняет agent diff
- **THEN** активный Store и его OpenSpec status остаются неизменными, а UI возвращается к действиям исходного status
