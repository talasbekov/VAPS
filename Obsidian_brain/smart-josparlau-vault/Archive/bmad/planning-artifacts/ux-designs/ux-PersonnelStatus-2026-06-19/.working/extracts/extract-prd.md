# UX Discovery Extract — PersonnelStatus (PS / учёт личного состава)

Source corpus: PRD + addendum + 3 reconciliation docs under
`_bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/`.
Scope: only PersonnelStatus-relevant UX. VisitX/Accreditation excluded except where
they touch PS. Surface is an **internal tool** (speed + data density), language **Russian**.

Citation key: `prd` = prd.md, `add` = addendum.md, `rec-ps` = reconcile-personnelstatus.md,
`rec-tz` = reconcile-tz-specs.md, `rec-audit` = reconcile-reconciliation-audit.md.

---

## 1. Roles / actors

From `prd §2.1` (JTBD) and `prd §4.9` (RBAC). Roles relevant to PS:

- **Руководство организации** — leadership. Needs a correct, real-time picture of personnel
  expenditure (расход ЛС) and load; decides on data, not phone calls. Downloads the official
  Расход document. (`prd §2.1`, `prd §4.5`)
- **Оператор управления (начальник отдела)** — the daily operator. Updates statuses of his
  people each morning with minimal actions and is confident the свод reconciles. Primary daily
  user of PS. (`prd §2.1`, UJ-1)
- **Старший направления / брокер департамента** — receives requests for people, allocates
  specific employees while seeing their availability and load. (`prd §2.1`) — touches PS via
  status/availability data.
- **Сотрудник** — the individual; learns his post/tasks/shift, confirms acknowledgement
  (ознакомление). In PS context: subject of statuses; status calendar view. (`prd §2.1`)
- **Аудитор / контролирующий орган** — reconstructs who/when/why made any decision via the
  immutable Audit. (`prd §2.1`, `prd §4.10`)
- **Администратор** — manages org tree, staffing slots, dictionaries, roles. (`prd §4.1`,
  `prd §4.9`, `prd §4.11`)
- **Наблюдатель** — read-only role. (`prd §4.9 FR-33`)

RBAC role set: наблюдатель, оператор, администратор, аудитор + service operations roles;
8 roles / 17 permissions seeded in target backend. (`prd §4.9 FR-33`, `add §6`)
**Open:** specific permissions of роль-5 (назначенный ответственный) and роль-6 (аудитор) are
an unresolved question. (`rec-tz M-4 / G4`)

Operations-only roles (Старший объекта, ОМД, ОРГД, Штабист, etc.) are Operations actors; they
interact with PS mainly by reading/writing statuses (assignment → OM_AUTO statuses).

## 2. Core jobs / use cases (goals)

Driven by the four user journeys (`prd §2.3`):

- **UJ-1 Утреннее обновление** — operator opens a **mass-update form for today**, marks
  deviations from «В строю» (e.g. two on больничный, one in командировке), saves in **one
  action**. His division indicator turns green; the org-wide свод recalculates. (`prd §2.3`,
  FR-12)
- **UJ-2 Расход для руководства** — leader downloads the `.docx` расход for today by 09:00. If
  any required division has not updated (red indicator), the system **blocks generating Расход
  «на завтра»** and shows who is lagging. (`prd §2.3`, FR-17/FR-18)
- Maintain the **employee card** (kadrovy + operativny blocks), transfer history, archive on
  dismissal. (`prd §4.1` FR-3/FR-4)
- Create / extend / early-complete / cancel **statuses** as intervals; never leave an empty
  status. (`prd §4.2` FR-7/FR-8/FR-9)
- **Прикомандирование / откомандирование** — temporary move between divisions via paired
  statuses; return flow. (`prd §4.4`)
- View **status calendar** per employee (month, colored) and per division (employees × days).
  (`prd §4.10` FR-37)
- Browse the **immutable Audit** (filter by object/user/type/period). (`prd §4.10` FR-36)
- Read **dashboards** (расход, lagging divisions, load/overload). (`prd §4.10` FR-38)
- Manage **dictionaries** (status types with is_hard_block/color/priority, positions, ranks,
  reasons, etc.) and settings (Необходимые управления, контрольный час). (`prd §4.11` FR-39)
