# UX Discovery Extract — PersonnelStatus (учёт личного состава)

> Source scope: internal tool, Russian UI, priority = speed + data density.
> Sources read:
> - `docs/PersonnelStatus/PersonnelStatus.md` (PS) — primary concept doc, richest UX detail
> - `docs/PersonnelStatus/ПланРасстановка.md` (PR) — "Протокол ФТ", master document, ПланРасстановка domain
> - `docs/PersonnelStatus/Дополнение-к-ПланРасстановка.md` (PR-доп) — org rules, OMD/ORGD, замена, уведомления
> - `docs/PersonnelStatus/ТЗ VAPS.md` (TZ) — consolidated requirements, glossary, RBAC matrix, NFR, contradictions
> - `docs/PersonnelStatus/PROJECT_DOCUMENTATION.md` (PD) — implemented Django/Next.js models, screens, statuses
>
> NOTE on naming: The file literally named "ПланРасстановка.md" is the **functional-requirements Protocol** for the protective-operations side (objects, posts, events, "Расстановка" document). The day-to-day **PersonnelStatus** surface (учёт расхода ЛС) is documented mostly in `PersonnelStatus.md`. "Расстановка" here = the placement document of an охранное мероприятие, not a grid screen per se. Where a roster grid exists in PS, it is the **strength chart / mass status table** and the **division calendar** (§9, §19.5).

---

## 1. Roles / actors

### Access roles (RBAC) — PS §3, §16; TZ §3.1, Прил. Б
- **Руководство организации / Службы** (роль-1, наблюдатель организации) — sees расход across whole org, аналитика, своды; usually does NOT edit. Scope = ORGANIZATION. (PS §3.1, §16.2)
- **Руководитель департамента / наблюдатель департамента** (роль-2) — sees статусы of all управления/отделы in his department, индикаторы, своды по департаменту. Scope = DEPARTMENT. (PS §3.2, §16.3)
- **Руководитель управления / начальник отдела (оператор управления)** (роль-3) — **key daily user.** Daily status update, mass update, прикомандирование, add employee, download расход for OWN division. Scope = OWN_DIVISION. (PS §3.3, §3.4, §16.4)
- **Администратор организации** (роль-4) — full access: справочники, штатное расписание, учётные записи, роли, импорт, аудит. (PS §3.5, §16.5)
- **Наблюдатели** (generic) — view within scope, no edit. (PS §3.6)
- **Назначенные ответственные / получатели уведомлений** (роль-5, оператор центра уведомлений) — receive update/lag notifications, see which управления are behind; cannot edit статусы. (PS §3.7, §16.6)
- **Аудитор** (роль-6) — view history/audit/past documents only; no real-time current statuses. (PS §16.6)
- Scope values: `ORGANIZATION / DEPARTMENT / OWN_DIVISION / CUSTOM` (PS §16.7). One user may hold multiple roles with different scopes (e.g. observer of org + editor of own division).
- Roles are **dynamically created** by admin (права + scope), assignable/revocable/temporarily-deactivatable; all logged to audit. (PS §16.8)

### Operations-side roles (mostly out of PS-core, but adjacent — PR, TZ §3.1)
Старший объекта (ст. наряда), старший сектора/направления, ГАП СПС / брокер департамента, утверждающий руководитель, штабист.

### Daily duty roles (срочное полномочие на личную учётку — PR-доп §1, §6; TZ §3.3)
- **ОМД (Дежурный по мероприятиям)** — coordinator-of-day; ensures расход+расстановка for every ОМ of the day.
- **ОРГД (Дежурный по организации)** — read-only oversight of org-wide расход; назначает/двигает никого.
- Both are FLAGGED OPEN: PR-доп §1 / TZ OQ-1 — keep as separate roles or fold into «старший объекта + руководитель + дашборды»? Modeled as `DutyAssignment(user, role, 08:00→08:00 next day)`, rights auto-expire. **No shared logins** (personal accountability).

---

## 2. Core jobs / use cases

