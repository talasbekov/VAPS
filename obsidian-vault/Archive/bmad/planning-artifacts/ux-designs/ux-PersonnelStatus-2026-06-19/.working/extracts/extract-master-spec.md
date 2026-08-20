# UX Discovery Extract — PersonnelStatus surface
Source: `docs/PersonnelStatus/VAPS_7.8.2.md` (VAPS Master Spec v7.8.2 Strict-Audit, 8565 lines).
Scope: PersonnelStatus-relevant UX (учёт личного состава, статусы, ежедневный расход, календари, расстановка-adjacent). Russian terms kept verbatim. Section citations in `[§N.M]` form.

> Note on relevance: VAPS is one system spanning Personnel Records (учёт ЛС) + VisitX (ОМ/события/расстановка) + Accreditation. The **PersonnelStatus** surface = §28.1 items 2–11 + supporting calendars, statuses, daily report/expense, employee profile, detachment. Event/assignment/conduct screens are documented here too because they share entities (employee, status, division) and the same UX-rules (RBAC, conflict modals, audit) — flagged as VisitX-adjacent where they are out of PersonnelStatus core.

---

## 1. Roles / actors and permissions

Seed roles `[§4.2 / DB-OPS-001]`:
`ADMIN, ORGD, OMD, SENIOR_COORDINATOR, APPROVER, DIVISION_OPERATOR, VIEWER, INTEGRATION_USER`.

Seed permissions `[§4.2]`:
`admin.roles, status.manage, status.view, assignment.create, assignment.delete, assignment.submit, assignment.return, assignment.approve, brokerage.manage, daily_report.generate, daily_report.mark_update, daily_report.correct, object.manage, event.manage, duty.manage, audit.view`.
Plus `employee.sensitive.view` `[§45.5 BR-PRIVACY-002]`.

Role → permission seed `[§4.2]`:
| role | permissions |
|---|---|
| ADMIN | all (`*`) |
| OMD | assignment.create, assignment.delete, assignment.submit, daily_report.generate, brokerage.manage |
| SENIOR_COORDINATOR | assignment.create, assignment.delete, assignment.submit |
| APPROVER | assignment.return, assignment.approve |
| DIVISION_OPERATOR | daily_report.mark_update, daily_report.correct, status.view |
| ORGD | audit.view, daily_report.generate |
| VIEWER | GET/read-only |
| INTEGRATION_USER | status.manage (sync/import) |

Scope rules `[§37.2]`:
- PERM-SCOPE-001 Division operator sees only own division subtree.
- PERM-SCOPE-002 OMD sees operational events/assignments in assigned scope.
- PERM-SCOPE-003 ORGD views daily reports + audit in assigned scope.
- PERM-SCOPE-004 Temporary duty permission adds permissions **only inside time window** (`ops_temporary_duty_permissions` §17.20; expires via `expire_temporary_permissions` job §32.2).
- PERM-SCOPE-005 Admin sees all scopes.

Auth `[§29]`: External JWT only; VAPS stores **no** passwords. RBAC + audit key on external `user_id` (string), never `core_employees.id` `[ARCH-007/008, BR-ACCOUNT-001/002]`. Account↔employee link only via `core_user_employee_bindings`. Errors `401 AUTH_REQUIRED / TOKEN_INVALID`, `403 PERMISSION_DENIED / USER_INACTIVE`.

Domain role refs (not RBAC roles): **ОМД** (отдел мероприятий/operations dept), **ОРГД** (organizational dept), **КУ** (кадровое управление — owns `is_ku_owned` statuses, `KU_SYNC` source), **HQ/штаб** (conduct journal), **старший** (event senior).

---

## 2. Core jobs / use cases (PersonnelStatus)

System purpose `[§1]`: учёт личного состава, статусы сотрудников, ежедневный расход личного состава, планирование дежурств, охранные мероприятия, расчёт сил и средств, расстановка по объектам/секторам/постам, контроль конфликтов/недоступности/перегрузки, формирование документов, аудит.

Core PersonnelStatus jobs:
1. **Maintain personnel records** — employee CRUD with rich profile, division history, staffing slots, vacancies `[§28.1, §45]`.
2. **Manage employee statuses** — create/extend/terminate/cancel; status history; basis documents `[§4.2 DB-OPS-007, §17.15]`.
3. **Bulk status update** — division operator sets a status for many employees during расход prep, with PREVIEW/STRICT/PARTIAL modes `[§31]`.
4. **Daily personnel expense (ежедневный расход)** — operator updates statuses, marks division updated, OMD generates report `[§30.8, §5, E2E-001]`.
5. **Daily report generation** — one date + period, DOCX/XLSX/PDF, priority-matrix one-status-per-employee `[§5 BR-001/002, §34, §47, §77]`.
6. **Status calendar** — per employee and per division `[§17.15, §57]`.
7. **Daily submission (сдача дня)** — division explicitly submits day as atomic snapshot, versioned `[§82.1]` (newest delta, story 1.12).
8. **Detachment/attachment** — откомандирование/прикомандирование with return requests `[§17.16]`.
9. **Absence analytics** — compare/trend absences, list unupdated divisions `[§58]`.

