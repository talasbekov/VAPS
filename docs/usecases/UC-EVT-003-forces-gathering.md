# UC-EVT-003. Собрать силы на мероприятие

| Поле | Значение |
|---|---|
| Модуль | Охранные мероприятия |
| Актор | OPS_STAFF (штаб, `forces.command`); FORCES_GATHERING_OFFICER / DEPARTMENT_EXPENSE_OFFICER (ответственный департамента, `forces.allocate`); DIRECTORATE_HEAD / HEAD_DIRECTORATE_LINE / HEAD_DEPARTMENT_LINE / HEAD_OPS_UNIT (начальник управления, `status.manage`); ADMIN |
| Статус | Partial |
| Основание | `apps/ops/forces_send.py` (`split_and_send`, `submit_allocation`, `withdraw_allocation`, `return_allocation`), `apps/ops/security_events.py` (`split_force_demand`, `split_directorate_quotas`, `notify_directorates`, `respond_allocation`, `add_allocation_member`, `remove_allocation_member`, `accept_allocation`, `force_collections_view`, `force_collection_detail`, `department_requests_view`), `apps/ops/force_collection_board.py` (`top_up`, `board_row`, `collection_status`), `apps/ops/force_collection.py` (`assign_roster_objects`, `hand_over_to_placement`), `apps/ops/forces_requests.py` (`directorate_requests_view`, `select_for_request`), `apps/ops/forces_notify.py`, `apps/ops/forces_ledger.py`, `apps/operations/models_forces.py`, `apps/operations/signals.py::project_forces_ledger`, `SecurityEventViewSet` actions `forces_*` / `force_allocation` (`apps/ops/api/views.py`), FRONT `app/employees/page.tsx` (`?view=forces`), `features/force-collections`, `features/department-requests`, `features/forces-request-banner`, `hooks/use-force-collections.ts`, `hooks/use-department-requests.ts`, `hooks/use-forces-request-banner.ts`, `hooks/use-forces-gathering.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Штаб получает на мероприятие людей от департаментов и управлений в количестве, посчитанном рекогносцировкой, и передаёт собранный состав на расстановку по объектам.

## Предусловия
- ОМ существует, рекогносцировка завершена: `force_demand_total(event) > 0` (иначе мероприятие в списке сборов штаба не показывается).
- Стадия ОМ — `DEMAND`, `FORCES` или `PLACEMENT` (`_ALLOCATION_STAGES`); на других стадиях все действия цепочки отвечают 422 `INVALID_STAGE_TRANSITION`.
- В справочнике `Division` есть активные департаменты и их управления (`division_type=DIRECTORATE`).
- У акторов назначены роли с областью (`UserRole.scope_division_id`) или активные дежурства (`TemporaryDutyPermission`): ответственный — на департамент, начальник управления — на управление.
- Справочник статусов содержит тип `IN_EVENT` («Участие в ОМ», `ASSIGNMENT_STATUS_CODE`).

## Main Flow
1. Штаб открывает `/employees?view=forces`, вкладку «Сборы», выбирает мероприятие и в карточке сбора раскладывает потребность по департаментам (департамент, число, срок сдачи списка); «Сохранить черновик» или «Отправить запросы».
2. Система по «Отправить запросы» ставит строкам момент `sentAt`, уведомляет ответственных департаментов (`FORCES_REQUEST_SENT`) и пишет аудит `FORCE_ALLOCATION_SPLIT`.
3. Ответственный департамента открывает вкладку «Заявки», карточку заявки, отвечает «Выделяем: X · Комментарий»; система уведомляет штаб (`FORCES_RESPONSE`).
4. Ответственный раскладывает цифру «Выделяем» по управлениям департамента и нажимает «Отправить в управления»; система ставит строкам управлений `notifiedAt`, статус заявки `NOTIFIED`, уведомляет начальников управлений (`FORCES_REQUEST`) и сводкой начальника департамента (`FORCES_REQUEST_DEPARTMENT`), пишет аудит `FORCE_ALLOCATION_NOTIFIED`.
5. Начальник управления открывает «Статусы сотрудников» (`/statuses`), видит баннер «Запросы на сбор сил», отмечает сотрудников чекбоксами и нажимает «Выделить на <код ОМ>».
6. Система на каждого отмеченного создаёт статус «Участие в ОМ» (`IN_EVENT`) с датами мероприятия и участием (`participations`), дописывает человека в `members` строки заявки; отказы по отдельным людям возвращает списком `refused[]`.
7. Ответственный департамента нажимает «Отправить список в штаб»; система переводит заявку в `SUBMITTED`, фиксирует `submittedAt`/`submittedLate`, добавляет людей в состав мероприятия (`force_roster`), пишет аудит `FORCE_ALLOCATION_SUBMITTED`.
8. Штаб в карточке сбора принимает список («Принят», `ACCEPTED`, аудит `FORCE_ALLOCATION_ACCEPTED`) либо возвращает с причиной («Возвращён», `RETURNED`, аудит `FORCE_ALLOCATION_RETURNED`); при недоборе штаб нажимает «Довыделить недобор» — новая строка запроса тому же департаменту, сразу отправленная.
9. Штаб в блоке «Собранные сотрудники → объекты» отмечает людей и нажимает «Отдать объекту»; система записывает `visitObjectId` в строку состава.
10. Штаб нажимает «Передать на расстановку»; при недоборе по объекту — подтверждение с обязательным комментарием; система пишет `force_handover` (момент, актор, комментарий, недобор по объектам), статус доски становится «Распределено».

## Alternative Flow
- **AF1. Строка раскладки некорректна (шаг 1)**: пустой департамент, число < 1, нецелое, неверный `dueAt`, департамент не из справочника или указан дважды → 422 с ошибками по полям `rows.<i>.*` (`split_force_demand`).
- **AF2. Правка отправленной строки (шаг 1)**: цифра отправленной строки изменена → 422 по полю `rows.<i>.need` «Запрос уже отправлен — цифра заперта…»; отправленная строка снята из списка → 422 `ALLOCATION_LOCKED` (`_frozen_rows_changed`, `split_force_demand`).
- **AF3. Действие департамента по неотправленной строке (шаги 3–7)**: заявка без `sentAt` не видна в `forces/requests` (404 на карточке); `require_sent` → 422 `ALLOCATION_NOT_SENT`.
- **AF4. Ответ после отправки списка (шаг 3)**: статус `SUBMITTED`/`ACCEPTED` → 422 `ALLOCATION_ANSWER_LOCKED`; отрицательное или нецелое число → 422 по полю `allocating`.
- **AF5. Отказ департамента (шаг 3)**: «Выделяем: 0» → статус `DECLINED`, `statusBeforeDecline` запоминается; ненулевая цифра после отказа возвращает прежний статус.
- **AF6. Раскладка по управлениям превышает предел (шаг 4)**: сумма > «Выделяем» (или > квоты, пока ответа нет) → 422 `DIRECTORATE_QUOTA_OVERFLOW`; та же проверка при рассылке. Управление не из департамента / указано дважды / отрицательное число → 422 по полю `rows.<i>.*`.
- **AF7. Управления уже запрошены (шаг 4)**: есть `notifiedAt` или статус из `_QUOTAS_LOCKED_STATUSES` → 422 `DIRECTORATE_QUOTAS_LOCKED`; у департамента нет активных управлений → 422 `ALLOCATION_NO_DIRECTORATES`.
- **AF8. Чужой или не адресованный сотрудник (шаг 5–6)**: сотрудник вне области `status.manage` актора или вне управлений заявки → строка `refused[]` с `PERMISSION_DENIED`, `overridable: false`, фамилия не раскрывается; чужая заявка → 404. Пустой `employeeIds` → 422 (`forces_directorate_select`).
- **AF9. Пересечение статусов (шаг 6)**: жёсткое — 422, мягкое — 409 с признаком `overridable: true`; повтор с `override` и `override_reason` («Выделить с обоснованием»). Человек уже выделен другим департаментом → 422 `DOUBLE_ASSIGNMENT`.
- **AF10. Отправка списка невозможна (шаг 7)**: статус не `NOTIFIED`/`RETURNED` → 422 `ALLOCATION_NOT_SUBMITTABLE`; список пуст → 422 `ALLOCATION_EMPTY`. Опоздание не запрещает отправку — фиксируется `submittedLate`.
- **AF11. Отзыв списка (после шага 7)**: статус не `SUBMITTED` → 422 `ALLOCATION_NOT_WITHDRAWABLE`; люди уже отданы объектам после передачи → 422 `FORCE_HANDED_OVER`; при успехе люди уходят из состава, штаб уведомляется (`FORCES_RESPONSE`, `withdrawn: true`).
- **AF12. Решение штаба (шаг 8)**: статус не `SUBMITTED` → 422 `ALLOCATION_NOT_DECIDABLE`; возврат без причины → 422 по полю `reason`; довыделение по неотправленной строке → 422 `ALLOCATION_NOT_SENT`, `count < 1` или неверный `dueAt` → 422 по полю.
- **AF13. Снятие выделенного (шаг 6, обратный ход)**: статус уже `ACTIVE`/`COMPLETED` → 422 `ASSIGNMENT_ALREADY_STARTED`; `PLANNED` — статус отменяется (`cancel_status`); сотрудник не в заявке → 404.
- **AF14. Распределение по объектам (шаг 9)**: объект не этого ОМ → 422 по полю `rows.<i>.visitObjectId`; сотрудник не в составе → 422 по `rows`; после передачи переставлять уже розданных → 422 `FORCE_HANDED_OVER` (нераспределённых можно).
- **AF15. Передача (шаг 10)**: повторная передача → 422 `FORCE_HANDED_OVER`; есть нераспределённые при наличии объектов → 422 `FORCE_ROSTER_UNASSIGNED`; недобор без комментария → 422 по полю `comment`. У ОМ без объектов посещения передача проходит без распределения.
- **AF16. Сбой уведомлений (шаги 2–4, 8, AF11)**: отказ вставки уведомления не откатывает действие (вложенный `atomic`), недоставленные попадают в отчёт `undelivered` и аудит; получатели не найдены — списки `headlessDirectorates`, `unaddressed`.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `OpsSecurityEvent.force_allocation` (JSON) | update | Строки запросов департаментам: `need`, `dueAt`, `sentAt`, `status` (`DRAFT`→`NOTIFIED`→`SUBMITTED`→`ACCEPTED`/`RETURNED`, отдельно `DECLINED`), `allocating`, `answerComment`, `notifiedAt`, `directorates[]` (`need`, `notifiedAt`), `members[]` (`employeeId`, `statusId`), `topUpOf`, `submittedAt`, `submittedLate`, `decidedAt`, `decisionComment`, `statusBeforeDecline` |
| `OpsSecurityEvent.force_roster` (JSON) | update | Состав мероприятия: люди присланных/принятых списков, `visitObjectId` при распределении; отзыв/возврат списка убирает людей |
| `OpsSecurityEvent.force_handover` (JSON) | update | `{at, by, comment, shortfall[]}` при передаче на расстановку |
| `OpsSecurityEvent.force_requests` (JSON) | update | `_sync_auto_force_request` при изменении состава; легаси-ручка `force_allocation` (PATCH) меняет `allocatedCount`/`status`/`comment` строки |
| `OpsEmployeeStatus` (+ участие) | create / update | Статус `IN_EVENT` «Участие в ОМ» на даты ОМ через `status_service.create_status` с `participations`; отмена (`cancel_status`) при снятии выделенного до начала |
| `OpsForceRequest`, `OpsDepartmentRequest`, `OpsUnitRequest`, `OpsForceRequestMember` (append-only) | create / update | Проекция леджера сигналом `post_save` → `forces_ledger.project` при сохранении `force_requests`/`force_allocation`; у `OpsForceRequestMember` меняется только `removed_at` |
| `Notification` | create | `FORCES_REQUEST_SENT` (ответственным департамента), `FORCES_REQUEST` (начальникам управлений), `FORCES_REQUEST_DEPARTMENT` (сводка начальнику департамента), `FORCES_RESPONSE` (штабу, `dedupe_key=None` — по событию) |
| Журнал аудита (`audit_service`) | create | `FORCE_ALLOCATION_SPLIT`, `FORCE_ALLOCATION_NOTIFIED`, `FORCE_ALLOCATION_SUBMITTED`, `FORCE_ALLOCATION_ACCEPTED`, `FORCE_ALLOCATION_RETURNED` |
| HTTP-аудит (`apps/audit` AuditMiddleware) | create | Каждый успешный write-запрос к `/api/ops/security-events/*/forces/*` и `force-collection/*` |
| `GET forces/collections`, `force-collection`, `forces/requests`, `forces/requests/<id>`, `forces/directorate-requests`, `forces/requests/<id>/directorate` | read | Доска штаба, карточка сбора с объектами, заявки департамента, строки управления; сводки (`totals`, `boardStatus`, `urgent`, `needByObject`, `inServiceByDirectorate`) считаются на чтении |

## Бизнес-требования (BR)
- **BR1.** Все действия цепочки допустимы только на стадиях `DEMAND`, `FORCES`, `PLACEMENT`.
- **BR2.** Раскладка сохраняется списком целиком; в строке обязательны департамент из справочника (без дублей) и целое число ≥ 1; `dueAt` необязателен (умолчание — `allocation_default_due_at`).
- **BR3.** `POST forces/allocation` без `draft: true` отправляет все неотправленные строки (`sentAt`); отправленная цифра не правится и строка не снимается; недобор довыделяется новой строкой (`topUpOf`), которая отправляется сразу.
- **BR4.** Департамент видит и обрабатывает только отправленные строки (`sentAt`) своей области.
- **BR5.** Ответ «Выделяем» — целое ≥ 0 без верхнего предела; 0 — отказ (`DECLINED`); ответ правится до отправки списка; комментарий необязателен.
- **BR6.** Сумма квот управлений ≤ «Выделяем» (или ≤ запросу штаба, пока ответа нет); не названные в запросе управления квоту сохраняют; квоты правятся до оповещения управлений.
- **BR7.** Оповещение ставит `notifiedAt` только управлениям с квотой > 0 и не переписывает уже стоящий момент; выбывшие из департамента управления в заявке сохраняются.
- **BR8.** Уведомление по управлению получают держатели `status.manage` с областью ровно на управление (постоянные роли) и действующие дежурства по договору `scope_matches`; область на департамент получает одно сводное; глобальный грант — ничего. Ключ уведомления — (получатель, вид, деловая дата); штабу ответы шлются по событию.
- **BR9.** Выделение — это статус `IN_EVENT` на [business_date, business_date_end + 1); один человек — в одной заявке ОМ; занятость проверяется общим протоколом статусов (422/409 с `override`).
- **BR10.** Начальник управления выделяет только людей своей области и только по управлениям, которым заявка адресована; чужие идентификаторы отбиваются без раскрытия фамилии; чужая заявка — 404.
- **BR11.** Список отправляется из `NOTIFIED`/`RETURNED` при непустом составе; недобор и опоздание отправку не запрещают, опоздание фиксируется.
- **BR12.** Присланный список сразу пополняет `force_roster`; отзыв/возврат убирает людей из состава, кроме уже отданных объектам после передачи.
- **BR13.** Штаб решает только по `SUBMITTED`; возврат требует причину; повторная приёмка тех же людей состав не удваивает.
- **BR14.** Снять выделенного можно только до начала статуса; начавшееся привлечение — факт.
- **BR15.** Распределять можно только людей состава по объектам этого ОМ; после передачи — только ещё не розданных.
- **BR16.** Передача одна; при наличии объектов все люди должны быть распределены; при недоборе по объекту обязателен комментарий.
- **BR17.** Статус доски штаба выводится: `NEW` (нет `sentAt`) → `SENT` → `ANSWERED K из M` → `DISTRIBUTED` (есть `force_handover`); «Срочно» — просрочка заявки или близость даты ОМ (`RETURN_URGENT_DAYS`).
- **BR18.** Строки леджера append-only: изменение — новая строка с большим `sequence`; правка существующей отвергается `AppendOnlyError`.

## Требования к логированию
- Аудит домена: `FORCE_ALLOCATION_SPLIT` (раскладка/отправка — `sent[]`, `sentAt`, отчёт рассылки; ответ департамента — `requested`, `allocating`, `declined`, `comment`; разбивка по управлениям — `quota`, `split`, `rows`; распределение по объектам — `rosterObjects`), `FORCE_ALLOCATION_NOTIFIED` (`directorates`, `notifiedHeads`, `notifiedHeadsList`, `headlessDirectorates`, `directoratesWithoutQuota`, `undeliveredHeads`), `FORCE_ALLOCATION_SUBMITTED` (`members`), `FORCE_ALLOCATION_ACCEPTED` (приёмка — `accepted[]`; передача на расстановку — `handover`), `FORCE_ALLOCATION_RETURNED` (`reason`).
- Логгер (`logging.getLogger`): `security_events.respond_allocation` — `warning` при недоставленных уведомлениях штабу и `exception` при падении рассылки; `forces_send.withdraw_allocation` — те же два вызова для отзыва. Только console-handler (`config/settings/base.py`).
- HTTP-аудит: AuditMiddleware пишет каждый успешный write-запрос.
- Не логируются: снятие выделенного (`remove_allocation_member`), отзыв списка на уровне аудита домена, довыделение (`top_up`) отдельным кодом (идёт через `notify_directorates` → `FORCE_ALLOCATION_NOTIFIED` только при наличии управлений), легаси `update_force_allocation`, выделение по запросу управления как отдельное событие (`select_for_request` аудита не пишет; статус фиксирует `status_service`) — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` — все действия; в рассылки с областью не попадает (глобальный грант) |
| OPS_STAFF | полный по шагам штаба (раскладка, отправка, довыделение, приёмка/возврат, доска, объекты, передача) | `forces.command` в `permission_map`: `forces_split`, `forces_collections`, `forces_collection`, `forces_top_up`, `forces_collection_objects`, `forces_collection_handover`, `forces_accept`, `forces_return`; область не сужается |
| FORCES_GATHERING_OFFICER, DEPARTMENT_EXPENSE_OFFICER | полный по шагам департамента (заявки, ответ, разбивка, оповещение, отправка, отзыв) | `forces.allocate` в `permission_map` + `require_scoped_permission(... allocation_scope_division)` для `forces_directorate_split`, `forces_notify`, `forces_respond`, `forces_submit`, `forces_withdraw`; списки сужены `visible_division_ids` |
| DIRECTORATE_HEAD, HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, HEAD_OPS_UNIT, INTEGRATION_USER | выделение людей по запросу, просмотр своих строк | `status.manage` для `forces_directorate_requests`, `forces_directorate_request`, `forces_directorate_select`; область — `visible_division_ids(actor, status.manage)`, чужое — 404 / `refused` |
| DIRECTORATE_HEAD | добавление/снятие члена заявки напрямую | `forces.select` для `forces_member_add`/`forces_member_remove` + `require_scoped_permission(... employee_scope_division)`; на фронте вызывающих экранов нет |
| EVENT_OFFICER, HEAD_OPS_UNIT | легаси-правка строки `force_requests` | `event.manage` для `force_allocation` (PATCH `forces/<request_id>`); на фронте вызывающих экранов нет |
| Прочие роли с `event.view` (DUTY_OFFICER, ANALYST, AUDITOR и др.) | нет | отдельные права цепочки отсутствуют; `/employees` открывается только держателям `forces.command` / `forces.allocate` / `forces.select` (`entities/portal-access`) |
| EMPLOYEE, HEAD_*_LINE без `status.manage` | нет | `Не реализовано в коде` иных исключений |

## Требования к UX/UI
- Страница `/employees?view=forces` «Сбор сил на ОМ» (переключатель с «Ежедневный расход организации»); шапка с меткой «В разработке»; счётчик «Показано N из M», кнопка «Обновить»; плитки «По штату», «По списку» и др. из `useForcesGathering`; вкладки: «Сборы» (только `forces.command`), «Заявки» (только `forces.allocate`), «Список сотрудников», «Участие в ОМ (n)», «В строю (n)», «Карточки», «Профиль сотрудника»; поиск «Поиск по ФИО, должности, отделу...», фильтр «Все статусы».
- Вкладка «Сборы» — таблица `ForceCollectionsTable`: Мероприятие, Дата ОМ, Потребность, Выделяют, Прислано, Статус («Собрано K из N»); ошибка «Сборы не загрузились — список показать нечем»; клик открывает карточку сбора.
- Карточка сбора `ForceCollectionCard` (штаб): плитки «Требуется по рекогносцировке», «Распределено квотами», «Собрано», «Осталось собрать»; потребность по объектам; редактор раскладки — строки «Департамент», «Срок сдачи списка» (подсказка «Пусто — за сутки до начала мероприятия»), «Сколько человек», «Убрать департамент из черновика»; кнопки «Сохранить черновик» / «Отправить запросы» с подтверждением «Отправить запросы департаментам?»; валидация «У каждой строки нужен департамент и число не меньше единицы»; таблица департаментов: Департамент, Запрошено, Выделяют, Прислано, Комментарий, Статус («Запрос отправлен», «Список прислан», «Принят», «Возвращён», «Отказ»), Ответственный; действия «Принять», «Вернуть» (поле «Причина возврата», placeholder «Например: нужны люди с допуском»), «Довыделить недобор» (поле «Сколько человек довыделить»); блок состава: Сотрудник, Управление, Объект, чекбоксы, «Отдать объекту: N» («Отметьте людей слева»); «Передать на расстановку» (подсказка «Сначала отдайте объектам всех собранных»; диалог «Передать на расстановку с недобором?» с полем «Комментарий к передаче с недобором»); пустое состояние «Объектов посещения у мероприятия нет.»; ошибки «Сбор не открылся», «Передать не удалось», «Не удалось отдать объекту». Редактор активен только на стадиях сбора и при `forces.command`.
- Вкладка «Заявки» — таблица `DepartmentRequestsTable`: Мероприятие, Запрошено, Выделяем, Собрано («Собрано K из N — перебор на …»), Срок, Статус («Сбор идёт», «Управления оповещены», «Список отправлен в штаб», «Принято штабом», «Возвращено департаменту», «Отказ»), Открыть; ошибка «Заявки не загрузились — список показать нечем».
- Карточка заявки `DepartmentRequestCard` (департамент): форма «Выделяем» + «Комментарий» (подсказка «Желательно пояснить, почему меньше»); плитки «Квота департамента», «Разложено по управлениям», «Выделено», «Осталось»; таблица управлений: Управление, В строю, Запрошено, Проставлено «Участие в ОМ», Статус («Не запрошено» / «Запрошено <дата>» / «Выделено»); кнопки «Сохранить и отправить» / «Отправить» с диалогом «Отправить заявку в управления?»; подсказки «Управления уже запрошены — цифры правятся до запроса», «Разложите … по управлениям и отправьте им»; таблица выделенных: Сотрудник, Подразделение, Откуда; «Отправить список в штаб?» (тексты «Никто ещё не выделен…», «Выделено K из N — список полный…»), «Отозвать список»; ошибки «Заявка не открылась», «Ответ не сохранился», «Раскладка не сохранилась», «Список не отправлен», «Список не отозван», «Управления не оповещены».
- Баннер `ForcesRequestBanner` на `/statuses` (начальник управления): «Запросы на сбор сил» с адресатом «Вашему управлению» / «Вашему департаменту» / «Службе»; приход по ссылке `?forcesRequest=<allocationId>`; кнопка «Выделить на <код>: N» («Отметьте сотрудников в таблице — и выделите на ОМ»); отказы с «Выделить с обоснованием: N» для `overridable`; ошибки «Запрос на сбор сил по ссылке не найден…», «Выделить не удалось».
- Этап ОМ в карточке `/security-ops/events/[id]`: стадии `DEMAND`/`FORCES`/`PLACEMENT` показываются одним шагом «Расстановка сил» (`PlacementStage` → `PlacementBoard`); отдельных форм сбора сил в карточке ОМ нет.
- Zod-схем форм в перечисленных компонентах нет; ошибки полей приходят с сервера (`rows.<i>.*`, `allocating`, `count`, `dueAt`, `reason`, `comment`).

## Открытые вопросы
- Метки «В разработке» `/employees` (`?view=forces`): «Заявки и запросы таблицами, довыделение новой строкой (№425)»; «Потребность по объектам, колонки «Выделяют / Прислано», «Срочно» вверх (№426)»; «Входящие запросы департамента: колонки «выделяем / собрано» (№444)».
- Метки этапов DEMAND / FORCES: «Подписи по спецификации, перетаскивание, пустое состояние без списка (№445)».
- Два источника состояния: JSON `force_allocation`/`force_requests`/`force_roster` остаётся источником для экранов, таблицы `[МД-06]` — проекция и история; снятие JSON «отдельным шагом после Ш-10» (`models_forces.py`) — не выполнено.
- Ручки без UI: `forces_member_add`/`forces_member_remove` (`forces.select`) и легаси `force_allocation` (PATCH `forces/<request_id>`, `event.manage`; статусы `SENT`/`PARTIALLY_ALLOCATED`/`ALLOCATED`) — хуки в `use-security-event-stages.ts` есть, экранов-вызывающих нет.
- Приёмка штабом (`ACCEPTED`) не влияет на состав: люди попадают в `force_roster` уже при отправке списка (`_merge_into_roster`); отдельного шага «Принять в мероприятие» в спецификации нет — смысл кнопки «Принять» после №944 не определён в коде.
- Расхождение адресатов рассылки: постоянные роли `status.manage` с глобальной областью уведомление по управлению не получают, а дежурство без области — получает (`_directorate_heads` vs `_department_heads_over`; в коде: «свести оба места — отдельный его вопрос, карточка заведена»).
- `HEAD_OPS_UNIT` (начальник второго департамента) после №972 не получает `FORCES_RESPONSE` и не имеет `forces.command` — вопрос №421 закрыт решением заказчика; сценарий его участия в сборе — только как держатель `status.manage`.
- Ключ уведомления (получатель, вид, деловая дата): начальник управления, запрошенный в один день по двум ОМ, получает одно уведомление с payload первого; второе видит только баннером.
- Довыделение (`top_up`) не пишет свой код аудита; `select_for_request` аудита не пишет.
- `forces_requests.py` ссылается на `_refuse_manual_participation` (запрет ручного «Участия в ОМ», №427) — функция с таким именем в `apps/ops`/`apps/operations` не найдена.
- Статус «Срочно» вычисляется по порогу `APPROVAL.RETURN_URGENT_DAYS` возврата расстановки — собственного порога у сбора сил нет; «срока сбора» у ОМ нет (`force_collections_view`, №287).