- **Import/export** employees, transfer/status histories, audit log to `.csv/.xlsx`; reports
  «штатное расписание», «сводка по статусам». (`prd §4.11` FR-40)

## 3. Surfaces / screens (explicit or implied)

- **Mass status-update form** — single form, single save, date or date-range; pre-fills «В
  строю» for unspecified employees. Core daily screen. (FR-12, UJ-1)
- **Update indicator / «светофор» view** — cascading traffic-light over the division tree;
  aggregates up; shows lagging divisions. (FR-13, Глоссарий)
- **Employee card** — kadrovy block (фото, ФИО, табельный №, должность, звание, подразделение,
  даты приёма/увольнения, контакты) + operativny block (антропометрия, допуски, оружие,
  гражданская форма, знание объектов, Налёт часов); transfer history; blocks shown by rights.
  (FR-3)
- **Employee / staffing lists** — sorted by position level then surname; seconded employees in
  separate blocks at the bottom. (FR-5)
- **Status create/edit** — interval (period, comment, document-basis); lifecycle controls
  (extend / early-complete / cancel). (FR-7, FR-8)
- **Расход ЛС document generation screen** — day / period / «на завтра»; async generation;
  primary `.docx`, also `.xlsx/.pdf/.csv`; «завтра» blocked by red indicators. (FR-17, FR-18)
- **Status calendar** — per-employee (month with status colors) and per-division (employees ×
  days grid). (FR-37) — density-heavy grid.
- **Audit log viewer** — filterable, read-only, no edit/delete in UI. (FR-36)
- **Dashboards (MVP, basic)** — OM readiness, расход, load/overload, lagging divisions.
  (FR-38)
- **Notifications center** — in-app, unread marker, real-time via WebSocket. (FR-35)
- **Org tree / staffing admin** — manage divisions (FR-1), staffing slots/vacancies (FR-2).
- **Dictionaries / settings admin** — Django Admin used for dictionaries. (FR-39, `add §1`)
- **Прикомандирование/откомандирование flow screens** — initiate, confirm receipt, return.
  (FR-14/15/16; receipt-confirmation step noted only in historical doc — `rec-ps B3`)
- **Import/export & reports** — csv/xlsx exports; штатное расписание / сводка по статусам
  reports (the latter two flagged as gaps — `rec-tz M-3`).

Note: PRD states "**один портал с ролевыми экранами, без деления на модули**" — single portal,
role-driven screens, no module split visible to user. (`prd §1`)

## 4. Key data entities (+ key attributes)

(`prd §3` Глоссарий, `prd §4`, `add §2`, `add §8`)

- **Сотрудник (Employee)** — kadrovy block (фото, ФИО, табельный №, должность, звание,
  подразделение, даты приёма/увольнения, контакты) + operativny block (антропометрия, допуски,
  владение оружием, гражданская форма, знание объектов, Налёт часов). Core = UUID PK. VAPS is
  the source of truth until КУ exists. (FR-3, `add §2`)
- **Подразделение (Division)** — org-tree node; Организация → Департамент → Управление →
  Отдел; flexible hierarchy, level-skipping allowed. Attrs: type, parent, ответственный,
  активность. (FR-1)
- **Штатная единица / ставка (Staffing slot)** — Подразделение + Должность; holds exactly one
  Сотрудник or a Вакансия. Vacancies = all slots − occupied. (FR-2)
- **Статус (Status / EmployeeStatus)** — interval state (start–end date, type, comment,
  document-basis, **source = USER / KU_SYNC / OM_AUTO**); lifecycle PLANNED → ACTIVE →
  COMPLETED/CANCELLED; exactly one active status per date; default «В строю». One table for
  operational + HR statuses. (FR-6/FR-7, `add §2`)
- **Расход ЛС** — official summary document of personnel distribution by status on a date;
  primary `.docx`. Columns: № | Управление | По штату | По списку | Вакансии | В строю | На
  дежурстве | После дежурства | В командировке | Учёба/соревнования/конференция | В отпуске |
  На больничном | Прикомандирован | Откомандирован. Cell = count + list (Фамилия И.О.) +
  comment + period. Formulas: Штат = Список + Вакансии; Список = Σ статусов; Прикомандированные
  = «+N» separately. (FR-17, `add §8`)