VisitX-adjacent (share entities, out of PersonnelStatus core): event prep, need calc, resource requests, assignment versions + conflict detector, acknowledgements, replacement, conduct dashboard, HQ journal, incidents, closure, archive `[§28.1 items 12–32]`.

---

## 3. Surfaces / screens

### 3.1. Pages inventory `[§30.2 pages/]`
DashboardPage, DailyExpensePage, EmployeesPage, EmployeeCardPage, DivisionsPage, ObjectsPage, ObjectCardPage, EventsPage, EventCardPage, AssignmentVersionPage, ConductDashboardPage, ReportsPage, AdminPage, AuditPage, NotificationsPage.

### 3.2. Routes `[§30.3]`
| Route | Page | Permission |
|---|---|---|
| `/login` | external login/token | public |
| `/` | Dashboard | authenticated |
| `/daily-expense` | Daily personnel expense | `daily_report.generate` or `status.view` |
| `/daily-expense/:date` | Daily report detail | same |
| `/employees` | Employee list | `status.view` |
| `/employees/:id` | Employee card | `status.view` |
| `/divisions` | Division tree | `status.view` |
| `/objects` | Object list | `object.manage` or read-only |
| `/objects/:id` | Object card | object read |
| `/objects/:id/passport` | Object passport | `object.manage` |
| `/events` | Event list | `event.manage` or assignment read |
| `/events/:id` | Event card | event read |
| `/events/:id/reconnaissance` | Reconnaissance | `event.manage` |
| `/events/:id/need` | Need calculations | `event.manage` |
| `/events/:id/requests` | Resource requests | `brokerage.manage` |
| `/assignment-versions/:id` | Assignment version | assignment read/create |
| `/events/:id/conduct` | Conduct dashboard | HQ/OMD/ORGD |
| `/events/:id/closure` | Closure report | `event.manage` |
| `/reports` | Documents/reports | report/document read |
| `/notifications` | Notifications | authenticated |
| `/admin/roles` | Roles & permissions | `admin.roles` |
| `/admin/import-export` | Import/export jobs | admin/integration |
| `/audit` | Audit log | `audit.view` |

### 3.3. Dashboard `[§30.5]`
Shows: today (Asia/Qyzylorda); unupdated divisions count; active events count; events requiring readiness action; pending acknowledgements; unresolved conflicts; open incidents; pending documents; latest notifications.
Widgets (source API → action): Daily update status (`/api/analytics/daily-personnel-expense` → open daily expense); Event readiness; Open incidents; Pending acknowledgements; Recommendations (`/api/analytics/recommendations`).

### 3.4. Employees page `[§30.6, §45.7]`
Columns: Full name (clickable) · Personnel number · IIN (masked unless permission) · Photo/avatar (permission-based) · Rank · Position · Division (current) · Current status (calc for today) · Status period (starts/ends) · Hire date (perm) · Phone/Work phone/Work email (role/perm-based) · Attached/detached marker (`ATTACHED / DETACHED / ATTACHED_PLUS`) · Actions (role-dependent).
Filters: division; status; rank; position; active/inactive; attached/detached; text search by name/IIN.
Actions: open card; create status; bulk select; export selected; view calendar.

### 3.5. Employee card `[§30.7]`
Tabs: 1 Overview · 2 Status history · 3 Calendar · 4 Assignments · 5 Duties · 6 Documents · 7 Load · 8 Audit.
Overview fields: FIO; IIN masked by default; rank; position; division; staffing slot; current status; phone; active flag; attached/detached state.
Role-based sensitive fields: full IIN; phone; documents; incident history; rating aggregate.

### 3.6. Daily expense page `[§30.8]` — main screen for division operators
Layout: 1 Date picker · 2 Division tree filter · 3 Update marks panel · 4 Employee status table · 5 Bulk status toolbar · 6 Report generation panel · 7 Missing marks list · 8 Export buttons DOCX/XLSX/PDF.
Table columns: № · Employee (FIO + rank) · Position · Current status (resolved) · Planned status (if future/planned) · Period (starts_at–ends_at) · Basis documents (count + link) · Last updated by · Actions (create/terminate/cancel status).
Bulk toolbar: set status; set period; attach basis documents; preview affected employees; apply; mark division as updated.

### 3.7. Divisions page `[§30.3]` — division tree (`/divisions`); division calendar `[§57]` (see §9).

