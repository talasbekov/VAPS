# UC-STS-005. Планировать и нести дежурства, включая боевые

| Поле | Значение |
|---|---|
| Модуль | Статусы и дежурства |
| Актор | `DUTY_PLANNER` (`duty.view`, `duty.manage`), `DUTY_PLAN_APPROVER` (`duty.view`, `duty.approve_plan`), `DUTY_OFFICER` (`duty.view`), `ADMIN` |
| Статус | Partial |
| Основание | `apps/ops/duties.py` (`create_draft`, `check_plan`, `approve_plan`, `reopen_plan`, `create_shift`, `cancel_shift`, `acknowledge_shift`, `clock_in_shift`, `clock_out_shift`, `detect_conflicts`, `read_conflict_policy`, `plan_objects`, `duty_candidates`), `apps/ops/combat.py` (`create_shift`, `submit_roster`, `review_roster`, `acknowledge`, `check_in`, `submit_handover`, `complete`), `apps/operations/models_duty.py` (`OpsDutyType`, `OpsDutyShift`, `OpsDutyMonthlyPlan`, `OpsDutyConflictPolicy`), `apps/operations/models_combat.py` (`OpsCombatDutyType`, `OpsCombatRoute`, `OpsCombatDutyShift`), `apps/ops/api/views.py` (`DutyTypeViewSet`, `DutyMonthlyPlanViewSet`, `DutyShiftViewSet`, `DutyPlanObjectsViewSet`, `DutyCandidatesViewSet`, `CombatDutyTypeViewSet`, `CombatRouteViewSet`, `CombatRosterCandidatesViewSet`, `CombatDutyShiftViewSet`; `_READ_DUTY_PERMISSION`, `_MANAGE_DUTY_PERMISSION`, `_APPROVE_DUTY_PERMISSION`), `apps/ops/api/urls.py`, FRONT `hooks/use-duty-shifts.ts`, `entities/duty-shift/model/contracts.ts`, `widgets/my-profile/ui/ProfileBody.tsx` (`useMyDutyShifts`), `features/employee-status-update/ui/DutyAssignmentFields.tsx`, `entities/duty-assignment/model/store.ts`, `e2e/portal-routes.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Планировщик составляет месячный план дежурств по объектам и постам, назначает смены сотрудникам без пересечений и нарушения отдыха, утверждающий подписывает план, а сотрудник принимает смену, заступает и сдаёт её; для боевых дежурств подразделение подаёт состав группы по трассам, штаб принимает его, группа заступает и оформляет сдачу смены.

## Предусловия
- Актор вошёл в систему; у него `duty.view` (чтение), `duty.manage` (планирование и смены) или `duty.approve_plan` (утверждение).
- Заведены виды дежурств (`OpsDutyType`: длительность, требование старшего, минуты отдыха после, требование действующего паспорта объекта) и политика конфликтов (`OpsDutyConflictPolicy`, singleton, `rest_after_duty_mode`).
- Для боевых дежурств — виды (`OpsCombatDutyType`) и трассы (`OpsCombatRoute`).
- Для сотрудника: учётная запись привязана к `Employee` (иначе «мои смены» — пустой список).

## Main Flow
1. Планировщик создаёт черновик плана на месяц: `POST /api/ops/duty-monthly-plan/draft/` (`month`) — план в состоянии `DRAFT`, `revision=1`, запись в `history`.
2. Планировщик смотрит объекты с постами на дату (`GET /api/ops/duty-plan-objects/?date=`) и кандидатов (`GET /api/ops/duty-candidates/?date=`), создаёт смену: `POST /api/ops/duty-shifts/` (`business_date`, `duty_type_code`, `object_id`, `sector_id`, `post_id`, `employee_id`, `note`) — система проверяет паспорт объекта, пересечения и отдых, пишет `OpsDutyShift` в состоянии `PLANNED` и аудит `DUTY_SHIFT_CREATED`.
3. Планировщик проверяет план: `POST /api/ops/duty-monthly-plan/check/` — система прогоняет `detect_conflicts` по всем сменам месяца, сохраняет `last_validation` с отпечатком плана и событие `VALIDATED`.
4. Утверждающий подписывает план: `POST /api/ops/duty-monthly-plan/approve/` — состояние `APPROVED`, `approved_at`, `approved_by`, событие `APPROVED`; список действий (`build_plan_actions`) отражает права актора и актуальность проверки.
5. При необходимости утверждающий возвращает план: `POST …/reopen/` — `revision + 1`, состояние `DRAFT`, событие `REOPENED`.
6. Сотрудник видит свои смены (`GET /api/ops/duty-shifts/mine/`) в «Моём профиле»; подтверждает: `POST /api/ops/duty-shifts/{id}/acknowledge/` (`PLANNED`→`ACKNOWLEDGED`), заступает: `…/clock-in/` (`→ACTIVE`, `actual_start`), сдаёт: `…/clock-out/` (`→COMPLETED`, `actual_end`).
7. Планировщик отменяет смену: `POST /api/ops/duty-shifts/{id}/cancel/` (`reason`) — `CANCELLED`, аудит `DUTY_SHIFT_CANCELLED`.
8. Боевое дежурство: планировщик создаёт смену `POST /api/ops/combat-duty-shifts/` (`business_date`, `duty_type_code`, `route_ids[]`, `coverage_mode`, `required_employees`); подразделение подаёт состав `…/submit/` (`group_leader`, `members[]`, `reserve[]`, `submitted_by_unit`) из кандидатов `GET /api/ops/combat-roster-candidates/` → `SUBMITTED`.
9. Штаб решает `…/review/` (`decision`, `return_reason`) → `ACCEPTED` (исполнение `PENDING_ACKNOWLEDGEMENT`) или `RETURNED`; участники подтверждают `…/acknowledge/` (`employee_name`), старший заступает `…/check-in/` (`→ACTIVE`), оформляет сдачу `…/handover/` (`unresolved_incidents`, `remarks`, `confirmed_by`) и завершает `…/complete/` (`actual_member_names`) → `COMPLETED`; замена участника — `…/replace/`.

## Alternative Flow
- **AF1. Нет права**: 403 по `permission_map` (`duty.view` — списки, `mine`, `retrieve`, виды, трассы; `duty.manage` — `draft`, `check`, `create`, `cancel`, `acknowledge`, `clock_in`, `clock_out`, объекты и кандидаты плана, `submit`, `review`, `check_in`, `handover`, `complete`, `replace`; `duty.approve_plan` — `approve`, `reopen`).
- **AF2. План на месяц уже есть / плана нет**: 422 `PLAN_ALREADY_EXISTS` «План на этот месяц уже создан.» / `PLAN_NOT_FOUND` «Плана на этот месяц нет.»; месяц не в формате — 400 `VALIDATION_ERROR`.
- **AF3. План утверждён**: создание/отмена смены → 422 `PLAN_APPROVED_LOCKED` «План месяца утверждён — изменения только в новой ревизии»; `check` в `APPROVED` → 422 `INVALID_STAGE_TRANSITION`.
- **AF4. План не проверен или проверка устарела (отпечаток сменился)**: `approve` → 422 `PLAN_NOT_APPROVABLE`.
- **AF5. Вид дежурства требует действующего паспорта, а у объекта его нет**: 422 `PASSPORT_REQUIRED`.
- **AF6. Сотрудник уже назначен на дежурство в этот день**: 422 `DUTY_OVERLAP` (severity `HARD`, не обходится).
- **AF7. Нарушен отдых после дежурства (`REST_AFTER_DUTY`)**: при `rest_after_duty_mode` строгом — 422 `REST_AFTER_DUTY`; при мягком — 409 `DUTY_CONFLICT_DETECTED` (входит в `OVERRIDABLE_CODES`), обходится `override=true` с `override_reason`, причина сохраняется в `OpsDutyShift.override_reason`.
- **AF8. Недопустимый переход смены**: 422 `INVALID_STAGE_TRANSITION` (`_transition` проверяет `from_state`), смена не найдена — 404 `ENTITY_NOT_FOUND`.
- **AF9. Политика конфликтов не заведена**: 422 `VALIDATION_ERROR` из `read_conflict_policy`.
- **AF10. Боевое: дата не бизнес-дата / нет трасс / неизвестный вид или трасса / трасс больше, чем поддерживает вид / неверная потребность**: 422 `INVALID_BUSINESS_DATE`, `EMPTY_ROUTE_SET` «Укажите хотя бы одну Трассу.», `UNKNOWN_DUTY_TYPE`, `UNKNOWN_ROUTE`, `TOO_MANY_ROUTES`, `INVALID_REQUIREMENT`.
- **AF11. Боевое: состав**: `EMPTY_GROUP`, `ALREADY_SUBMITTED`, `DOUBLE_ASSIGNMENT` (человек уже в другом принятом составе того же дня), `REASON_REQUIRED` «Причина возврата обязательна.» при возврате, `NOT_IN_ROSTER`, `ALREADY_ACKNOWLEDGED`, `CONFIRMER_REQUIRED` «Укажите, кто сдаёт смену.», `MISSING_HANDOVER` «Перед завершением нужно оформить сдачу смены.», `INVALID_STATE_TRANSITION` — все 422.
- **AF12. Учётная запись не привязана к сотруднику**: `mine` → пустой список (штатный исход).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_duty_monthly_plans` (`OpsDutyMonthlyPlan`) | create / update | `month` (уникален), `state_code` `DRAFT`/`APPROVED`, `revision`, `last_validation` (конфликты + отпечаток), `approved_at`, `approved_by`, `history[]` (`VALIDATED`/`APPROVED`/`REOPENED`) |
| `ops_duty_shifts` (`OpsDutyShift`) | create / update | `business_date`, `duty_type_code`, `target` (объект/сектор/пост), `employee_id`, `employee_name`, `state_code`, `acknowledged_at`, `actual_start`, `actual_end`, `passport_binding`, `note`, `cancellation`, `override_reason` |
| `ops_combat_duty_shifts` (`OpsCombatDutyShift`) | create / update | `business_date`, `duty_type_code`, `route_set`, `required_employees`, `group_name`, `submission` (состав, решение, подтверждения, исполнение, сдача) |
| `ops_duty_types`, `ops_duty_conflict_policy`, `ops_combat_duty_types`, `ops_combat_routes` | read | Справочники и политика — правка по HTTP `Не реализовано в коде` (только чтение) |
| `OpsAuditLog` | create | `DUTY_SHIFT_CREATED`, `DUTY_SHIFT_CANCELLED` (`entity_type=duty_shift`); по плану и боевым сменам — `Не реализовано в коде` |
| `localStorage` браузера (`duty-assignment`) | create / delete | Назначение «На дежурстве» из диалога статуса — клиентское, на сервер не уходит |

