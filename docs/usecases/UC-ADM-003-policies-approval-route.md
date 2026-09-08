# UC-ADM-003. Изменить политику раздела и маршрут согласования

| Поле | Значение |
|---|---|
| Модуль | Администрирование и доступ |
| Актор | Администратор справочников — держатель `settings.manage` (`REFERENCE_ADMIN`, `ADMIN`); чтение — держатель `settings.view` |
| Статус | Done |
| Основание | `apps/ops/settings_service.py` (`update_setting`, `serialize_setting`, `_validate_value`, `_sync_policy_consumers`, `next_policy_version`), `apps/ops/approval_route.py` (`list_steps`, `replace_steps`, `template_route`, `seed_route`), `apps/operations/models_settings.py` (`OpsPolicySetting`, `OpsPolicySectionVersion`, `OpsSettingChangeEvent`, `OpsApprovalRouteStep`), `OpsSettingsViewSet` (`/api/ops/settings/`, `PATCH settings/{code}/`), `OpsSettingChangesViewSet` (`/api/ops/setting-changes/`), `views_approval_route.OpsApprovalRouteViewSet` (`GET/PUT /api/ops/approval-route/`); FRONT `app/security-ops/settings/page.tsx`, `features/approval-route/ui/ApprovalRouteCard.tsx`, `hooks/use-ops-settings.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Администратор меняет значение политики раздела ОМ (числовой лимит или режим) с указанием причины и задаёт маршрут согласования расстановки, который получают новые объекты посещения.

## Предусловия
- Актор вошёл; для просмотра — `settings.view`, для правки — `settings.manage` (или `*`).
- Настройки засеяны (`OpsPolicySetting` по разделам `CONFLICT_RULES`, `PASSPORT_FRESHNESS`, `RATING_POLICY`, `ANALYTICS_LIMITS`, `LOAD_POLICY`, `ATTENTION_POLICY`, `REPORT_LIMITS`, `APPROVAL_POLICY`).

## Main Flow
1. Актор открывает «Система → Администрирование» (`/security-ops/settings`, он же `/settings`); система читает `GET /api/ops/settings/` (список настроек по разделам с `action.canEdit`/`disabledReason`, версии разделов), `GET /api/ops/setting-changes/` (журнал) и `GET /api/ops/approval-route/` (шаги маршрута).
2. Актор нажимает «Изменить» у настройки; система открывает диалог с заголовком `safeLabel`: для `NUMBER` — числовое поле с границами `minValue…maxValue`, для `CHOICE` — селект «Режим» из `options`, и обязательное поле «Причина изменения *».
3. Актор вводит значение и причину, нажимает «Сохранить» → `PATCH /api/ops/settings/{settingCode}/` `{value, reason}`.
4. Система под блокировкой строки проверяет редактируемость и значение, сохраняет его с `updated_by`/`value_updated_at`, поднимает версию раздела (`<раздел>-v1` → `-v2`, либо `<…>.N+1`).
5. Система в той же транзакции записывает значение в политику-потребитель (`passport.*` → `OpsPassportFreshnessPolicy`, `conflict.rest_after_duty.mode` → `OpsDutyConflictPolicy`), создаёт `OpsSettingChangeEvent` с готовыми подписями старого/нового значения и пишет аудит `SETTINGS_UPDATED`.
6. Система возвращает обновлённую настройку, версии разделов и событие; экран обновляет карточку и «Журнал изменений».
7. Актор в карточке «Маршрут согласования» правит строки шагов (роль/должность подписанта, подразделение, логин учётки — «без привязки»), добавляет/удаляет/переставляет строки и нажимает «Сохранить маршрут» → `PUT /api/ops/approval-route/` `{steps: [...]}`.
8. Система проверяет строки, заменяет маршрут целиком (позиции — порядок строк), при указанном логине подставляет ФИО из кадровой записи, пишет аудит `APPROVAL_ROUTE_REPLACED` и возвращает шаги.
9. Новый объект посещения при выходе на «Согласование» получает копию маршрута (`seed_route` → `approval_route` со статусами `NOT_SENT`); уже идущие согласования правкой не затрагиваются.

## Alternative Flow
- **AF1. Нет `settings.view`**: шаг 1 → 403; экран `OpsAccessDenied what="настроек политик"`.
- **AF2. Есть `settings.view`, нет `settings.manage`**: шаг 2 → у настроек `action.canEdit=false`, `disabledReason` = «Нужно право управления настройками (ops.settings.manage).»; кнопка правки `disabled`, причина под ней; карточка маршрута в режиме без сохранения (`canManage=false`); `PATCH`/`PUT` → 403.
- **AF3. Настройка заперта (`editable=false`)**: шаг 3 → 422 `SETTING_LOCKED` с `locked_reason` («Правило заперто.» по умолчанию); на экране кнопка `disabled` с причиной.
- **AF4. Пустая причина**: шаг 4 → 400 `VALIDATION_ERROR` `{"reason": ["Укажите причину изменения."]}`.
- **AF5. Значение вне диапазона / не целое / не число / неизвестный режим**: шаг 4 → 400 с подписью поля `value` («Допустимый диапазон — от … до …», «Значение задаётся целым числом.», «Укажите числовое значение.», «Выберите один из допустимых режимов.»).
- **AF6. Неизвестный `settingCode`**: шаг 3 → 404 `ENTITY_NOT_FOUND` «Настройка не найдена.».
- **AF7. Шаг маршрута без роли**: шаг 8 → 400 `{"steps": ["Шаг N: укажите роль (должность) подписанта."]}`; `steps` не список → «Ожидается список шагов.»; логин не найден → «Шаг N: учётка «…» не найдена.». Карточка показывает первую ошибку `steps`.
- **AF8. У объекта уже есть маршрут**: шаг 9 → `seed_route` возвращает `False`, ничего не меняется; пустой маршрут в настройках — объект остаётся без маршрута.
- **AF9. Журнал изменений**: отдаются только последние 200 событий (`[:200]`), пагинации нет.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_policy_settings` (`OpsPolicySetting`) | update | `value` (int для `NUMBER`, строка для `CHOICE`), `updated_by`, `value_updated_at` |
| `ops_policy_section_versions` (`OpsPolicySectionVersion`) | create / update | версия раздела растёт при каждом принятом изменении |
| `ops_passport_freshness_policy` (`OpsPassportFreshnessPolicy`), `ops_duty_conflict_policy` (`OpsDutyConflictPolicy`) | update | сквозная запись значения и версии для настроек `passport.verification_interval_days`, `passport.due_soon_percent`, `conflict.rest_after_duty.mode` |
| `ops_setting_change_events` (`OpsSettingChangeEvent`) | create | append-only: `setting_code`, подписи `old_value`/`new_value`, `reason`, `actor_user_id`, `policy_version_after` |
| `ops_approval_route_steps` (`OpsApprovalRouteStep`) | delete + create | маршрут заменяется целиком: `position` (уникальна), `role_label`, `unit`, `username`, `full_name`, `created_by` |
| `OpsSecurityEventVisitObject.approval_route` | update | копия маршрута при выходе на согласование (`seed_route`), только если своего маршрута нет |
| `ops_audit_logs` | create | `SETTINGS_UPDATED` (entity `policy_setting`, `entity_id`, `old/new_value` подписями, `reason`), `APPROVAL_ROUTE_REPLACED` (`entity_key="APPROVAL_ROUTE"`, `old/new_value={"steps": [...]}`) |

