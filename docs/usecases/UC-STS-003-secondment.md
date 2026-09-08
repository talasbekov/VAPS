# UC-STS-003. Прикомандировать сотрудника и подтвердить возврат

| Поле | Значение |
|---|---|
| Модуль | Статусы и дежурства |
| Актор | Держатель `status.manage` (`DIRECTORATE_HEAD`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `INTEGRATION_USER`) — маршруты раздела; любой вошедший, привязанный к сотруднику со штатной единицей, — кадровые запросы; `ADMIN` |
| Статус | Done |
| Основание | `apps/operations/secondment_service.py` (`initiate_secondment`, `request_return`, `confirm_return`, `DETACHED_CODE`, `ATTACHED_CODE`), `apps/operations/models_status.py` (`Secondment`, `SecondmentState`, `derive_secondment_state`), `apps/operations/api/views.py` (`SecondmentViewSet`: `create`, `request-return`, `confirm-return`), `apps/operations/api/serializers.py` (`SecondmentCreateSerializer`, `SecondmentReturnConfirmSerializer`), `apps/secondments/models.py` (`SecondmentRequest`, `ApprovalStatus`), `apps/secondments/api/views.py` (`SecondmentRequestViewSet`: `approve`, `reject`, `return_employee`, `incoming`, `outgoing`), `apps/statuses/application/services.py` (`create_status`, `terminate_status_early`), FRONT `features/employee-status-update/ui/SecondEmployeeDialog.tsx`, `model/secondment-schema.ts`, `features/secondment-requests/{ui/SecondmentRequestsDialog.tsx,api/secondment-requests-api.ts}`, `hooks/use-divisions-tree.ts`, `components/status-table.tsx` |
| Дата актуализации | 2026-09-08 |

## Цель
Актор направляет сотрудника своего подразделения в другое подразделение на период, принимающая сторона одобряет или отклоняет запрос, а по окончании возврат подтверждается и сотрудник снова считается в своём подразделении.

## Предусловия
- Актор вошёл в систему; для кадрового запроса его учётная запись привязана к сотруднику со штатной единицей (иначе решение по запросу — 403 «Пользователь не привязан к сотруднику»); для маршрутов раздела — `status.manage` с областью на подразделения обеих сторон.
- Сотрудник имеет штатную единицу (для раздела: иначе 400 «У сотрудника нет штатной единицы»).
- Дерево подразделений доступно (`GET /api/divisions/divisions_tree/`).

## Main Flow
1. Актор на `/statuses` в меню сотрудника выбирает «Прикомандировать» — открывается диалог с датами начала и окончания, подразделением (дерево `Division` плоским списком «Родитель → Дочернее», только активные) и причиной.
2. Актор сохраняет — система выполняет `POST /api/secondments/secondment-requests/` (`employee`, `to_division`, `start_date`, `end_date`, `reason`); запрос создаётся со статусом `pending`, `requested_by` = актор; тост подтверждает отправку.
3. Руководитель принимающего подразделения открывает на `/statuses` «Входящие запросы на прикомандирование» — система показывает `GET /api/secondments/secondment-requests/incoming/` (запросы в подразделение актора со статусом `pending`).
4. Руководитель нажимает «Одобрить» — система (`approve`) проверяет, что `to_division` в его области, ставит `approved`, `approved_by`, `approved_at` и создаёт сотруднику кадровый статус `seconded_to` («Откомандирован в») на период через `StatusApplicationService.create_status` с `related_division = to_division`.
5. Либо руководитель нажимает «Отклонить» — статус `rejected` (`rejection_reason` — из тела запроса).
6. По окончании принимающая сторона возвращает сотрудника: `POST /api/secondments/secondment-requests/{id}/return_employee/` — система находит активный статус `seconded_to` и завершает его досрочно (`terminate_status_early`); ответ «сотрудник возвращен».
7. Оператор раздела ОМ ведёт прикомандирование моделью раздела: `POST /api/operations/secondments/` (`employee_id`, `to_division_id`, `date_start`, `date_end`, `document_basis`) — система создаёт `Secondment` и две «ноги» `OpsEmployeeStatus`: `DETACHED` в исходном подразделении и `ATTACHED` в принимающем; состояние `INITIATED`.
8. Отправляющая сторона запрашивает возврат: `POST /api/operations/secondments/{id}/request-return/` → `RETURN_REQUESTED`; принимающая подтверждает: `POST …/confirm-return/` (`reason` необязателен) → `RETURNED`, обе ноги закрываются завтрашним днём (`_end_leg_tomorrow`).

