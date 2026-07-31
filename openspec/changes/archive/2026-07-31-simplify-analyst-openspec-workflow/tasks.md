## 1. Read-only explore operation

- [x] 1.1 Расширить OpenSpec action model kind `explore`, разрешить запуск без change и сформировать безопасный read-only prompt с исходным описанием задачи.
- [x] 1.2 Завершать explore результатом исследования без draft/write, отклонять изменения snapshot и покрыть service/HTTP contract тестами success, provider unavailable и read-only violation.

## 2. Frontend workflow controller

- [x] 2.1 Добавить типизированный запуск explore и восстановление его результата в OpenSpec client/controller с frontend contract/state тестами.
- [x] 2.2 Добавить явное состояние validate `idle/checking/valid/invalid/error`, сброс при смене change/записи и автоматическое обновление после Store change.
- [x] 2.3 После записи созданного change обновлять overview, выбирать новый change и сохранять handoff исходной задачи и explore result в create action.

## 3. Понятный интерфейс аналитика

- [x] 3.1 Заменить техническую inline-форму основной кнопкой «Добавить изменение» и доступным modal wizard описания, explore, review результата и выбора имени.
- [x] 3.2 Показать следующий рекомендуемый шаг для proposal/specs и действие «Обновить спецификацию» после ручной правки proposal.
- [x] 3.3 Добавить постоянный видимый validate badge/details и понятные loading/error/retry состояния.
- [x] 3.4 Покрыть modal, этапы, доступные имена, рекомендуемые действия и validate status rendered/controller тестами.

## 4. Проверка

- [x] 4.1 Выполнить Go tests, `npm run check`, production build и строгую OpenSpec-валидацию change.
- [x] 4.2 Проверить в локальном browser открытие wizard, переход explore → имя → создание и видимость validate без автоматической записи Store.

## 5. Контекстное редактирование через agent

- [x] 5.1 Добавить доступное действие agent в Crepe toolbar выделения и модальное окно инструкции с активным файлом и выбранным текстом.
- [x] 5.2 Сопоставлять активный Markdown-файл с фактическим artifact action и запускать scoped `fix_artifact` с актуальным fingerprint и переходом к review.
- [x] 5.3 Покрыть toolbar/dialog/controller contract тестами, выполнить полный check и проверить сценарий в локальном browser без записи Store.

## 6. Наблюдаемое выполнение explore

- [x] 6.1 Передавать throttled provider activity через OpenSpec SSE и сохранять управляемое завершение explore через cancellation.
- [x] 6.2 Показывать в wizard текущий этап, прошедшее время и ошибку операции с возможностью повтора.
- [x] 6.3 Покрыть backend/frontend regression-тестами, выполнить полный check и проверить сценарий в локальном browser без изменения Store.

## 7. Realtime-этапы бессрочного explore

- [x] 7.1 Нормализовать события provider в безопасные пользовательские этапы и запускать explore без timeout, сохраняя явную отмену и timeout остальных actions.
- [x] 7.2 Показывать в wizard realtime-ленту этапов, прошедшее время и пояснение об отсутствии лимита и скрытого содержимого.
- [x] 7.3 Покрыть изменения backend/frontend regression-тестами, выполнить полный check и проверить сценарий в локальном browser без изменения Store.

## 8. Быстрое добавление изменения из дерева

- [x] 8.1 Добавить рядом с разделом «Изменения» доступную icon-button, которая открывает существующий мастер нового изменения независимо от раскрытия раздела.
- [x] 8.2 Покрыть переход regression-тестом, выполнить frontend-check и проверить открытие мастера в локальном browser.
