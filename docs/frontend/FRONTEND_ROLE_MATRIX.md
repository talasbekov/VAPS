# FRONTEND_ROLE_MATRIX

Demo persona → реальный набор permission-кодов → область видимости → временные полномочия.

Persona — `mock-only-demo` runtime-переключатель (`app/mocks/demo-runtime.ts`), НЕ отдельная auth-модель: переключение вызывает существующий `AuthContext.login()` с demo-credential, права по-прежнему приходят через `['me']` (usePermissions). Коды прав ниже — рабочий проект реестра Smart Josparlau; вводятся по мере реализации Этапа 2+, каждый — с owner-feature в `FRONTEND_MOCK_API_CONTRACT.md`.

| Persona (demo) | Роль домена | Permission codes (актуально) | Scope | Временные полномочия |
|---|---|---|---|---|
| event_planner | Организатор ОМ (штаб) | ops.dashboard.view, ops.security_event.view, ops.security_event.create, ops.bulletin.manage, ops.demand.manage, ops.placement.manage, ops.acknowledgement.manage, ops.conduct.manage, ops.closure.manage, ops.dictionary.view, ops.calendar.view | своё управление | — |
| recon_officer | Офицер рекогносцировки | ops.security_event.view, ops.recon.manage, ops.dictionary.view, ops.calendar.view | назначенные ОМ | — |
| broker | Брокер сил (распределение) | ops.force_request.view, ops.force_allocation.manage, ops.dictionary.view | по запросам своей группы | — |
| placement_approver | Утверждающий расстановку | ops.placement.view, ops.placement.approve, ops.dictionary.view | своё управление | — |
| omd_temp | Сотрудник с временными полномочиями ОМД | ops.security_event.view, ops.assignment.replace (ВРЕМЕННО, TemporaryPermissionGrant) | конкретное ОМ, на время его проведения | да — не постоянная роль (D6) |
| objects_admin | Ведение объектов/паспортов/дежурств/справочников/рассмотрение боевых групп | ops.object.view, ops.object.manage, ops.passport.publish, ops.duty.view, ops.duty.manage, ops.duty.override_rest, ops.duty.approve_plan, ops.combat_group.review, ops.dictionary.view, ops.dictionary.manage, ops.calendar.view | свои объекты | — |
| combat_department_chief | Начальник боевого управления (§24.5-24.6, §24.19-24.23, §24.21) | ops.duty.view, ops.combat_group.submit, ops.combat_group.acknowledge, ops.combat_group.checkin, ops.combat_group.complete, ops.combat_group.replace, ops.dictionary.view | своё управление | — |
| analyst | Аналитика/дашборды/экспорт | ops.analytics.view, ops.export.run, ops.dictionary.view, ops.calendar.view | по scope должности | — |
| admin | Полный доступ (эталон) | `*` (wildcard, как существующий admin) | всё | — |

## Правила
- Permission-коды выше — рабочий план; при реализации каждой стори код фиксируется в `FRONTEND_MOCK_API_CONTRACT.md` и проверяется дважды: на UI (скрытие) и в mock-repository (реальный отказ 403/422) — запрет §35 «проверять права только скрытием кнопки».
- Смена persona обязана: (1) `queryClient.removeQueries(['me'])` через существующий `login()`, (2) сброс feature-кэшей, зависящих от видимости, (3) редирект на корректный стартовый экран новой persona.
- Персональные данные предыдущей persona не должны быть видны после переключения — проверяется тестом на каждую granted-then-revoked операцию.

## Статус
Реализовано: все коды выше реально проверяются в соответствующих `mocks/repository.ts` (permission-check + 403 на отказ), не только на UI — `event_planner`/`recon_officer`/`broker`/`placement_approver` (Этап 2+3), `objects_admin` (Этап 5, +duties Этап 7, +dictionaries Этап 8), `analyst` (Этап 7).

`ops.dictionary.view` (§30, Этап 8) добавлен ВСЕМ non-admin persona выше — частичная реализация «все авторизованные видят разрешённые справочники» в рамках существующего каталога persona (см. FRONTEND_DECISIONS A43); `ops.dictionary.manage` — только `objects_admin` (тематически ближайший текущий владелец: паспорта/дежурства) и `admin`.

`ops.calendar.view` (§25, Этап 9) добавлен `event_planner`/`recon_officer`/`objects_admin`/`analyst` — ролям, уже читающим хотя бы один из композируемых источников календаря (`ops.security_event.view` или `ops.duty.view`) или владеющим аналитикой (`analyst`, прецедент A33/A34); `broker`/`placement_approver` не получили — ни один из их существующих кодов не связан с дежурствами/ОМ-расстановкой напрямую. **Важно**: `ops.calendar.view` НЕ отменяет проверку `ops.duty.view`/`ops.security_event.view` внутри `CalendarPage` — persona с `ops.calendar.view`, но без одного из двух прав (`objects_admin` без `ops.security_event.view`, `analyst` без обоих), видит честный частичный/пустой список с явным объяснением, а не ошибку (см. FRONTEND_DECISIONS A47).

**Известный пробел**: `placement_approver` имеет `ops.placement.approve`, но НЕ `ops.security_event.view` — route guard реестра/детали ОМ требует `ops.security_event.view`, поэтому эта persona физически не может открыть карточку ОМ, чтобы согласовать расстановку. Не проверено, задумано ли это как «approve делается из отдельного экрана-очереди» (Not started) или это упущенный код — не чинить вслепую, уточнить перед Этапом 6. Для ручного end-to-end прогона всего жизненного цикла одной persona использовать `admin` (wildcard).

