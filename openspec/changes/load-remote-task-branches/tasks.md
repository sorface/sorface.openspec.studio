## 1. Backend contract

- [x] 1.1 Расширить task workspace overview remote-ветками `origin`, исключить `origin/HEAD`, сохранить сортировку и покрыть service-тестами.
- [x] 1.2 Добавить явный remote branch input в open flow, безопасное создание tracking worktree и regression-тесты исчезнувшего ref.
- [x] 1.3 Обновить HTTP contract и API-тесты additive-поля и remote selection.

## 2. Frontend selector

- [x] 2.1 Расширить TypeScript model/API input remote-ветками и покрыть transport contract.
- [x] 2.2 Добавить в selector отдельную группу remote-only веток, дедупликацию и выбор tracking task workspace; обновить UI-тесты.
- [x] 2.3 Добавить кнопке получения изменений видимую подпись «Получить обновления» и проверить header в browser.
- [x] 2.4 Добавить кнопке публикации видимую подпись «Публикация изменений» и проверить адаптивный header в browser.

## 3. Verification

- [x] 3.1 Выполнить backend/frontend тесты, typecheck, strict OpenSpec validation и production build.
- [x] 3.2 Перезапустить локальное приложение и визуально проверить отображение и открытие remote-ветки в browser.