- **Индикатор обновления** — cascading traffic-light aggregated up the division tree. Colors:
  зелёный (updated), жёлтый (deadline near / partial), красный (not updated by control hour),
  серый (update not required). **Необходимые управления** = configurable list of divisions
  obliged to update by контрольный час. (Глоссарий, FR-13)
- **Налёт часов** — cumulative actual hours on posts (day/night shifts); source = post-OM
  survey. (Глоссарий, FR-32; survey mechanism is a gap — `rec-ps A2`, `rec-audit №1`)
- **Прикомандирование / Откомандирование** — paired temporary-move statuses; seconded counted
  «+N» to receiving division, stays «по списку» of home division. (Глоссарий, FR-14)
- **Аудит (AuditLog)** — append-only: актор, тип, объект, время, IP, было/стало. (Глоссарий,
  FR-36)
- **Дежурное полномочие (ОМД/ОРГД)** — temporary role on personal account, auto-on/auto-off by
  time. (Глоссарий, FR-34)

Operations entities (Объект/Паспорт/Пост/Сектор/Дежурство/ОМ/Потребность/Расстановка/Группа/
Брокер/Физнаряд) are Operations-scoped; relevant to PS only because Дежурство and ОМ
assignments auto-generate statuses (OM_AUTO) and feed нагрузка/Налёт часов.

## 5. Statuses / states

**Personnel status lifecycle** (`prd §4.2`): PLANNED → ACTIVE → COMPLETED / CANCELLED.
- create with start_date > today → PLANNED; auto PLANNED→ACTIVE and overdue ACTIVE→COMPLETED by
  scheduled jobs (00:01 activate, 00:15 complete), logged AUTO_APPLY/AUTO_COMPLETE. (FR-7,
  FR-41)
- extend (new end), early-complete (actual date ≤ today), cancel (PLANNED only). (FR-8)
- on completion of a special status → return to next PLANNED for that date, else «В строю».
  (FR-9). **Gap:** Дополнение says return should be to the employee's *запланированный
  (обычный) статус*, not necessarily «В строю», triggered on the day after OM confirmation.
  (`rec-ps A4`)

**Base status types** (FR-6, extensible via dictionary): В строю, На дежурстве, После дежурства,
В командировке, Учёба, Соревнования, Конференция, В отпуске, Отпуск по рапорту, На больничном,
Прикомандирован, Откомандирован.
- **Hard-block types** (is_hard_block → 422): отпуск, больничный, командировка, отпуск по
  рапорту. Others → 409 warning + override with history. (FR-11)
- **Missing/named-in-master statuses:** ГЭВ (группа экстренного выезда) and roles like дежурный
  по КХО are in master but not in PRD seed/OQ. (`rec-ps A5`)
- **BEFORE_DUTY** — auto-projected interval before a duty; duration is an open question; not
  named in FR-20 body. (`rec-audit №6`, `prd §8`)
- **Составные статусы** (e.g. «На дежурстве + учёба после смены») — in historical doc, future.
  (`rec-ps B5`)

**Update-indicator states** (Глоссарий): зелёный / жёлтый / красный / серый.

**Workflow states:** прикомандирование (request → confirm receipt → finish pair on return);
SECONDMENT_REQUEST / SECONDMENT_APPROVED / SECONDMENT_REJECTED in historical doc. (`rec-ps B3`)

## 6. Domain terminology glossary (Russian, verbatim — drives Voice & Tone)

- **Сотрудник** — person on staff; card with kadrovy + operativny blocks. (`prd §3`)
- **Подразделение** — org-hierarchy node (Организация → Департамент → Управление → Отдел).
- **Штатная единица (ставка)** — «Подразделение + Должность»; one Сотрудник or Вакансия.
- **Вакансия** — open staffing slot («все ставки − занятые»).
- **Статус** — interval state of a Сотрудник; lifecycle PLANNED → ACTIVE → COMPLETED/CANCELLED;
  one active per date.
- **Расход ЛС** — official summary of personnel distribution by status on a date; `.docx`.
- **Индикатор обновления** — cascading traffic-light of status freshness up the division tree.
- **Необходимые управления** — configurable list of divisions obliged to update by контрольный
  час.
- **Контрольный час** — control hour by which required divisions must update (e.g. 09:00).
- **В строю** — default «on duty / in formation» status.
- **На дежурстве / После дежурства / Отдых** — on-duty / after-duty / mandatory rest.
- **В командировке, Учёба, Соревнования, Конференция, В отпуске, Отпуск по рапорту, На
  больничном** — status types.