## Бизнес-требования (BR)
- **BR1.** Планирует один, утверждает другой: `duty.manage` и `duty.approve_plan` выданы разным ролям (`DUTY_PLANNER` / `DUTY_PLAN_APPROVER`).
- **BR2.** Утверждённый план блокирует создание и отмену смен месяца; изменения — только после `reopen` в новой ревизии.
- **BR3.** Утвердить можно только план с актуальной проверкой: отпечаток смен (`plan_fingerprint`) совпадает с сохранённым в `last_validation`.
- **BR4.** Один сотрудник — не более одной смены в день (`DUTY_OVERLAP`, HARD); отдых после дежурства — `rest_after_minutes` вида, режим строгости — из политики (`rest_after_duty_mode`), мягкий конфликт обходится причиной.
- **BR5.** Вид дежурства с `requires_current_passport` требует действующей версии паспорта объекта; привязка версии сохраняется в `passport_binding`.
- **BR6.** Жизненный цикл смены линейный: `PLANNED` → `ACKNOWLEDGED` → `ACTIVE` → `COMPLETED`; `CANCELLED` — из `PLANNED`/`ACKNOWLEDGED` с причиной.
- **BR7.** Боевая смена: хотя бы одна трасса, число трасс по виду (`supports_multiple_routes`), состав с руководителем группы, без двойных назначений в принятые составы того дня; возврат состава — с причиной; завершение — только после сдачи смены.
- **BR8.** «Мои смены» — по `Employee.user_id` актора; отсутствие привязки — пустой список, не ошибка.