1. **Daily status update of a division** (the central recurring job) — оператор управления opens "страница управления", picks date (default today), sets each employee's статус, saves in ONE action ("массовое обновление"). (PS §9)
2. **Mark division as "updated" for a date** → division indicator goes green; notifies ответственные. (PS §9.5, §10)
3. **Plan statuses ahead** (отпуск months ahead, командировка, дежурство) via employee/division calendar; auto-apply on start date. (PS §8.2, §19)
4. **Generate & download "расход личного состава" (.docx)** for day / period / "на завтра". (PS §12–14)
5. **Monitor who updated / who is behind** via cascading дерево indicator. (PS §10)
6. **Прикомандирование / откомандирование workflow** (request → approve/reject → return request). (PS §11)
7. **View employee card** (full profile, status & transfer history, documents). (PS §6)
8. **Analytics/aналитика** — заполненность, статистика отсутствий, сравнение подразделений/дней. (PS §20)
9. **Audit / history review** — who set which status & on what basis (legal value). (PS §18)
10. **Manage справочники, штатное расписание, roles** (admin). (PS §5, §7, §16)
11. (Operations adjacency) Prepare охранное мероприятие → build **Расстановка** → approve → manage оперативные изменения / замена выбывшего. (PR §8; PR-доп §3)

---

## 3. Surfaces / screens

### Implemented Next.js pages (PD §Frontend)
- `/` — login with animation
- `/dashboard` — статистика по статусам, календарь событий, график статусов
- `/organization` — оргструктура + штатное расписание (tree view AND board-with-cards)
- `/employees` — управление сотрудниками
- `/statuses` — управление статусами (single + mass update)
- `/reports` — generate/download отчёты
- `/feedback` — обратная связь
- Features: `add-employee`, `edit-profile`, `employee-status-update` (одиночное + массовое), `organization-structure` (древо + доска), `secondment-requests`, `notifications` (dropdown), feedback chat. UI = shadcn/ui (Radix), light/dark theme.

### Страница управления — the core daily workspace (PS §9.1)
Shows: division name; date picker (default today, any date selectable); employee list as a **table**; "обновлено / не обновлено" indicator for the date; buttons: mass-update, add employee, download расход.
**Table columns (PS §9.2):** 1) № 2) ФИО 3) отдел (if present) 4) должность 5) статус на выбранную дату 6) комментарий/примечание.
- Откомандированные and прикомандированные employees render as **separate blocks below the main list**. (PS §9.2, §4.4)
- **Mass-update form (PS §9.3):** pick date (or range); per employee pick статус from dropdown; for special status enter start/end dates; optional comment; optional document-основание; save all at once. Leaving default «В строю» needs no extra fields.

### Дерево подразделений (PS §4.5, §10)
Org chart visualization; each node carries a status-update **indicator**; provides direct children / all descendants / path-from-root / subtree height / employee count.

### Карточка сотрудника (PS §6)
- **Full card:** фото 3×4, ФИО, дата рождения, пол, табельный №, должность, звание, подразделение, штатная единица, дата приёма/увольнения, служебный email/телефон, статус занятости (действующий/уволен), текущий статус + период, история переводов, история статусов, документы, отметка о прикомандировании.
- **List (сокращённая) card:** фото 3×4, ФИО, должность, текущий статус, подразделение. Sensitive fields (телефон, email, дата рождения, служ. комментарии, документы) HIDDEN in list view. (PS §6.3, §17.5)
- One card for whole system; blocks shown/hidden by viewer's rights; some fields excluded from printed docs even if visible on screen. (PR-доп §7)

### Календарь статусов (PS §19)
- **Employee calendar:** row "дни месяца"; per-day colored status mark; hover → details (тип, период, комментарий); marks Запланирован/Действующий/Завершён; highlights overlaps/anomalies; supports planning ahead.
- **Division calendar (сводный — §19.5):** horizontal = days, vertical = employees, cells = статусы, bottom summary rows «в строю», «на дежурстве», «в отпуске». Used for duty planning & load distribution. (This is the closest thing to a roster grid in PS-core.)

### Документ расхода (.docx) — output, not interactive screen (PS §12; see §8 below)

