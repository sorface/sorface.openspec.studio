## Context

Task workspace overview сейчас получает `availableBranches` только из `refs/heads`. Store Git status уже умеет читать `refs/remotes`, а manager при ручном вводе локального имени умеет создать tracking worktree от `origin/<branch>`. Требуется связать эти возможности, не добавляя сетевой операции к обычному GET.

## Goals / Non-Goals

**Goals:**

- Расширить task workspace overview additive-полем remote-веток.
- Отображать remote-only ветки отдельной группой selector.
- Передавать явный remote selection contract и безопасно создавать tracking worktree.
- Сохранить текущий ручной ввод имени новой локальной задачи.

**Non-Goals:**

- Выполнять `git fetch` при каждом чтении overview.
- Обобщать task contexts на несколько remotes.
- Менять хранение task workspaces или publication lifecycle.

## Decisions

### Возвращать canonical remote names

Backend возвращает `origin/<branch>` в новом `remoteBranches`, а `availableBranches` сохраняет прежнюю семантику локальных имён. Это additive и позволяет frontend явно отличить тип выбора. Альтернатива — смешать все имена в `availableBranches` — ломает контракт и создаёт неоднозначность.

### Передавать remote branch отдельным входным полем

Open endpoint принимает либо существующий `branch`, либо `remoteBranch`. Для remote selection manager проверяет префикс `origin/`, наличие точного ref и отсутствие конфликтующей локальной ветки, затем использует существующий managed worktree flow. Альтернатива — распознавать `origin/` внутри обычного `branch` — смешивает локальное имя workspace и имя remote ref.

### Не выполнять fetch в GET

Список строится из локально известных `refs/remotes/origin`, поэтому чтение остаётся быстрым, отменяемым и не требует сетевой аутентификации. Обновление refs остаётся явной Git-операцией. Это означает, что список отражает последний локальный fetch.

### Дедупликация на frontend по локальному имени

Selector скрывает `origin/x`, если `x` уже присутствует среди локальных веток или созданных workspace. Backend всё равно возвращает полный диагностический список, а UI показывает только полезные варианты.

## Risks / Trade-offs

- [Локально известные remote refs устарели] → при открытии ref повторно проверяется; исчезнувший ref даёт ошибку без создания ветки от `HEAD`.
- [API-клиент старой версии не знает новое поле] → поле additive, а frontend использует безопасный fallback на пустой список.
- [Remote и local selection перепутаны] → отдельный input field и отдельная ветка обработки сохраняют однозначность.

## Migration Plan

Миграция данных не требуется. После деплоя существующие task workspace responses получают новое поле; rollback безопасен, так как SQLite и существующие поля не меняются.
