## 1. Типизированный API transport

- [x] 1.1 Добавить общий JSON transport и типизированную `ApiError`, сохраняя status, code, message, details и correlation ID из стандартного error envelope.
- [x] 1.2 Реализовать получение и кэширование session/CSRF token, добавление заголовка к мутациям и единственный refresh/retry при `CSRF_REJECTED`.
- [x] 1.3 Добавить frontend-тесты transport для успешного JSON, server error, network error, CSRF header и ограничения повтора.

## 2. System и Projects API

- [x] 2.1 Перевести health client на общий transport и добавить типизированные клиенты session/capabilities без изменения относительных `/api/v1` URL.
- [x] 2.2 Добавить project model и клиент для list/get/create/update/delete в соответствии с существующим Go-контрактом.
- [x] 2.3 Добавить тесты system/projects clients, включая сериализацию payload и обработку `204 No Content`.

## 3. Серверное состояние проектов

- [x] 3.1 Реализовать project controller hook с состояниями loading, ready, empty, error и unavailable, отменой lifecycle-запросов и сериализацией мутаций.
- [x] 3.2 Реализовать безопасное восстановление active project ID из browser storage, fallback при устаревшем ID и обновление выбора после удаления.
- [x] 3.3 Покрыть controller тестами загрузки, пустого списка, выбора, fallback, CRUD success и сохранения подтверждённого состояния при ошибке.

## 4. Интеграция workspace UI

- [x] 4.1 Поднять project controller и загрузку capabilities в `OpenSpecWorkspace`, передать подтверждённый сервером контекст в header и не очищать локальный Markdown при сетевых ошибках.
- [x] 4.2 Заменить статический project switcher на доступное управление выбором, созданием и переименованием с loading/empty/error состояниями и блокировкой повторного submit.
- [x] 4.3 Добавить подтверждаемое удаление с явным сообщением о сохранении каталогов, безопасной ошибкой, correlation ID и retry-действием.
- [x] 4.4 Показывать реальные Store path, default provider/model и capabilities; неподдержанные редактор, Git и AI-действия явно не выдавать за серверный success.
- [x] 4.5 Добавить компонентные тесты loading, empty, unavailable, выбора проекта, CRUD forms, клавиатурного управления и подтверждения удаления.

## 5. Проверка и поставка

- [x] 5.1 Проверить локальную разработку через Vite proxy и embedded frontend build с относительными API URL.
- [x] 5.2 Выполнить `npm run check` и релевантную production-сборку, устранить найденные ошибки и подтвердить прохождение backend contract tests.