## Alternative Flow
- **AF1. Валидация формы**: «Укажите дату начала.», «Укажите дату окончания.», «Выберите подразделение.», «Укажите причину откомандирования.», «Дата окончания раньше даты начала.»; ошибки сервера по полям раскладываются через `SECONDMENT_API_FIELDS`, остальные — в `root`.
- **AF2. Актор не привязан к сотруднику**: шаги 4–6 → 403 `{"detail": "Пользователь не привязан к сотруднику."}`.
- **AF3. Запрос адресован не в подразделение актора**: шаги 4–6 → 403 «Решение вне вашего подразделения запрещено.»
- **AF4. Повторное одобрение**: шаг 4 → 409 «Запрос уже одобрен.»; запрос без сотрудника или подразделения — 400.
- **AF5. Кадровый статус на период не создаётся (пересечение, `EmployeeStatus.clean`)**: шаг 4 → 400 с текстом `DjangoValidationError`, запрос остаётся `pending`.
- **AF6. Нет активного `seconded_to` при возврате**: шаг 6 → 400 (сообщение из вьюсета).
- **AF7. Раздел: то же подразделение / принимающее не найдено / нет штатной единицы**: шаг 7 → 400 `VALIDATION_ERROR` «Нельзя откомандировать в то же подразделение.», 404 `ENTITY_NOT_FOUND` «Принимающее подразделение не найдено.», 400 «У сотрудника нет штатной единицы…».
- **AF8. Раздел: недопустимый переход**: 422 `INVALID_LIFECYCLE_TRANSITION` «Возврат уже запрошен или подтверждён.», «Нельзя подтвердить возврат без запроса.», «Возврат уже подтверждён.»
- **AF9. Раздел: подразделение вне области `status.manage`**: 403 (`_assert_division_in_scope`, по полю `from`/`to`).
- **AF10. Раздел: конфликт ног с существующими статусами**: правила UC-STS-001 (422 hard / 409 soft) при создании ног.
- **AF11. Дерево подразделений не загрузилось**: диалог показывает ошибку `divisionsError`, список пуст.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `secondment_requests` (`SecondmentRequest`) | create / update | `employee`, `to_division`, `start_date`, `end_date`, `reason`, `status` (`pending`→`approved`/`rejected`), `requested_by`, `approved_by`, `approved_at`, `rejection_reason`; `from_division` при создании не заполняется |
| `employee_statuses` (`statuses.EmployeeStatus`) | create / update | При одобрении — `seconded_to` с `related_division`; предыдущий активный закрывается; при возврате — `actual_end_date`, `COMPLETED`, `early_termination_reason` |
| `employee_status_change_history` | create | Через сигнал и сервис |
| `ops_secondments` (`Secondment`) | create / update | `employee_id`, `from_division_id`, `to_division_id`, `out_status`, `in_status`, `document_basis`, `return_requested_at/by`, `return_confirmed_at/by`; ограничения `chk_secondment_divisions_differ`, `chk_secondment_legs_differ`, `chk_secondment_confirm_after_request` |
| `ops_employee_statuses` (`OpsEmployeeStatus`) | create / update | Две ноги `DETACHED`/`ATTACHED` (`source=USER`), закрытие завтрашним днём при подтверждении |
| `OpsAuditLog` | create | `SECONDMENT_INITIATED`, `SECONDMENT_RETURN_REQUESTED`, `SECONDMENT_RETURNED`, `STATUS_CREATED` (по ноге), `STATUS_COMPLETED` (закрытие ног) |
| `audit.AuditLog` | create | `AuditMiddleware`: `POST /api/secondments/secondment-requests/` → `ContentType` `secondments.secondment-request` не разрешается → записи нет |

## Бизнес-требования (BR)
- **BR1.** Кадровый запрос создаёт любой вошедший; решение (одобрить/отклонить/вернуть) — только принимающая сторона: `to_division` должен входить в область актора (подразделение его штатной единицы с потомками), суперпользователь — без ограничения.
- **BR2.** Одобрение создаёт кадровый статус «Откомандирован в» на весь период запроса; повторное одобрение запрещено (409) — иначе второй статус на тот же период.
- **BR3.** Возврат завершает активный статус `seconded_to` досрочно текущей датой; при отсутствии такого статуса возврат отклоняется.
- **BR4.** В разделе прикомандирование — две симметричные ноги статусов: `DETACHED` (`restricts_editing`, запрещает правку статусов сотруднику, UC-STS-001 AF3) и `ATTACHED` (`counts_in_staff=False`, не считается в штат принимающего).
- **BR5.** Стадия раздела выводится из фактов (`derive_secondment_state`): `INITIATED` → `RETURN_REQUESTED` → `RETURNED`; подтверждение не раньше запроса (ограничение БД).
- **BR6.** Подразделения сторон различны; принимающее должно существовать; исходное берётся из штатной единицы сотрудника.
- **BR7.** Дата окончания не раньше даты начала (клиент); причина откомандирования обязательна (клиент).
- **BR8.** Списки раздела (`GET /api/operations/secondments/`) видны по `status.view` только по сторонам, входящим в область актора (`_visible_sides_filter`).