### 3.8. Objects page `[§30.9]` (VisitX-adjacent)
List columns: object name; address; importance level; passport completeness; active posts count; last verified date; active events count; actions.
Object card tabs: Passport · Sectors and posts · Checklist templates · Reconnaissance history · Events · Incidents/risk history · Documents · Audit.

### 3.9. Event card `[§30.10]` (VisitX-adjacent)
Tabs: Overview · Bulletin · Reconnaissance · Need calculations · Resource requests · Assignment versions · Acknowledgements · Conduct dashboard · Incidents · Closure · Archive · Documents · Timeline.
Header: title; status; date/time; object(s); senior; readiness percent; unresolved conflicts; pending acknowledgements; open incidents. Status-transition buttons shown only if user has permission AND transition guard allows.

### 3.10. Assignment version page `[§30.11]` (VisitX-adjacent)
Panels: 1 Version status banner · 2 Assignment table (grouped by object/sector/post) · 3 Conflict panel · 4 Resource allocation panel · 5 Add individual assignment form · 6 Add group assignment form · 7 Submit/return/approve actions · 8 Print/export.
Table columns: Object · Sector · Post · Employee (rank+FIO) · Division (historical/current) · Role · Start (local) · End (local) · Conflicts (badges) · Acknowledgement (PENDING/ACK/DECLINED) · Actions (edit/delete/replace where allowed).

### 3.11. Conduct dashboard page `[§30.12]` (VisitX-adjacent)
Shows: active objects/posts; seniors; current assignments; replacements; protected-person timeline (if available); incidents; HQ journal; logistics/accreditation stubs if enabled.
Actions: add journal entry; create incident; register replacement; mark event started/completed; open closure report.

### 3.12. Admin import/export page `[§30.13]`
Tabs: Import employees / positions / ranks / staffing slots · Export data · Job history.
Each import: file upload; strict/partial mode switch; preview rows; validation result; start import; job progress; downloadable error report.

### 3.13. Global UI states (every page) `[§30.4, §75.3]`
Loading; Empty; Error; Permission denied; Validation errors display; Unsaved-changes warning; audit-sensitive confirmation modal for destructive actions; **server conflict modal for 409 SOFT_CONFLICT_DETECTED**; **hard-block modal for 422 HARD_UNAVAILABLE_STATUS**; **locked-version banner for 423 ASSIGNMENT_VERSION_LOCKED**; readonly mode if view-only; server-driven pagination/filtering; optimistic update only where rollback safe.

---

## 4. Information architecture

- Sidebar shows only modules available by role `[FE-AC-003]`; feature flags hide MVP-2/Future nav items in MVP-core `[FE-ARCH-004]`.
- Top-level nav (from routes): Dashboard → Daily expense → Employees (→ Employee card) → Divisions (tree/calendar) → Objects (→ card → passport) → Events (→ card → reconnaissance / need / requests / conduct / closure) → Assignment versions → Reports → Notifications → Admin (roles, import-export) → Audit.
- Module relationships (bounded contexts) `[§2.2]`: `core` (orgs, divisions, employees, division history, staffing slots, account↔employee bridge) · `operations` (statuses, daily expense, objects/posts, ОМ, requirements, duties, brokerage, assignment, conflicts) · `analytics` (workload/aggregates/recommendations, read-only) · `audit` (append-only) · `documents` (templates, generation queue, archive) · `notifications` (in-app).
- Isolation `[§2.3]`: no microservices in MVP; no cross-context FK (flat UUID/VARCHAR); cross-context reads only via selectors/services.
- Canonical ОМ flow `[BR-EVENT-002]`: объект → бюллетень → рекогносцировка → потребность → запрос сил → распределение → расстановка → ознакомление → проверка конфликтов → утверждение → проведение → закрытие → архив.

---

## 5. Key data entities + key attributes