## Требования к логированию
- `OpsAuditLog`: `DUTY_SHIFT_CREATED` (с `override_reason` в `reason`) и `DUTY_SHIFT_CANCELLED` (`audit_service.record` в `duties.py`).
- История плана — поле `history[]` самого плана (событие, время, актор).
- Боевые дежурства (`combat.py`): `audit_service` не вызывается — `Не реализовано в коде`; переходы состава хранятся в `submission`.
- Подтверждение, заступление, сдача смены (`acknowledge`/`clock_in`/`clock_out`): в `OpsAuditLog` `Не реализовано в коде` (только отметки времени в строке).
- `AuditMiddleware` → `audit.AuditLog`: `ContentType` для `/api/ops/duty-shifts/` (`ops.duty-shift`) не разрешается — записей нет.
- `logging.getLogger` в `duties.py`/`combat.py` нет.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*` |
| `DUTY_PLANNER` | планирование: черновик, проверка, смены (создание, отмена, подтверждение, заступление, сдача), объекты и кандидаты, боевые смены и составы; чтение | `duty.manage`, `duty.view` в `permission_map` соответствующих вьюсетов |
| `DUTY_PLAN_APPROVER` | утверждение и возврат плана; чтение | `duty.approve_plan` (`approve`, `reopen`), `duty.view` |
| `DUTY_OFFICER` | чтение планов, смен, видов, трасс, «мои смены» | `duty.view` |
| Остальные роли (в т.ч. `EMPLOYEE`, `DIRECTORATE_HEAD`, `HEAD_*`) | нет | 403; «мои смены» в профиле — пустой блок при 403 |

## Требования к UX/UI
- «Мой профиль» (`/security-ops/profile`, `ProfileBody`): блок смен дежурств из `GET /api/ops/duty-shifts/mine/` (список, скрыт в режиме `readOnly`; пустой список подписан как «мы про них не знаем», а не «дежурств нет»); метка «В разработке» раздела: «Карточки назначений „Ознакомлен, заступлю“ / „Не могу заступить“ (№405)», «Три вкладки, календарь с полосками постов, без заглушек (№449)».
- Диалог статуса «На дежурстве» (`EditStatusDialog` → `DutyAssignmentFields`): тип дежурства POST/GROUP, объект из `/api/ops/objects/`, пост или группа — сохраняется только в `localStorage`, `OpsDutyShift` не создаёт.
- Экран плана дежурств, карточка смены, кнопки «Подтвердить»/«Заступить»/«Сдать», экраны боевых дежурств: `Нет пользовательского интерфейса` (хуки `useCreateDutyShift`, `useCancelDutyShift`, `useAcknowledgeDutyShift`, `useClockInDutyShift`, `useClockOutDutyShift`, `useDutyPlanObjects`, `useDutyCandidates` в `hooks/use-duty-shifts.ts` есть, вызывающих в `app/`, `features/`, `widgets/` нет; «План дежурств» и карточка смены удалены 13.08.2026 — комментарий в `e2e/portal-routes.ts:76`).

## Открытые вопросы
- Весь цикл планирования, утверждения, несения и боевых дежурств доступен только по API: экранов в портале нет (удалены 13.08.2026), хотя клиентские хуки под все ручки написаны.
- Назначение «На дежурстве» из диалога статуса живёт в `localStorage` браузера и не связано с `OpsDutyShift`; кадровый статус `on_duty` и смена раздела никак не согласованы.
- Справочники видов дежурств, трасс и политика конфликтов правятся только сидом/БД — ручек записи нет.
- Аудит: план (утверждение, возврат), подтверждение/заступление/сдача смены и все операции боевых дежурств в `OpsAuditLog` не пишутся.
- Из `in-development.ts` для `/security-ops/profile`: карточки назначений «Ознакомлен, заступлю» / «Не могу заступить» (№405) и календарь с полосками постов (№449) — интерфейс подтверждения смены сотрудником не реализован.
- `employee_id` в `OpsDutyShift` — строка (`CharField`), в `Employee` — целое; связь не является внешним ключом.
- Право на `acknowledge`/`clock_in`/`clock_out` — `duty.manage` (планировщик), а не сам дежурный: сотрудник с `duty.view` подтвердить свою смену через API не может.