`ops.combat_group.submit`/`ops.combat_group.review` (§24.5-24.10, по запросу «боевые группы на Трассе») — новая persona `combat_department_chief` подаёт состав; `objects_admin` рассматривает (тематически ближайший текущий владелец плана дежурств, тот же принцип, что `ops.dictionary.manage`). Оба права проверяются в `features/duties/mocks/repository.ts` (403 на отказ), не только скрытием формы/кнопок на UI.

`ops.combat_group.acknowledge`/`checkin`/`complete` (§24.19-24.23, по запросу «Полный §24 боевых групп», FRONTEND_DECISIONS A52) — все три у `combat_department_chief` (начальник управления ведёт исполнение своей же группы от подачи до факта, тот же принцип, что `submit`, ответственность не передаётся `objects_admin`/центральному оператору). Все три проверяются в `mocks/repository.ts` (403 на отказ).

`ops.combat_group.replace` (§24.21, по запросу «Продолжение §24», FRONTEND_DECISIONS A53) — у `combat_department_chief` (тот же принцип: замена участника своей группы — ответственность начальника управления, не передаётся `objects_admin`). Проверяется в `mocks/repository.ts` (403 на отказ).

`createCombatDutyShift` (§24.1, по запросу «Продолжение §24», FRONTEND_DECISIONS A54) — новое право не заводилось, использует существующий `ops.duty.manage` (`objects_admin`): тот же владелец, что общий план дежурств, формирует и потребность на боевые смены. Проверяется в `mocks/repository.ts` (403 на отказ).

Архив дела закрытого ОМ (`/security-events/:id/archive`, Этап 27) НОВОГО права не вводит: гейт — тот же `ops.security_event.view`, что у карточки. Обоснование — архив ничего не открывает сверх того, что читатель карточки уже видит (все данные дела он же и накапливал по стадиям); отдельный код права разошёлся бы с этим фактом. Мутаций у экрана нет вовсе, поэтому `ops.conduct.manage`/`ops.closure.manage` там не проверяются.

Публикация версии паспорта (Этап 28) НОВОГО права не вводит: мутация — за существующим `ops.object.manage` (тот же владелец, что правит паспорт), чтение опубликованной версии по deep link — за `ops.object.view` (версия не открывает ничего сверх объекта).

`ops.duty.override_rest` (§21.34, Этап 32, FRONTEND_DECISIONS A64) — у `objects_admin`, рядом с `ops.duty.manage`, но ОТДЕЛЬНЫМ кодом: §21.34 требует, чтобы обход мягкого конфликта шёл «с обоснованием и отдельным permission», а право планировать дежурства это не то же самое, что право обойти обязательный отдых. Проверяется в `mocks/repository.ts` (403 на отказ, покрыто repository.test.ts). Создание дежурства (§21.31) и списки формы (объекты/кандидаты) НОВЫХ прав не вводят: мутация — за существующим `ops.duty.manage`, чтения — за `ops.duty.view`.

`ops.duty.approve_plan` (§21.27, Этап 38, FRONTEND_DECISIONS A70) — у `objects_admin`,
рядом с `ops.duty.manage`, но ОТДЕЛЬНЫМ кодом: планировать смены и утверждать
получившийся месяц — разные роли (тот же принцип, что `ops.placement.approve` у
расстановки ОМ). Тем же правом открывается новая редакция утверждённого плана: закрыть
план вправе только тот, кто его закрыл. У persona есть оба права, чтобы демо-сценарий
проходился целиком; РАЗДЕЛЕНИЕ проверяется тестами репозитория (планировщик получает 403
на утверждение и на переоткрытие) и красной пробой.

`personnel.identity.reveal` и `personnel.identity.audit` (§20.27/§20.28/§20.33, Этап 39,
FRONTEND_DECISIONS A71) — два РАЗНЫХ права, и ни одно не выводится из права видеть
карточку (`status.view`). `reveal` есть только у `admin` (wildcard); `audit` выдан
`analyst` вместе со `status.view` — контролёр видит карточку и журнал обращений, но
раскрыть идентификатор не может. Обратное тоже верно и покрыто тестом: раскрывающий не
видит журнала. Разделение демонстрируется живым e2e-сценарием под persona `analyst`.

`ops.report.generate` и `ops.report.export_sensitive` (§22.26/§20.32, Этап 40,
FRONTEND_DECISIONS A72) — два разных права. `generate` выдан `analyst` (запуск отчётов —
его работа); `export_sensitive` НЕ выдан никому, кроме `admin` (wildcard): на этом
разделении держится демонстрация §20.32 «sensitive export является отдельной операцией».
Право на скрытые поля проверяется дважды — при создании работы и ПОВТОРНО при скачивании
артефакта, потому что его могли отозвать после генерации.

`ops.report.view_foreign_parameters` (§22.26 «просмотра параметров чужого отчёта», Этап 42,
FRONTEND_DECISIONS A74) — третье право того же раздела. Право ЗАПУСКАТЬ отчёты даёт видеть,
что коллега что-то выгружал; период и режим его выгрузки — следующий шаг, и промпт называет
его самостоятельным разрешением. Своя работа доступна всегда — разрешение нужно ровно на
чужую. Никому, кроме `admin` (wildcard), не выдано: на разделении `admin` ↔ `analyst`
держится демонстрация. Оно НЕ заменяет `export_sensitive` — sensitive-работа остаётся
невидимой (404) и тому, у кого есть право на чужие параметры; покрыто тестом repository.