- **core_employees** `[DB-CORE-004 + §45.2]`: id, external_id, iin(12 digit), full_name, last_name/first_name/middle_name, personnel_number(unique), birth_date, photo_file_path, hire_date/dismissal_date, rank_code, rank_index, position_code, division_id, phone/work_phone/work_email/personal_phone/personal_email, gender(M/F), height_cm(120–230), notes, is_active, is_attached_force, employment_status (`WORKING/FIRED/ARCHIVED`), separated_at, data_source(default STUB). full_name = `{last} {first} {middle}` if parts present `[BR-EMP-001]`.
- **core_employee_division_history** — employee_id, division_id, starts_at, ends_at(nullable=current); no overlapping intervals; current division must match ends_at IS NULL row `[DB-CORE-005]`.
- **core_user_employee_bindings** — user_id ↔ employee_id `[DB-CORE-006]`.
- **core_division_historical_slots** — division_id, allocated_slots, valid_from/valid_to → drives STAFF_TOTAL `[DB-CORE-007]`.
- **core_positions / core_ranks / core_staffing_slots / core_employee_staffing_assignments / core_vacancies** `[§17.1]`.
- **ops_employee_statuses** `[DB-OPS-007]`: employee_id, status_type_code, state_code(default PLANNED), source_code, starts_at, ends_at, reason. starts_at < ends_at.
- **ops_employee_status_history** `[DB-OPS-032]`: status_id, action_code (`CREATED/APPLIED/EXTENDED/TERMINATED/COMPLETED/CANCELLED/MODIFIED`), old/new_value, actor_user_id, comment.
- **ops_status_types** `[DB-OPS-002/003]`: code, name, priority, is_hard_block, is_operational, report_column_code, is_ku_owned, counts_in_list, counts_in_staff.
- **ops_status_type_scopes** `[DB-OPS-043]` — division/org scope + is_required_basis_document.
- **ops_status_display_rules** `[DB-OPS-044]` — composite status display (primary+secondary → display_code/name).
- **ops_daily_personnel_reports / _items / _item_details** `[DB-OPS-013, DB-OPS-045]` — report_date, version_number, status_code, generated_by; items per division/column with count; item_details per employee (display_name, rank_name, position_name, period, reason, basis_documents_count, display_order).
- **ops_daily_update_marks** `[DB-OPS-013]` — report_date, division_id, mark_type (`INITIAL/CORRECTION`), updated_by; unique(date,division,type).
- **ops_daily_submissions** (delta, story 1.12) `[§82.1]` — division_id, business_date, version, is_current, submitted_by, submitted_at, snapshot JSONB (interval facts), change_kind (`CONFIRMED_NO_CHANGES/CHANGED`). One is_current per (division, business_date).
- **ops_employee_detachments** `[DB-OPS-033]` — employee_id, from/to_division_id, status_code (`PLANNED/ACTIVE/RETURN_REQUESTED/COMPLETED/CANCELLED`), basis_document_id.
- **ops_employee_return_requests** `[DB-OPS-034]` — status_code (`PENDING/APPROVED/REJECTED/CANCELLED`).
- **ops_objects / sectors / posts** `[DB-OPS-005]` — post requirements JSON: min_height_cm, gender, min/max_rank_index, required_position_codes, allow_overqualification.
- **ops_events** `[DB-OPS-008/022]`, **ops_assignment_versions / ops_assignments / ops_conflicts** `[§4.2]` (VisitX-adjacent).
- **analytics_workload_daily** `[§4.3]` — employee_id, date, total_hours, night_hours, weekend_hours.
- **documents_report_requests** `[§4.4]` — kind (DAILY_REPORT/ASSIGNMENT), format (DOCX/XLSX/PDF), status (QUEUED/GENERATING/READY/FAILED/CANCELLED).
- **notifications_messages** `[§4.5]` — recipient_user_id, type_code, title, body, entity_type/id, is_read.
- **audit_logs** `[§4.6]` — actor_user_id, action, entity_type/id, old/new_value, reason, ip_address, user_agent.
- **core_sensitive_field_policies** `[DB-CORE-013]` — field_code, permission_code, mask_strategy (`FULL_HIDE/PARTIAL_MASK/ALLOW`).

---

## 6. Statuses / states (enumerated value sets)

### 6.1. ops_status_types seed `[DB-OPS-003]` (priority / hard_block / report_column)
| code | priority | hard_block | report_column |
|---|---:|---|---|
| SICK_LEAVE | 10 | true | SICK |
| LEAVE_BY_REPORT | 15 | true | VACATION |
| VACATION | 20 | true | VACATION |
| COMMAND (командировка) | 30 | true | COMMAND |
| STUDY | 32 | false | TRAINING |
| COMPETITION | 34 | false | TRAINING |
| CONFERENCE | 36 | false | TRAINING |
| DETACHED (откомандирован) | 40 | false | DETACHED |
| ATTACHED (прикомандирован) | 50 | false | ATTACHED (counts_in_staff=false) |
| REST_AFTER_DUTY | 60 | false | AFTER_DUTY |
| BEFORE_DUTY | 65 | false | BEFORE_DUTY |
| DUTY (дежурство) | 70 | false | ON_DUTY |
| GEV | 75 | false | ON_DUTY |
| EVENT_ASSIGNMENT | 80 | false | IN_SERVICE |
| IN_SERVICE (в строю) | 999 | false | IN_SERVICE |
| ATTACHED_PLUS | — | — | (for is_attached_force=true; +N) |

MVP default hard-block set `[BR-003]`: SICK_LEAVE, LEAVE_BY_REPORT, VACATION, COMMAND. Deployment can set all `is_hard_block=false` (all-soft+override model) `[OQ-007]`.