### ПланРасстановка / Расстановка (PR §8.4; TZ §9) — operations adjacency
The **Расстановка** is a document listing: ОМ name, posts, attracted groups, and named employees заступающие на ОМ. Draft auto-placement fields (VX): объект, сектор, пост, направление, старший, сотрудники, техника, оружие, спецсредства, времена прибытия/заступления/снятия, точка сбора, примечания. It is **not static** (refined as groups allocate people), versioned, has a history of changes, and is approved by a руководитель (optionally with ЭЦП). Дашборд готовности к мероприятию tracks its progress (PR §11.1).

---

## 4. Key data entities (+ key attributes)

- **Employee / Сотрудник** (PS §6.2; PD): табельный номер, ФИО, дата рождения, пол, ИИН, фото 3×4, звание, должность, подразделение, штатная единица, даты приёма/увольнения, служ./личн. email+телефон, employment_status (working/fired), is_active, archived_at, notes. Operational extension (VX): антропометрия/рост/телосложение, навыки, налёт часов, оружие/спецсредства/форма, знание объекта, рейтинг, ограничения.
- **Division / Подразделение** (PS §4; PD): name, code, division_type (organization/department/directorate/division), parent (MPTT — tree_id/level/lft/rght), is_active, order, archived_at, ответственный руководитель.
- **StaffUnit / Штатная единица (ставка)** (PS §5.1): division + position pair, index (№ в подразделении), 1:1 employee OR 1:1 vacancy, parent StaffUnit (own управление-tree, separate from division tree), активность, даты создания/упразднения.
- **Vacancy / Вакансия** (PS §5.2): staffing, статус (открыта/закрыта), требования, обязанности, даты открытия/закрытия, причина, инициатор, комментарий.
- **EmployeeStatus / Статус** (PS §8; PD): employee, status_type, state (planned/active/completed/cancelled), start_date, end_date, actual_end_date, comment, early_termination_reason, related_division (для прикомандирования), location (командировка/учёба), created_by, is_notified, auto_applied. Source: USER/KU_SYNC/OM_AUTO (TZ §7).
- **StatusType / Тип статуса** (PS §7.3): code, name, description, parent (иерархия / составной статус), requires_end_date, max_duration_days, default-flag, "исключает редактирование" flag, область видимости, color, sort_order/приоритет.
- **StatusHistory** (PS §8.10): тип CREATED/APPLIED/EXTENDED/TERMINATED/COMPLETED/CANCELLED/MODIFIED, было/стало, инициатор, дата-время, IP, комментарий.
- **Position / Должность** (PS §7.1): name, level (lower = higher), sort_order, активность, опц. тип подразделения. 20 baseline positions (Руководитель организации … Сотрудник 3 категории).
- **Rank / Звание** (PS §7.2): name, level, категория (мл./ср./ст./высш. начсостав).
- **Transfer / История перевода** (PS §6.4): сотрудник, из/в подразделение, дата, причина, тип, инициатор, документ, комментарий.
- **SecondmentRequest** (PS §11; PD): employee, from_division, to_division, start/end date, reason, status (pending/approved/rejected/cancelled), requested_by, approved_by, rejected_by, rejection_reason.
- **Report / ReportRequest** (PS §14; PD): report_type (personnel_roster/division_report/staffing_table/status_summary), format (docx/xlsx/pdf), division, date_from/to, filters JSON, job_id, status (pending/processing/completed/failed), file, error_message.
- **Notification** (PS §15; PD): recipient, notification_type, title, message, link, is_read, related_object, payload.
- **AuditLog** (PS §18): user, action, object, time, IP, before, after, comment.
- **Role / RoleAssignment / DutyAssignment** (PS §16; TZ §7): права + scope type; assignment to user; duty = (user, role, from/to time).
- Operations-adjacent (PR/VX): Object (паспорт), Post, Sector, Checklist, Group, Duty/DutyShift, Event (ОМ), Need (Потребность), Request, **Placement (Расстановка)** + PlacementHistory, Acquaintance (ознакомление), Incident, Load, Rating/Evaluation, FlightHours.