- **Прикомандирован / Откомандирован** — seconded-in / seconded-out (paired temporary-move
  statuses).
- **Прикомандирование / Откомандирование** — the secondment processes.
- **Налёт часов** — accumulated actual hours on posts (day/night shifts).
- **Списочная численность / по списку** — roster headcount.
- **По штату** — establishment (authorized) headcount.
- **Свод** — the consolidated summary that must reconcile.
- **Сходимость свода** — reconciliation of the summary (formulas balance without manual edits).
- **Аудит** — immutable append-only action journal (кто, что, когда, IP, было/стало).
- **КУ** — external HR system (Phase 2); owner of long HR statuses; MVP stub `integration_ku`.
- **Дежурное полномочие** — urgent role grant on personal account, auto on/off by time.
- **ОМД** — дежурный по ОМ (duty officer for OM).
- **ОРГД** — дежурный по организации (org duty officer; read-only, not in escalation).
- **RBAC scope** — ORGANIZATION / DEPARTMENT / OWN_DIVISION / CUSTOM.
- **source (статуса)** — USER / KU_SYNC / OM_AUTO.
- **Ограничивающий статус** — status that restricts editing rights (base = «Откомандирован»;
  configurable per historical doc). (`rec-ps B4`, FR-16)
- **Боевой расчёт подразделений** — term in the master title; content undefined, open question.
  (`rec-tz H-2`, `rec-audit №3`)

(Operations terms — Объект, Паспорт, Пост, Сектор, Дежурство, ОМ, Потребность, Расстановка,
Группа, Брокер, Физнаряд, Штабист, Допнаряд — listed in `prd §3` but out of PS scope.)

## 7. UX-affecting constraints

- **Single portal, role-driven screens, no visible module split.** (`prd §1`)
- **Internal closed-contour tool:** one server on closed LAN, no internet/cloud. Speed + data
  density over polish. (`prd §10`, brief)
- **RBAC on every request:** token, role, scope, restricting user status. Sensitive fields
  hidden by default; visibility by rights. Some card fields are visible on screen but must NOT
  appear in printed documents. (`prd §4.9`, `prd §10`, `rec-ps A9`)
- **One-click bulk operations:** mass update one form/one save; one-click force-logout of all
  sessions + role revocation. (FR-12, `prd §10`)
- **Real-time:** in-app notifications via **WebSocket** (MVP requirement, confirmed 2026-06-10);
  no email/SMS in closed contour. Notifications center with unread marker. (FR-35, `add §4 R1`)
- **Cascading indicator** must aggregate up the tree and visibly flag laggards; drives
  blocking behavior. (FR-13, FR-18)
- **Blocking UX:** Расход «на завтра» cannot be generated while any required division is red;
  past-date расход always available. (FR-18)
- **Async document generation** (seconds–minutes) — needs progress/queue UX; reports must avoid
  N+1 (perf). (`prd §10`, `add §5`)
- **Density:** status calendar (employees × days grid), expense doc (14 columns), employee
  lists with seconded blocks at bottom — high information density expected. (FR-37, `add §8`,
  FR-5)
- **Localization:** UI Russian; Расход header in Kazakh («{Подразделение} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ
  ТІЗІМІ {дата} ЖЫЛҒЫ»). Doc: landscape, fonts 16/12/8, bold total row. (`prd §10`, `add §8`)
- **Audit everywhere:** every significant action logged immutably incl. file downloads; no
  edit/delete via UI. (FR-36, `prd §10`)
- **Conflict/override UX:** hard-block (422) vs warning (409 + override with mandatory history
  capture). Override must be visibly recorded. (FR-11)
- **Offline:** explicitly out of scope for MVP (offline tablets = future). (`prd §6.2`)
- **No legal-significance wording captured** though sources call расход/расстановка/аудит
  "юридически значимый" — a tone gap. (`rec-tz L-1`)
- **Restricting status:** «Откомандирован» employee loses status-edit rights everywhere
  (view-only). (FR-16)

## 8. Notable existing UI / flow descriptions

- **UJ-1 (mass update):** open form for today → mark deviations → one save → indicator green →
  свод recalculates. (`prd §2.3`)