### 6.2. Status state machine `[§4.2 DB-OPS-004]`
`ops_status_states`: **PLANNED → ACTIVE → COMPLETED**, plus **CANCELLED**.
Auto-transitions via Celery `[§32.4/32.5]`: `activate_planned_statuses` (PLANNED→ACTIVE when starts_at≤now); `complete_expired_statuses` (ACTIVE→COMPLETED when ends_at≤now). System actor `SYSTEM`, writes history.

### 6.3. Status sources `[DB-OPS-004]`: USER, KU_SYNC, DUTY_AUTO, ASSIGNMENT_AUTO.

### 6.4. Report columns `[§5.2.1]`: STAFF_TOTAL, LIST_TOTAL, VACANCIES, IN_SERVICE, SICK, VACATION, COMMAND, TRAINING, DETACHED, ATTACHED, ATTACHED_PLUS, BEFORE_DUTY, ON_DUTY, AFTER_DUTY, OTHER. DOCX labels (RU) `[§77.3]`: №, Подразделение, Штат, Список, Вакансии, В строю, Больничный, Отпуск, Командировка, Учёба/мероприятия, Откомандирован, Прикомандирован +N, Прикомандированные силы +N, Перед дежурством, На дежурстве, После дежурства, Иное, Примечание.

### 6.5. Other state sets
- ops_daily_report_statuses: DRAFT_INCOMPLETE, FINAL, CORRECTION `[DB-OPS-004]`.
- ops_assignment_version_statuses: DRAFT(unlocked), RETURNED(unlocked), SUBMITTED(locked), APPROVED(locked) `[DB-OPS-004]`.
- ops_request_statuses: SENT, ALLOCATED, REJECTED, CANCELLED; ops_allocation_statuses: PROPOSED, CONFIRMED, REJECTED; ops_duty_plan_statuses: DRAFT, APPROVED.
- ops_assignment_roles: SENIOR_GUARD, SECTOR_SENIOR, POST_GUARD, RESERVE, GROUP_REINFORCEMENT.
- ops_post_types: FIXED, MOBILE, CHECKPOINT, RESERVE.
- ops_event_statuses (lifecycle) `[DB-OPS-021]`: DRAFT, BULLETIN_CREATED, PREPARATION, SENIOR_ASSIGNED, RECONNAISSANCE, WAITING_CALCULATIONS, CALCULATIONS_PARTIAL, CALCULATIONS_COMPLETED, REQUIREMENTS_APPROVED, REQUESTS_SENT, ALLOCATIONS_IN_PROGRESS, ASSIGNMENT_DRAFT, ON_APPROVAL, RETURNED, APPROVED, READY, IN_PROGRESS, COMPLETED, WAITING_CLOSURE, CLOSED, ARCHIVED, CANCELLED.
- Detachment statuses: PLANNED, ACTIVE, RETURN_REQUESTED, COMPLETED, CANCELLED `[DB-OPS-033]`. Return-request: PENDING, APPROVED, REJECTED, CANCELLED.
- employment_status: WORKING, FIRED, ARCHIVED `[§45.2]`.

---

## 7. Domain terminology glossary (RU verbatim)