## Бизнес-требования (BR)
- **BR1.** Правка настройки требует причину; значение `NUMBER` — целое в `[min_value, max_value]`, `CHOICE` — одно из `options[].value`.
- **BR2.** Право правки решает сервер по-записно: запертое правило несёт `lockedReason` и не открывается никаким правом; нехватка `settings.manage` — своя причина.
- **BR3.** Каждое принятое изменение поднимает версию раздела и пишется насквозь в политику-потребитель в той же транзакции.
- **BR4.** Журнал изменений хранит готовые подписи значений (формат — владелец вариантов: `safeLabel` режима или `<число> <ед.>` из `DAYS/PERCENT/COUNT/HOURS/MINUTES`) и версию после изменения.
- **BR5.** Маршрут согласования заменяется целиком; каждый шаг обязан иметь роль (должность); логин, если указан, должен существовать — ФИО берётся из `Employee` учётки, иначе из `fullName`, иначе логин.
- **BR6.** Объект посещения получает копию маршрута один раз; последующие правки настройки текущие согласования не переписывают.
- **BR7.** Настройки бэкенда `PATCH` только по коду; `POST`/`DELETE` не маршрутизируются (`ViewSet` без `create`/`destroy`).

## Требования к логированию
- `OpsAuditLog`: `SETTINGS_UPDATED` с причиной, `APPROVAL_ROUTE_REPLACED` со снимками маршрута до/после; актор — `resolve_actor_id(request)` (для маршрута — `str(resolve_actor_id(request) or request.user)`).
- `OpsSettingChangeEvent`: собственный append-only журнал настроек (виден на экране).
- `LogIPMiddleware`: строка на каждый запрос.
- HTTP-аудит `audit.AuditLog`: `ContentType(app_label="ops", …)` не существует → записи нет.
- Отдельного `logging.getLogger` в `settings_service.py`/`approval_route.py` нет.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*` |
| `REFERENCE_ADMIN` | полный (чтение и правка настроек, замена маршрута) | `settings.view`, `settings.manage`; `OpsSettingsViewSet.permission_map = {"list": "settings.view", "partial_update": "settings.manage"}`, `OpsSettingChangesViewSet` — `settings.view`, `OpsApprovalRouteViewSet.permission_map = {"list": "settings.view", "replace": "settings.manage"}`; экран — `MODULE_PERMISSION["/security-ops/settings"] = "settings.view"`, `ApprovalRouteCard canManage=hasPermission("settings.manage")` |
| Все остальные роли (`settings.view` больше никому не выдан в `ROLE_PERMISSIONS`) | нет | 403 `PERMISSION_DENIED` |

## Требования к UX/UI
- «Администрирование» — страница `/security-ops/settings` (eyebrow «Система», описание «Политики, которые читают другие разделы — правка меняет исход операций, а не окраску экрана»): карточки настроек по разделам с подписью, описанием, текущим значением, «обновлено … кем», кнопка правки (`disabled` + причина при `canEdit=false`); карточка «Маршрут согласования» (строки: «Роль (должность) *», «Подразделение», логин с placeholder «без привязки», ФИО; кнопки добавить/удалить/переставить; «Сохранить маршрут» активна только при изменениях, «Сохраняем…» в процессе; ошибки `steps` под карточкой; состояния «Загрузка маршрута…» / ошибка); карточка «Журнал изменений» (список событий: подпись, старое → новое, причина, актор, момент, версия).
- Диалог правки: заголовок `safeLabel`; поле значения (число с `min`/`max` или селект «Режим»); «Причина изменения *»; кнопка «Сохранить» / «Сохранение…»; ошибки полей от сервера под полями.
- Состояния страницы: загрузка, ошибка чтения, `OpsAccessDenied`.
- Раздел под клиентским `layout.tsx` (`/security-ops`), колокольчик уведомлений присутствует.

## Открытые вопросы
- Журнал изменений ограничен последними 200 событиями без пагинации и фильтров; полная история доступна только в таблице.
- Текст причины отказа на сервере называет право `ops.settings.manage`, тогда как код права в справочнике — `settings.manage` (расхождение подписи и кода).
- Маршрут заменяется через `delete` + `create`: `id` шагов меняются при каждом сохранении; `approval_route` объектов ссылается на позиции (`approver-N`), а не на строки.
- `seed_route` даёт объекту маршрут только если он непустой; при пустом маршруте согласование объекта идёт без подписантов — поведение согласования при этом определяется в UC модуля ОМ.
- Регламент изменения настроек (согласование правки, откат к предыдущей версии): `Не реализовано в коде` — откат делается новой правкой с причиной.
