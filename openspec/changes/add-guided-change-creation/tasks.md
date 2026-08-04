## 1. Draft-сессия создания change

- [x] 1.1 Добавить версионированную модель draft-сессии, SQLite migration/storage CRUD и тесты восстановления, замены, каскадного удаления и лимитов payload.
- [x] 1.2 Добавить project-scoped GET/PUT/DELETE HTTP API draft-сессии с валидацией stages, вопросов, ответов и безопасными contract-тестами.

## 2. Структурированные AI-уточнения

- [x] 2.1 Расширить OpenSpec explore prompt/result строгим контрактом `needs_input | proposal_ready`, безопасным parser и unit-тестами JSON, code fence, лимитов и некорректного ответа.
- [x] 2.2 Передавать в повторный explore bounded Markdown intent, summary, вопросы, ответы, допущения и feedback, сохранив read-only audit, cancellation и frontend/backend contract tests.

## 3. Proposal-only создание change

- [x] 3.1 Расширить `create_change` принятым proposal, убрать обязательный повторный provider-вызов и безопасно записывать только proposal в изолированный change по пути OpenSpec instructions.
- [x] 3.2 Покрыть proposal-only create тестами валидного diff, traversal/scope, невалидного имени, отсутствующего proposal, accept/draft/write и отсутствия автоматически созданных delta specs.

## 4. Frontend state и API

- [x] 4.1 Добавить типы/client/controller draft-сессии, autosave, восстановление, reset и обработку структурированного результата AI с тестами state transitions.
- [x] 4.2 Реализовать invalidation AI-результата при изменении intent, ответы разных типов, продолжение с допущениями, feedback proposal и выбор/валидацию предложенного имени.

## 5. Guided Change Creation Wizard