- **Личный состав** — personnel; **учёт личного состава** — personnel records/accounting.
- **Ежедневный расход личного состава** — daily personnel expense (the headcount report of who is present/absent and why).
- **Расход** — the expense/headcount document/figure derived from statuses.
- **Сдача дня** — daily submission: division explicitly submits the day as an atomic snapshot `[§82.1]`. Real mode is «за день вперёд» (a day ahead) до 17:00.
- **Подразделение** — division/unit; **leaf-подразделение** — leaf division (lowest org unit whose headcount is counted).
- **Штат / Список / Вакансии** — staff establishment / list (filled) / vacancies. STAFF_TOTAL = allocated slots; LIST_TOTAL = STAFF_TOTAL − VACANCIES.
- **В строю** — in service / on the line (IN_SERVICE — default if no other status).
- **Статус сотрудника** — employee status (one of §6.1).
- **Больничный** (SICK), **Отпуск** (VACATION/LEAVE_BY_REPORT = отпуск по рапорту), **Командировка** (COMMAND), **Учёба/мероприятия** (STUDY/COMPETITION/CONFERENCE → TRAINING).
- **Откомандирован / Прикомандирован** — detached (sent away, stays in own list as DETACHED, not IN_SERVICE) / attached (received from elsewhere, shown as `ATTACHED +N`, not in receiving staff count) `[BR-DETACH-001/002]`.
- **Прикомандированные силы** — attached forces from another department (`is_attached_force=true` → ATTACHED_PLUS) `[DB-CORE-004 decision]`.
- **Дежурство / На дежурстве / Перед/После дежурства** — duty / on duty (DUTY) / before-after duty (BEFORE_DUTY, REST_AFTER_DUTY).
- **Дежурный** дежурный план — duty plan; **проекция дежурства** — duty projection (duty shift → DUTY + REST_AFTER_DUTY statuses) `[BR-017]`.
- **ОМ / охранное мероприятие** — security/protection event.
- **Объект / сектор / пост** — object / sector / post (guard placement targets).
- **Паспорт объекта** — object passport (with completeness RED/YELLOW/GREEN).
- **Рекогносцировка** — reconnaissance.
- **Расчёт сил и средств / потребность (need)** — force calculation / need calculation.
- **Расстановка / назначение** — assignment / placement; **версия расстановки** — assignment version.
- **Брокеридж / запрос сил / распределение (аллокация)** — brokerage / resource request / allocation.
- **Ознакомление** — acknowledgement (assigned employee confirms).
- **Замена / каскадная замена** — replacement / cascade replacement (after approval).
- **Конфликт** — conflict (double assignment, duty overlap, rest violation, workload, post-requirement, overqualification).
- **Старший** — senior (event senior/коор-р). **Штаб (HQ) / журнал штаба** — HQ / HQ journal. **Инцидент** — incident.
- **Основание / основной документ / осн. док.** — basis / basis document (justifies a status, e.g. рапорт for отпуск).
- **Отметка обновления (INITIAL/CORRECTION)** — update mark (division marks day ready / corrected).
- **КУ (кадровое управление)** — HR/personnel directorate (owns `is_ku_owned` statuses, KU_SYNC source).
- **ОМД / ОРГД** — operations dept / organizational dept (roles). **ЭЦП** — digital signature (future). **ИИН** — individual ID number (12 digits, masked).
- **Звание / должность / штатная ставка (слот)** — rank / position / staffing slot.
- **Рапорт** — formal written report (basis for LEAVE_BY_REPORT).

---

## 8. UX-affecting constraints

### 8.1. RBAC matrix `[§37.1]`
| Module | View | Mutate | Admin |
|---|---|---|---|
| Employees | status.view | status.manage | admin.roles |
| Daily expense | daily_report.generate or status.view | daily_report.mark_update, daily_report.correct | admin.roles |
| Objects / passport | read-only / object read | object.manage | admin.roles |
| Events / Recon / Need | event read | event.manage | admin.roles |
| Resource requests | event read | brokerage.manage | admin.roles |
| Assignments | assignment read | assignment.create/delete/submit | admin.roles |
| Approval | assignment read | assignment.return, assignment.approve | admin.roles |
| Incidents | event read | event.manage or HQ duty | admin.roles |
| Reports | report read | daily_report.generate | admin.roles |
| Documents | document read | document owner | admin.roles |
| Import/export | integration read | integration role | admin.roles |
| Audit | audit.view | none | admin.roles |
| Roles | none | none | admin.roles |

### 8.2. Privacy / masking `[§45.5]`
Sensitive fields: iin, photo_file_path, work/personal phone+email, birth_date, notes, documents, incident_history, rating_aggregate. IIN masked by default in lists & exports `[BR-PRIVACY-001]`; full IIN needs `employee.sensitive.view` `[BR-PRIVACY-002]`; photo excluded from printable assignment forms `[BR-PRIVACY-003]`; sensitive export writes audit `[BR-PRIVACY-004]`. DOCX masking: `****** + last 4 digits` `[§77.5]`. DOCX never exposes full IIN/photo/rating/health diagnosis/sensitive comments `[DOCX-AC-005]`.

### 8.3. Audit `[§4.6, FE-ARCH-003]`
All mutations + document downloads + sensitive exports audited. Status changes also write separate `ops_employee_status_history` `[BR-STATUS-HISTORY-001]`. All destructive actions require confirmation modal with audit-sensitive warning text. HQ journal & archive immutable.

### 8.4. Real-time / WebSocket `[§54.2, §82.4]`
MVP-core notifications: **IN_APP only** `[§33.1]`; SMS/email/Telegram/external push forbidden in MVP-core. Optional WebSocket support possible `[§54.2 DB-NOTIF-002]`. Long ops contract `[§82.4]`: POST → `202 {job_id}` → poll `GET /api/jobs/{id}` → terminal status; **WS is accelerator, polling is source of truth** (WS types IMPORT_COMPLETED/FAILED, REPORT_READY/FAILED).

### 8.5. Performance / density
Internal, data-dense tool. Tables: server-driven pagination/filtering `[§75.3]`. Daily-report cell name cap `DAILY_REPORT_CELL_MAX_NAMES=20` then `... ещё {N}` `[DOC-DAILY-CELL-004]`. Division calendar = employees(rows) × days(cols) grid `[§57.1]`. Scheduled recalcs: readiness every 15 min, workload hourly, event readiness every 10 min `[§32.2]`.