---

## 5. Statuses / states (ACTUAL enumerated values)

### Personnel status types — baseline (PS §8.1)
```
1. В строю              (статус по умолчанию)
2. На дежурстве
3. После дежурства
4. В командировке
5. Учёба
6. Соревнования
7. Конференция
8. В отпуске
9. Отпуск по рапорту
10. На больничном
11. Прикомандирован
12. Откомандирован
```
- «В строю» = default if no special status active for the date.
- Departments/управления/отделы may add own specific statuses; **составной статус** allowed (e.g. «На дежурстве + учёба после смены»).
- Implemented status hierarchy (PD): В строю; Отпуск → {Очередной, Учебный, Без содержания}; Больничный; Командировка; Учёба; Прикомандирован; Откомандирован.

### Status lifecycle states (PS §8.2; PD)
```
PLANNED   — Запланирован
ACTIVE    — Действующий
COMPLETED — Завершён
CANCELLED — Отменён
```
Auto-transitions (PS §8.4): 00:01 PLANNED(start=today)→ACTIVE; 00:15 ACTIVE(end<today)→COMPLETED. Operations: extend / terminate (досрочно) / cancel.

### Division update indicator states (PS §10.1)
```
Зелёный — обновлены полностью
Жёлтый  — обновлены частично
Красный — не обновлены
Серый   — не требует ежедневного обновления
```
Cascade bottom-up: управление green only when all its employees have a status for the date; департамент green only when all its управления green; организация green only when all departments+independent управления green. (PS §10.2)

### Other workflow states
- SecondmentRequest: pending/approved/rejected/cancelled.
- ReportRequest: В очереди (pending) / processing / Готов (completed) / Отменён (cancelled) / failed.
- Vacancy: открыта/закрыта. Employment: working/fired.

---

## 6. Domain terminology glossary (verbatim Russian)

- **Расход личного состава** — сводная картина занятости сотрудников Службы/СПС на конкретную дату ("где сейчас сотрудники").
- **Списочная численность (по списку)** — sum over statuses (no vacancies). **Штатная численность (по штату)** = по списку + вакансии. (PS §12.6)
- **Штатная единица / ставка** — pair "подразделение + должность", exists whether occupied or not.
- **Вакансия** — state of an unoccupied штатная единица.
- **Статус** — состояние сотрудника на момент времени.
- **В строю** — default available status.
- **Дежурство (БД)** — постоянная заранее планируемая служба; after a 24h shift → mandatory «отдых после дежурства» (employee unavailable). 
- **Прикомандирование** — employee temporarily works in non-staff division (counted with `+` in receiving unit). **Откомандирование** — employee sent out; status «Откомандирован», counted "по списку" not "в строю", and "исключает редактирование".
- **Индикатор обновления статусов** — per-division green/yellow/red/grey daily marker.
- **Массовое обновление** — set all employees' statuses for a date in one save.
- **Календарь статусов** — per-employee or per-division grid of statuses over days.
- **Документ расхода (.docx)** — official daily strength document (альбомный, казахский заголовок).
- **Объект** — постоянная сущность, место нахождения ОЛ, имеет паспорт.
- **Пост** — точка несения службы (наружный/внутренний, предельное время, требования).
- **Сектор** — зона ответственности из нескольких постов; старший сектора.
- **Чек-лист объекта** — контрольные вопросы проверки объекта перед ОМ.
- **Охранное мероприятие (ОМ)** — комплекс мер, planned anew per выезд ОЛ.
- **Расстановка** — document: ОМ name, posts, attracted groups, named employees заступающие.
- **Потребность** — calculated number of employees needed per СПС/group for an ОМ.
- **Группа** — специализированное подразделение (профиль, состав, численность, задачи).
- **Нагрузка** — accumulated занятость over a period; overload indicator.
- **Старший объекта (ст. наряда)** — responsible for prep & conduct of ОМ.
- **ГАП СПС / брокер** — people who distribute ЛС on request.
- **ОМД / ОРГД** — daily duty roles (per-ОМ / per-organization) — надстройка, validation pending.
- **ОЛ** — охраняемое лицо. **КУ / Кадровая система** — эталон сведений о сотрудниках; вход в систему. **ЭЦП** — электронная цифровая подпись расстановки.
- **Налёт часов** — accumulated hours on ОМ (date, ОМ, объект, пост, hours, смена, сложность, оценка).
- **Запланированный (обычный) статус** — default state an employee returns to (auto-return next day after ОМ ends). (PR-доп §4)