## Требования к логированию
- Раздел: `OpsAuditLog` через `audit_service.record` — `SECONDMENT_INITIATED`, `SECONDMENT_RETURN_REQUESTED`, `SECONDMENT_RETURNED` со снимками `secondment_snapshot` до/после; по ногам — `STATUS_CREATED`/`STATUS_COMPLETED`.
- Кадровый путь: `StatusChangeHistory` по создаваемому/завершаемому статусу; журнал самих запросов (`SecondmentRequest` создан/одобрен/отклонён/возвращён) — `Не реализовано в коде` (`AuditMiddleware` `ContentType` не разрешает, `audit_service` не зовётся).
- Консоль: `logging.getLogger` в `apps/statuses/application/services.py` (создание/завершение статуса); в `apps/secondments` логгера нет.
- Уведомление принимающей стороны о новом запросе (`notify_service`, `Notification`): `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*`; суперпользователь минует `_receiving_side_forbidden` |
| Любой вошедший (все роли) | создать кадровый запрос; читать свои запросы (`incoming`, `outgoing`, список по сторонам своего подразделения) | `IsAuthenticated` во всех ветках `get_permissions`; `get_queryset` фильтрует по подразделению штатной единицы актора |
| Любой вошедший, чья штатная единица — в принимающем подразделении (с потомками) | одобрить / отклонить / вернуть | `_receiving_side_forbidden` (сравнение области, не право раздела) |
| `DIRECTORATE_HEAD`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `INTEGRATION_USER` | раздел: `create`, `request-return`, `confirm-return` в области | `permission_map` → `status.manage`; `_assert_division_in_scope` |
| Держатели `status.view` (см. UC-STS-002) | раздел: `list`, `retrieve` | `permission_map` → `status.view`; `_visible_sides_filter` |
| Остальные роли без `status.view`/`status.manage` | нет к `/api/operations/secondments/` | 403 |

## Требования к UX/UI
- Диалог «Прикомандировать сотрудника» (`SecondEmployeeDialog`, из меню строки на `/statuses`): два `Calendar` (начало, окончание), `Select` подразделения (иерархический путь «Департамент → Управление», неактивные скрыты, их дети подняты), `Textarea` причины, кнопки «Отправить»/«Отмена»; ошибки под полями, `root`-ошибка; тост об успехе.
- Диалог «Входящие запросы на прикомандирование» (`SecondmentRequestsDialog`, кнопка на `/statuses`): список `pending`-запросов (сотрудник, откуда/куда, период, причина), кнопки «Одобрить» и «Отклонить» (заблокированы во время мутации), пустое состояние.
- Исходящие запросы, возврат сотрудника (`return_employee`), причина отклонения: `Нет пользовательского интерфейса` (`outgoing` и `return_employee` фронтом не вызываются; «Отклонить» шлёт пустое тело).
- Маршруты раздела `/api/operations/secondments/` (создание, запрос и подтверждение возврата): `Нет пользовательского интерфейса`.

## Открытые вопросы
- Два независимых механизма: кадровые запросы `SecondmentRequest` (UI) и `Secondment` раздела с ногами `DETACHED`/`ATTACHED` (только API); одобрение кадрового запроса ноги раздела не создаёт, поэтому запрет правки откомандированного (`restricts_editing`) и календарь раздела (UC-STS-002) о таком прикомандировании не знают.
- `SecondmentRequest.from_division` при создании не заполняется (`perform_create` отсутствует, диалог поле не шлёт); фильтр `outgoing`/`get_queryset` по `from_division_id` для таких запросов не срабатывает — отправляющая сторона своих запросов не видит.
- Право на создание кадрового запроса — только `IsAuthenticated`: сотрудник может «прикомандировать» любого, включая чужих; область проверяется лишь на стороне решения.
- Возврат по кадровому запросу (`return_employee`) и просмотр исходящих в UI не выведены; статус `seconded_to` завершается только вручную через «Запланированные статусы» или API.
- Статус `seconded_from` («Прикомандирован из») принимающей стороне при одобрении не ставится (комментарий в `approve` объясняет это запретом пересечений в `EmployeeStatus.clean`).
- `reject` не читает причину из формы (UI шлёт пустое тело), `rejection_reason` остаётся пустым.
- `AuditMiddleware` не пишет ни одну операцию `/api/secondments/` — журнала решений по запросам нет.