### 8.6. Validation & errors `[§36, §75.2 FE-ARCH-002]`
Single error shape: `{error_code, message, details, request_id, timestamp}`. Every mutation must handle: 400 VALIDATION_ERROR; 401 AUTH_REQUIRED/TOKEN_INVALID; 403 PERMISSION_DENIED/USER_INACTIVE; 409 SOFT_CONFLICT_DETECTED / MARKS_INCOMPLETE / NOT_READY / CHECKLIST_ISSUES_UNRESOLVED / HASH_MISMATCH; 422 HARD_UNAVAILABLE_STATUS / TEMPLATE_DATA_MISSING; 423 ASSIGNMENT_VERSION_LOCKED. override_reason 10–500 chars `[BR-003]`. Timezone everywhere: `Asia/Qyzylorda` (`VAPS_LOCAL_TIMEZONE`) `[§3]`.

### 8.7. Daily report logic constraints `[§5]`
- One status per employee per report_date via priority matrix: min `ops_status_types.priority` wins; tie → status_type_code ASC then starts_at ASC; none → IN_SERVICE `[BR-001]`.
- Sources: ops_employee_statuses (ACTIVE/PLANNED) + approved ops_assignments only; duty shifts projected, not read directly.
- Staffing balance `[BR-002]`: Σ presence/absence cols (excl ATTACHED/ATTACHED_PLUS) = LIST_TOTAL; ATTACHED/ATTACHED_PLUS rendered as `+N`, excluded from numerator.
- FINAL report needs INITIAL mark from every leaf division in scope `[BR-DAILY-MARK-001]`; correction needs only the corrected division's CORRECTION mark `[BR-DAILY-MARK-002]`.

---

## 9. Concrete UI / interaction specs

### 9.1. Bulk status update `[§31]`
Modes: **PREVIEW** (no DB write, same validation, returns per-employee can_apply + errors), **STRICT** (any error rolls back all → 201 on success), **PARTIAL** (valid applied, invalid returned → 207). Request: division_id, employee_ids[], status_type_code, state_code, starts_at, ends_at, reason, basis_document_ids[], mode. Duplicate employee_ids → 400 DUPLICATE_EMPLOYEE_ID. Scope checked vs user's division perms. Toolbar flow `[§30.8]`: set status → set period → attach basis docs → preview affected → apply → mark division updated.

### 9.2. Conflict / block UX `[§30.4, §38, §75.3]`
- Soft conflict (409) → **override modal** requiring override_reason `[FE-AC-011]`. Soft codes: DOUBLE_ASSIGNMENT_CONFLICT, DUTY_OVERLAP_CONFLICT, REST_VIOLATION_CONFLICT, WORKLOAD_EXCEEDED_CONFLICT, POST_REQUIREMENT_MISMATCH_CONFLICT, OVERQUALIFICATION_DETECTED `[BR-003]`. Status overlap soft → 409 STATUS_OVERLAP_WARNING `[BR-STATUS-CONFLICT-003]`.
- Hard block (422) → non-overridable message `[FE-AC-012]`; status overlap with hard → 422 OVERLAPPING_HARD_STATUS `[BR-STATUS-CONFLICT-002]`.
- Locked version (423) → disable edit/delete + locked banner `[FE-AC-013]`.
- Generate-report button disabled if marks incomplete; missing marks visible before generation `[FE-AC-005/006]`.

### 9.3. Status / visual coding
- Object passport completeness: **RED / YELLOW / GREEN** badge on object list `[FE-AC-008]`.
- Daily submission traffic-light (трёхцветный) `[§82.1]`: submitted-and-matches / submitted-but-drifted (drift shown) / not submitted.
- ATTACHED / ATTACHED_PLUS rendered as `+N` in cells `[DOC-DAILY-CELL-003]`.
- Attached/detached marker column: ATTACHED, DETACHED, ATTACHED_PLUS `[§30.6]`.
- Conflicts shown as badges in assignment table; acknowledgement state PENDING/ACK/DECLINED `[§30.11]`.

### 9.4. Calendars `[§57, §17.15]`
Division calendar two views: **Table** (rows=employees, cols=days, cell=status badges/duty/assignment/replacement) and **Summary** (rows=status columns, cols=days, cell=count+drilldown). Cell can show multiple badges if composite display applies `[CAL-AC-002]`. Employee calendar built from statuses + approved assignments + duty projections + replacements `[FE-AC-007, BR-STATUS-CALENDAR-001]`. APIs: `/divisions/{id}/status-calendar-grid` and `/status-calendar-summary?date_from&date_to`.