---

## 7. UX-affecting constraints

- **RBAC + scope everywhere** (PS §16, §17): user sees only divisions/employees/statuses/documents within scope; edit allowed only if: belongs to division by штат + has role + NOT in «Откомандирован»/restricting status. UI must hide/disable cross-division edits and gray out edit when user is in a restricting status.
- **Data sensitivity / minimal data** (PS §17.5, §24.5; NFR-8): телефон, email, дата рождения, служ. комментарии, документы hidden in list views, revealed only in full card per права; some fields never go to printed documents (PR-доп §7).
- **Audit / legal value** (PS §18; NFR-10): every data-changing action logged (who/what/object/time/IP/before/after); append-only, immutable via UI, permanent retention. Status changes have legal значение.
- **Cascade gating** (PS §10.3): «расход на завтра» download is BLOCKED until all required управления are green for tomorrow → show list of non-reporting управления + "send reminder" action. Past-date downloads not blocked.
- **Hierarchy depth & flexibility** (PS §4.1): 5 подчинённость variants (Орг→Деп→Упр→Отдел→Сотр and shorter chains; управление may bypass департамент; отдел may bypass управление). Two separate trees: division tree (MPTT) AND staff-unit (управление) tree.
- **Sorting rules in lists** (PS §4.4): by position level (lower=higher first), then by фамилия alphabetically; откомандированные as a separate bottom block; прикомандированные as a separate block below main staff.
- **Real-time** (PS §15; PD): in-app notification center + WebSocket push (closed-LAN only). PR-доп §5 + TZ C5: **only in-app** notifications on MVP (закрытый контур — no email/SMS/external channels), «колокольчик» with unread badge.
- **Async report generation** (PS §14; NFR-3/11): .docx generation seconds→minutes via Celery; user not blocked; request queue with statuses; reports retained ≥90 days.
- **Performance / data density**: internal tool — dense tables, the strength chart and division calendar must show many employees × statuses; .docx альбомная, fonts 16/12/8.
- **Output format constraint** (PS §12.2–12.3; CON-7): расход strictly .docx landscape; header in Kazakh `{Подразделение} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ {дата} ЖЫЛҒЫ`. Also .xlsx, .pdf, .csv alt exports.
- **Closed contour** (NFR-1/2/6): single server, LAN, no internet/cloud; modular monolith Django+DRF+Postgres, React/Vue front + Django Admin.
- **Localization** (NFR-13): UI Russian; one document header in Kazakh. Language set not fully specified (gap).
- **Validation density** (PS §9.4): on save, 10 checks (every employee has a status; period present for special; end≥start; within hire/dismissal dates; no overlap with other active statuses; ≤ max duration e.g. 45 days отпуск; user rights; not restricting status; штат membership). Errors must name the specific сотрудник + reason.
- **Offline tablet (future)** (NFR-16; PR-доп §9): tablet "читалка" of расстановка/lists + rating entry; server always master, tablet only appends facts after reconnect.

---

## 8. Notable existing UI / flow descriptions (layout detail)

### Документ расхода — table structure (PS §12.4) — drives the strength-chart mental model
Columns: 1) № строки 2) Название управления 3) по штату 4) по списку 5) вакантные 6) в строю 7) До дежурства 8) На дежурстве 9) После дежурства 10) В командировке 11) Учёба/соревнования/конференция 12) В отпуске 13) На больничном 14) Прикомандирован 15) Откомандирован. Each row = one управление (or отдел). Bottom **итоговая строка** bold = "Общее" + column sums.
- **Status cells (PS §12.5):** top = count; below = list "Фамилия И.О."; below = comment; below = period «с … по …». Receiving-unit списочная shown as `25 +2` (по списку + прикомандированные).
- Period export = one .docx, one table per date, new page each day.