- [x] 5.1 Вынести мастер в почти полноэкранный `ChangeCreationWizard` с этапами «Замысел → Уточнение → Proposal → Название», общим Markdown editor, progress/activity и доступными controls.
- [x] 5.2 Реализовать карточки вопросов, summary/assumptions, proposal preview/iteration, AI name suggestions, восстановление draft, адаптивную раскладку и rendered/accessibility тесты.
- [x] 5.3 Переключить создание на proposal-only review/write, после успеха удалить draft, открыть `proposal.md` в Documents workspace и переименовать действие specs в «Сформировать/обновить specs изменения».
- [x] 5.4 Перенести `ChangeCreationWizard` из modal/backdrop в отдельную полноразмерную страницу OpenSpec workspace, сохранить возврат и draft, обновить accessibility/rendered tests.
- [x] 5.5 Добавить в панель документов change компактный следующий шаг к формированию/обновлению specs, сохранение текущих правок перед переходом, выбор того же change и необязательную цель рекомендуемого agent-действия.
- [x] 5.6 Перенести формирование/обновление specs в toolbar открытого `proposal.md`, запускать действие с актуальным fingerprint без смены workspace и показывать progress/review/write рядом с документом.
- [x] 5.7 Сделать specs-действие в toolbar контрастным и читаемым в enabled и disabled-состояниях, сохранив явную причину недоступности.
- [x] 5.8 Переместить компактное действие публикации непосредственно вправо от селектора текущей задачи и оформить их как единую адаптивную группу topbar.
- [x] 5.9 Добавить в toolbar открытого proposal последовательные действия подготовки design и tasks по фактическому OpenSpec status, сохранив обновление specs, save-before-run, review diff и тесты.
- [x] 5.10 Убрать геометрическое смещение artifact-кнопок при hover, сохранив визуальную обратную связь и добавив regression-проверку.
- [x] 5.11 Сделать панель выбранного change постоянной, восстанавливать её по открытому артефакту, убрать close-control для change и обновить тесты навигации.
- [x] 5.12 Добавить в toolbar открытого design контекстное создание/обновление tasks.md с save-before-run, review diff и тестами status-переходов.
- [x] 5.13 После записи agent draft синхронно обновлять Documents и Task Context, чтобы новые файлы сразу отражались как Git-изменения; добавить regression-тест.
- [x] 5.14 Ограничить artifact-действия контекстом документа: из proposal создавать/обновлять только design после готовности specs, а tasks создавать/обновлять только из design; сохранить постоянную панель change и обновить тесты.
- [x] 5.15 Добавить в toolbar proposal после готовности specs вторичное действие «Перегенерировать diff specs» рядом с основным design-действием, сохранив review-before-write и отсутствие tasks; обновить тесты.
- [x] 5.16 Заменить перекрывающий документ review на сворачиваемую правую панель операций выбранного change: добавить bounded project/change-scoped историю, выбор операции и просмотр результата; обновить backend и rendered tests.
- [x] 5.17 Перенести полный operation review из узкой боковой панели в широкий modal dialog с Markdown editors «До / После», открыть его из истории и автоматически при `awaiting_review`, оставить reject/accept/write внутри диалога и обновить тесты.
- [x] 5.18 Выделять baseline master specs зелёным в дереве и открывать их пользователю только в Preview без изменения и записи, сохранив agent/backend workflow; обновить regression-тесты.
- [x] 5.19 Использовать единственное число «Изменение» в заголовке панели файлов конкретного change, сохранив «Изменения» для общего раздела навигации.
- [x] 5.20 При сворачивании основной левой навигации сохранять панель файлов открытого change и её отдельную grid-колонку; обновить адаптивные стили и regression-тесты.
- [x] 5.21 Открывать delta/diff specs пользователю только в Preview без изменения, Split, inline agent-edit и записи, сохранив agent/backend workflow и добавив regression-тесты.
- [x] 5.22 Добавить рядом с публикацией получение remote-изменений активной task-ветки через fast-forward, после успеха обновлять выбранный документ, дерево файлов и task-context, сохраняя локальные правки; добавить backend/frontend regression-тесты.
- [x] 5.23 Исправить подготовку tasks.md при glob-зависимости `specs/**/*.md`: безопасно раскрывать файлы внутри change, передавать specs и design agent и покрыть regression-тестом успешного формирования prompt.
- [x] 5.24 Стилизовать действия широкого operation review как согласованные secondary-danger и primary кнопки с hover/focus/disabled-состояниями без смещения; добавить rendered regression-тест.
- [x] 5.25 Не отображать в header открытого master spec кнопки режимов, истории, дополнительных действий и записи, сохранив read-only метку и прежнее поведение delta specs; добавить regression-тест.
- [x] 5.26 Показывать в toolbar открытого tasks.md реактивный счётчик выполненных Markdown-задач `completed/total`, не учитывая обычные списки; добавить unit и rendered regression-тесты.
- [x] 5.27 Добавить полноэкранный просмотр итогового Markdown каждой review-мутации, несколько редактируемых замечаний, повтор того же artifact-этапа с bounded feedback и принятие текущей итерации.

## 6. Проверки и документация результата

- [x] 6.1 Обновить API integration/rendered tests полного workflow и выполнить `gofmt`, `go test ./...`, `npm run check` и релевантную production build.
- [x] 6.2 Пройти локальный browser flow для каждого этапа, проверить восстановление/ошибки и сохранить отдельные screenshots замысла, уточнений, proposal, имени и созданного workspace.
- [x] 6.3 Проверить открытие и возврат отдельной страницы мастера в browser, отсутствие backdrop/overflow и сохранить актуальный screenshot.
- [x] 6.4 Проверить в browser переход от открытого proposal к выбранному change, доступность подготовки specs без обязательной цели и отображение обещания review diff; сохранить screenshot.
- [x] 6.5 Обновить integration/rendered tests, выполнить frontend checks и проверить в browser контраст toolbar-действия и inline review без навигации.
- [x] 6.6 Обновить тесты topbar, выполнить frontend checks и проверить в browser порядок «селектор задачи → публикация» на рабочем viewport.
- [x] 6.7 Добавить rendered/controller regression-тесты feedback loop, выполнить frontend проверки и пройти полноэкранный review в browser без записи тестового результата в Store.