- **UJ-2 (расход):** by 09:00 download `.docx`; red indicator blocks «на завтра» and shows
  laggards. (`prd §2.3`)
- **Расход document layout** is fully specified (columns, cell content, formulas, fonts,
  orientation, periods) — `add §8`. This is the closest thing to a concrete UI/output spec for
  PS.
- **Status calendar** — month per employee (colored), grid per division. (FR-37)
- **Secondment flow:** initiate (home division picks receiving) → paired statuses; return:
  request → receiving-side confirm → finish both → return to current status. Receipt-confirmation
  step on creation exists only in historical doc (gap). (FR-14/15, `rec-ps B3`)
- **Scheduled-job behavior** users will perceive: 00:01 activate PLANNED, 00:15 complete ACTIVE,
  reminders 7 days before start and 3 days before end (FR-41 — but note the 7/3 wording is a
  likely error: source says 7 days before *start*, 3 before *end* — `rec-ps B1`).
- No mockups/wireframes present in these docs; UI is described at capability level only.
  Detailed field/validation contracts live in VAPS_7.8.2 (not in this corpus). (`prd §0`)

## 9. Open questions / contradictions (across these docs)

PS-relevant items:

- **Daily Marks entity (OQ-4):** расход is computed from a status snapshot — fragile on
  retrospective edits; should there be a dedicated daily-mark entity? (`prd §8`, `add §5`)
- **BEFORE_DUTY duration & projection (OQ-3):** decided to auto-project, but FR-20 body omits
  it; duration fixed vs per-duty-type unresolved. (`prd §8`, `rec-audit №6`)
- **Reminder rule wording (FR-41):** PRD says "7 and 3 days before *end*"; source says 7 before
  *start* (STATUS_UPCOMING), 3 before *end* (STATUS_ENDING) — likely typo. (`rec-ps B1`)
- **«До дежурства» column:** BEFORE_DUTY status exists but the column is missing from the
  expense contract in `add §8`. (`rec-ps B2`)
- **Rest-after-duty hardness contradiction:** Glossary/FR-20 say «недоступен для любого
  назначения» (absolute), but the arbitrated decision (Q1) is soft-warning + override (409);
  FR-20 and FR-11/FR-25 disagree. (`rec-ps A6`, `rec-audit №5`, `rec-tz L-2`)
- **Auto-return target on OM completion:** FR-9 returns to «В строю»; Дополнение says return to
  the employee's planned status next day. (`rec-ps A4`)
- **Post-OM survey of actual time on post** — not in any FR; it is the data source for Налёт
  часов and overload (FR-32). High-severity gap. (`rec-ps A2`, `rec-audit №1`)
- **Weather/seasonal correction dictionary** — supposed to be in MVP but absent from FR-39
  dictionary list. (`rec-audit №2`)
- **«Боевой расчёт подразделений»** — in master title, undefined, lost as an open question.
  (`rec-tz H-2`, `rec-audit №3`)
- **«Иные виды» service roles (дежурный по КХО etc.)** — list not fixed, lost open question.
  (`rec-tz M-4`, `rec-audit №3а`)
- **Roles 5/6 permissions, max status durations per type, expense-header date format** — open
  questions not carried into PRD §8. (`rec-tz M-4`)
- **Restricting-status configurability:** FR-16 fixes only «Откомандирован»; configurability
  and the "restricts editing" attribute are not in FR-39 attribute list. (`rec-ps B4`)
- **Reports «штатное расписание» / «сводка по статусам»** — UC-REPORT-003/004 lost; FR-40 has
  only employee/history/audit exports. (`rec-tz M-3`)
- **Vacancy as rich entity** — historical doc gives vacancies требования/обязанности/reason;
  PRD reduces vacancy to a count. (`rec-tz L-3`)
- **Export PII masking** — FR-40 omits masking note though policy exists in spec.
  (`rec-tz L-6`)
- **Sensitive fields excluded from printed forms** — rule not separately captured. (`rec-ps A9`)

Things explicitly **absent / out of scope** (so not invented): mockups/wireframes; offline;
email/SMS; ЭЦП (hash-ready stub); real КУ sync; ratings/Налёт-source survey (MVP-2 / gap);
extended analytics & recommendations (separate PRD); accreditation/Face ID (separate PRD).