### Daily-update flow (PS §9)
Open страница управления → choose date → table loads with current status per employee → "массовое обновление" → per-employee dropdown (+ dates/comment/document for special) → Save (all at once) → validations → on success: indicator → green, audit record, notify ответственные.

### Прикомандирование / возврат flow (PS §11.4–11.5)
Откомандирование: pick receiving unit by hierarchy (департамент → управление → отдел), fill from/to/dates/reason/initiator/document. Возврат: «Вернуть» button → request → notify receiving head → approve/reject → on approve, both statuses complete, employee editable again (usually «В строю»); on reject, give reason + expected return date.

### Замена выбывшего (PR-доп §3)
System AUTO-suggests next in the должностная chain (заместитель/и.о.) — strictly by position, only WITHIN same управление; manual replacement may widen to department level; else escalate up. Any расстановка member is replaceable.

### Dashboards (PR §11)
- **Готовности к мероприятию** — чек-лист passed? потребность approved? closed (all groups allocated)? ознакомились? final расстановка approved?
- **Нагрузки на людей** — for начальники подразделений: who is overloaded / needs unloading.
- **Общего расхода ЛС** — where everyone is on any date.

### Notification types (PS §15.2)
STATUS_APPLIED/UPCOMING(−7д)/ENDING(−3д)/COMPLETED/TERMINATED/EXTENDED/CANCELLED; DIVISION_UPDATED/PENDING; SECONDMENT_* ; REPORT_READY/FAILED; ROLE_ASSIGNED; SYSTEM_ALERT.

---

## 9. Open questions / contradictions (flagged, not invented)

- **C1 — статус ownership/list:** PS owns 11 baseline statuses; PR §3.1/BS says long statuses (отпуск/больничный/командировка/учёба/соревнования/при-/откомандирование) belong to **КУ** (kadровая система), VAPS only owns БД/отдых/ГЭВ/operational. → Priority PR. Affects whether status fields are editable in PS or read-only synced.
- **C5 — notification channels:** PS §15/§23 lists in-app + push + email + SMS; closed contour (BS Ось F / PR-доп §5) → **in-app only** on MVP. UI must not promise email/SMS.
- **C7 / OQ-12 — PS purpose redefinition:** PS doc = daily расход system; BS «Стратегический пересмотр» reframes PS = **Talent & Performance**, moving statuses + расход.docx to operations. Significant scope question for what "PersonnelStatus surface" even covers.
- **C10 / OQ-7 — при-/откомандирование owner:** PS models the workflow in PS; PR §3.1 treats them as КУ statuses. Ownership unresolved.
- **OQ-1 / PR-доп §1 — ОМД/ОРГД roles:** keep as distinct roles or fold into «старший объекта + руководитель + дашборды»?
- **PR-доп §10 open Qs:** (2) is «отдых после дежурства» an absolute edit/assign block or a soft-override conflict like others? (3) предельное время на посту by weather/season — manual each time or справочник? (4) "опрос по итогам мероприятия" procedure undesigned.
- **C9 — stack:** PD/PS describe Next.js/shadcn/TanStack; BS/TZ NFR-15 mandate React/Vue + Django Admin, single server. The implemented frontend (PD) is Next.js — so the *as-built* UI uses shadcn/ui; the *target* per TZ is looser. Relevant for which component system the DESIGN.md should align to.
- **NFR-13 gap:** UI language set not formally fixed (Russian UI + Kazakh document header only).
- **Gaps:** G4 max status durations unspecified (only "e.g. 45 days отпуск"); G5 date format in расход header «принятый в организации» unspecified; G6 роль-5/6 exact rights TBD.
- **Naming caution:** "ПланРасстановка.md" is the FT Protocol (operations domain), while the PersonnelStatus *grid*-like surfaces are §9 strength table and §19.5 division calendar — confirm with stakeholder which "расстановка" the PersonnelStatus UX is meant to cover (daily strength roster vs ОМ placement document).