### 9.5. Daily report DOCX cell `[§47.3, §77.4]`
Each status cell: `{count}` then numbered short list `1) {rank_short} {FIO_short} — {period}, {reason}`. Basis-doc marker `[осн. док.: N]` if count>0. Truncation `... ещё {N}` past cap; full list in appendix. XLSX has separate `Details` sheet. DOCX: A4 landscape, 10mm margins, Times New Roman 9pt base.

### 9.6. Notifications `[§33]`
IN_APP. PersonnelStatus-relevant events: `DAILY_MARK_MISSING` (09:00, → /daily-expense, WARNING, repeat daily), `DAILY_MARK_ESCALATION` (11:00, → OMD/ORGD, CRITICAL), `REPORT_READY`/`REPORT_FAILED` (→ /reports/{id}), `IMPORT_COMPLETED`/`IMPORT_FAILED`, `TEMP_PERMISSION_ACTIVE`/`EXPIRED`. User can mark one read and all read (own only) `[FE-AC-019, NOTIF-AC-004]`.

### 9.7. Detachment / attachment UX `[§17.16]`
In home division employee shows DETACHED (stays in list, not IN_SERVICE); in receiving division shows `ATTACHED +N` (not in receiving staff count). Return confirmation completes DETACHED/ATTACHED statuses. Attached employee cannot edit statuses unless given a role `[BR-DETACH-004]`.

### 9.8. Frontend acceptance criteria (FE-AC-001…020) `[§38]`
Auth redirect; 403 page; role-filtered sidebar; bulk update; missing marks visible; generate disabled if incomplete; employee calendar shows all overlays; passport RGY on list; event header readiness/blockers; recon ISSUE blocks READY; soft→override modal; hard→non-overridable; locked→disabled; senior sees unacknowledged; HQ shows active posts/incidents; incident can't close without final decision; download-before-ready shows NOT_READY; import preview row-level errors; notif read-one/all; audit hidden without audit.view.

---

## 10. Open questions / contradictions

1. **Document priority / versioning** `[§0]`: master doc is authoritative; new changes only as delta-patches; on conflict the **later** section wins (§0/§44–81). So §45–82 overrides §4/§30 where they collide.
2. **DailySubmission vs daily marks/report** `[§82.1]`: spec explicitly leaves OPEN (decided in E5) whether `ops_daily_submissions` absorbs `ops_daily_update_marks` (could become derived) or they coexist — flagged to avoid a second source of truth. This is the biggest live ambiguity for the daily-expense UX (marks vs submission snapshot).
3. **BEFORE_DUTY projection** `[BR-001, BR-017]`: reserved, NOT projected in MVP until customer decides.
4. **STAFF_TOTAL when no historical slots** `[BR-002.1]`: STAFF_TOTAL=0, report flagged warning (not error) unless strict staffing required — UI must surface warning state.
5. **Hard-block model is deployment-configurable** `[OQ-007, §46.3]`: all statuses can be made soft+override; `AUTO_COMPLETE_LOWER_PRIORITY_STATUS` and `AUTO_GENERATE_PERSONNEL_NUMBER` default false — UX must not assume fixed hard/soft behavior.
6. **Permission for bulk status** `[§31.2]`: "`status.manage` or `daily_report.mark_update` depending on deployment policy" — ambiguous which one; affects who can bulk-update.
7. **Composite status display** `[§46.2]`: calendar may show composite (DUTY+STUDY etc.) but daily report still counts one — potential UX confusion between calendar and report counts.
8. **Stack** `[§30.1 vs §75.1]`: §30.1 lists React **or** Django+HTMX as alternatives; §75.1 finalizes React+TS+Vite+TanStack Query+React Router+AntD/shadcn as default. Legacy Next.js (Personnel Records) only as migration/reference `[FE-STACK-002]`.
9. **Ratings (rating_aggregate, min_rating)** are MVP-2 `[§28.2]`; rating never auto-blocks assignment, only warns `[BR-RATING-005]` — but employee card lists "rating aggregate" as a (sensitive) field; visibility rules `[BR-RATING-003/004]` need UI resolution.
10. **AsyncJob vs documents_report_requests** `[§82.4]`: open whether document generation migrates to generic `jobs_async` or stays — affects reports/jobs UI polling contract.

### Absences (not specified — flag, do not invent)
- No visual design system / color palette / spacing tokens beyond AntD/shadcn choice and RED/YELLOW/GREEN + 3-color submission light.
- No explicit mobile/responsive spec (mobile app is Future scope `[§28.3]`).
- No keyboard-shortcut / accessibility (a11y) spec.
- No empty-state copy, microcopy, or icon set defined.
- No explicit sort spec for employee/daily tables beyond report ordering rules.
- Divisions page (`/divisions`) layout under-specified beyond "Division tree".
- Reports page (`/reports`) layout not detailed (only that it lists documents/generated reports).
