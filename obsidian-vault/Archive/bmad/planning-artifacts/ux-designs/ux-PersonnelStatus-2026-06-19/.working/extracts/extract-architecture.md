# UX Discovery Extract — PersonnelStatus (учёт личного состава)

**Date:** 2026-06-19
**Scope:** UX-shaping constraints only (IA, states, real-time, errors, permissions). Infra/deploy detail skipped except where it shapes UX (offline, hardware, browser).
**Sources read:**
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/epics.md`
- `docs/TECHNICAL_AUDIT.md`
- `docs/RECONCILIATION.md`
- `docs/registries/audit-events.yaml`
- `docs/registries/error-codes.yaml`
- `docs/registries/ws-message-types.yaml`
- `Backend/VAPS/apps/operations/management/commands/seed_operations.py` (the concrete seeded RBAC — the only authoritative naming of roles/permissions)

> Interface language is **Russian**; only the Расход (StrengthReport) document title is **Kazakh** (architecture NFR-7 / epics NFR-7). Data-dense штаб tool, not a startup UI (Mantine density `size="sm"`).

---

## 1. RBAC / roles & permissions

### Canonical seeded roles (8) — `seed_operations.py`
These are authoritative (architecture says "seed 8 ролей/17 прав" but does NOT name them; the seed file does):

| Role code | Russian name | Seeded permissions |
|---|---|---|
| `ADMIN` | Администратор | `*` (all) |
| `OMD` | ОМД | assignment.create/delete/submit, daily_report.generate, brokerage.manage |
| `SENIOR_COORDINATOR` | Старший координатор | assignment.create/delete/submit |
| `APPROVER` | Утверждающий | assignment.return, assignment.approve |
| `DIVISION_OPERATOR` | Оператор подразделения | daily_report.mark_update, daily_report.correct, status.view |
| `ORGD` | ОРГД | audit.view, daily_report.generate |
| `VIEWER` | Наблюдатель | status.view |
| `INTEGRATION_USER` | Интеграционная УЗ | status.manage |

### Permissions catalogue (17) — drive conditional UI / route guards
`*`, `admin.roles`, `status.manage`, `status.view`, `assignment.create`, `assignment.delete`, `assignment.submit`, `assignment.return`, `assignment.approve`, `brokerage.manage`, `daily_report.generate`, `daily_report.mark_update`, `daily_report.correct`, `object.manage`, `event.manage`, `duty.manage`, `audit.view`.

> Note: several permissions (assignment.*, brokerage.manage, object.manage, event.manage, duty.manage) belong to Stage-2 ОМ epics (E14–E18), NOT the PersonnelStatus pilot. For the **pilot** the load-bearing perms are: `daily_report.mark_update`, `daily_report.correct`, `daily_report.generate`, `status.view`, `status.manage`, `audit.view`.

### Scope (FR-33, architecture §Auth)
- Roles carry a **scope** — conceptual levels named in FR-33: `ORGANIZATION / DEPARTMENT / OWN_DIVISION / CUSTOM`. The implemented model expresses this as `scope_division_id` (subtree-based; one tree-walk channel `CoreDivisionTreeSelector` serves RBAC scope, cascade indicator, and расход — ARCH-DATA-024). A user can hold **multiple roles**.
- **Every request** is checked (token + role + scope + restricting status) via `PermissionService` — the single point (ARCH-SEC-031). No session cache of rights → revoking a temporary permission takes effect on the **next request** (defined boundary behavior; UI must not assume sticky permissions).

### Temporary duty permissions — ОМД / ОРГД (FR-34, R3)
- ОМД/ОРГД are **time-boxed duty permissions attached to a personal account** (`ops_temporary_duty_permissions`), auto-enabled/auto-expired by the Clock.
- **ОРГД is read-only** (FR-34). WS events `TEMP_PERMISSION_ACTIVE` / `TEMP_PERMISSION_EXPIRED` notify the duty user when the window opens/closes (drives a UI banner/notification + possible re-render of available actions).

### Status-derived permission gate (FR-16)
- An employee with status **«Откомандирован» (SECONDED, OUT)** loses status-edit rights → **view-only** (FR-16). This is a UI-affecting *restricting status*, not just a role.

### Route guards (Story 8.6)
- `AuthContext` + `usePermissions()` sourced from `useQuery(['me'])`; guards **hide** routes when the user lacks rights; `401 → redirect to login`. Permissions cached in TanStack Query, never duplicated in local state.
- RBAC matrix test (Story 2.9): every route must have explicit allow/deny expectations for 8 roles + anonymous.

---

## 2. Data entities & relationships (IA / navigation depth)

Canonical names (architecture Glossary — terms not in glossary = STOP):

- **Division** (Подразделение) — adjacency tree (parent FK), puropse: org structure. Skipping levels allowed (FR-1). Tree drives IA depth: cascade traffic-light tree, RBAC scope, расход aggregation. ~400 divisions; tree must be responsive on 4GB (lazy branches — Story 10.4).
- **StaffingSlot / StaffUnit** (Штатная единица) — Division + Position; занята or **Vacancy** (FR-2). Vacancies = all slots − occupied.
- **Employee** (Сотрудник) — card with **two blocks**: кадровый (HR) + оперативный (anthropometry, clearances, weapon, civilian uniform, facility knowledge, ServiceHours). Blocks gated by permissions (FR-3). History непустая/неудаляема. Dismissal → archive card, slot → Vacancy, all kept for audit (FR-4).
- **EmployeeStatus** (Статус) — status-as-interval `[date_start, date_end)`; lifecycle PLANNED→ACTIVE→COMPLETED/CANCELLED (derived-first). 12 base types + `PENDING_CLARIFICATION` («уточняется»). Invariant: exactly one effective status per date.
- **DailySubmission** (Сдача дня) — explicit per-division daily act; versioned (v1, v2…, exactly one `is_current`); JSONB snapshot of interval-facts (denormalized ФИО/звание for "as-was" printing). **Fractal**: a higher-echelon summary is the *same* entity over child submissions.
- **Amendment** (Пересдача/поправка) — re-submission event (reason, sanction, link to retro-edit). A retro-edit of a status covering an already-submitted day MUST trigger an amendment.
- **StrengthReport** (Расход) — the trusted document artifact; generated ONLY by the system; numbered, byte-for-byte stored, "взамен исх.№" chains.
- **TrafficLightStatus** (Светофор/индикатор) — GREEN/YELLOW/RED (см. §3 below).
- **AuditLog** — append-only (DB-enforced).
- **Notification** — DB-first; WS is signal layer.

Stage-2 entities (NOT pilot IA, exist as glossary/stubs): Facility(объект), Post, Sector, Duty(дежурство), SecurityEvent(ОМ), StaffingDemand(потребность), Brokerage, Placement(расстановка), ServiceHours(налёт).

Sorting canon (FR-5): by position level → surname; seconded-in/out shown as **separate blocks at the bottom**, prikomandirovannyy as "+N" at the receiving unit.

---

## 3. Real-time behavior (from ws-message-types.yaml)

**Contract:** `{"type": "<UPPER_SNAKE>", "payload": {...}}`. WS = "refresh me" signal; **truth is REST/DB**. Best-effort delivery; notification always persisted in DB. After reconnect the front re-reads via REST (`GET …?since=`). Kill-switch → silent fallback to polling, state stays consistent. Payload fields: `type_code, title, body, entity_type, entity_id, action_url, priority, expires_at`. Priorities: **INFO / WARNING / CRITICAL**.

UI pattern (Story 11.x): WS event → `queryClient.setQueryData` (no separate store); bell with unread count; "no connection" indicator; reconnect with exponential backoff + heartbeat; read-marking via mutation.

### Events relevant to the PersonnelStatus pilot (live-update the UI must react to)
| type_code | priority | recipients | repeat | action_url | trigger |
|---|---|---|---|---|---|
| `DAILY_MARK_MISSING` | WARNING | division operators | daily until mark | /daily-expense | 09:00 no INITIAL mark |
| `DAILY_MARK_ESCALATION` | CRITICAL | OMD/ORGD/supervisor | daily until mark | /daily-expense | 11:00 no INITIAL mark |
| `REPORT_READY` | INFO | requester | no | /reports/{id} | document generated |
| `REPORT_FAILED` | WARNING | requester/admin | no | /reports/{id} | generation failed |
| `IMPORT_COMPLETED` | INFO | requester | no | /admin/import-export | import job ok |
| `IMPORT_FAILED` | WARNING | requester/admin | no | /admin/import-export | import job failed |
| `TEMP_PERMISSION_ACTIVE` | INFO | duty user | no | / | temp permission started |
| `TEMP_PERMISSION_EXPIRED` | INFO | duty user | no | / | temp permission ended |

### Stage-2 events (not pilot, present in registry)
`EVENT_BULLETIN_CREATED, RECON_REQUIRED, NEED_RETURNED, RESOURCE_REQUEST_SENT, ALLOCATION_CONFIRMED, ASSIGNMENT_SUBMITTED, ASSIGNMENT_RETURNED, ASSIGNMENT_APPROVED, ACK_REQUIRED, ACK_MISSING_ESCALATION, SOFT_CONFLICT_DETECTED, HARD_BLOCK_ATTEMPT, REPLACEMENT_CREATED, INCIDENT_CREATED, INCIDENT_CLOSED, EVENT_READY_BLOCKED` — several have repeat cadences that drive recurring nags (`ACK_REQUIRED` every 2h, `EVENT_READY_BLOCKED` every 4h).

> Traffic-light **drift** (sdano-no-razoshlos / YELLOW) is computed server-side and shown via the светофор selector (Story 5.5 / 10.4); the светофор tree is refreshed by **polling** (Story 10.4), the notification center by WS. Both must reconcile.

---

## 4. Error states (from error-codes.yaml)

HTTP semantics: **400** = form/format violation (DRF field errors); **422** = business-rule violation (hard) — `overridable:false`; **409** = state conflict — either soft-warning (`overridable:true`, body carries `details` + client may retry with `override_reason`) or structural (`overridable:false`); 401/403/404 standard; 500 no details outward; **423** = locked by state.

Frontend protocol (ARCH-FE-015, Story 8.4/8.5): apiClient → typed `ApiError` union:
- **422 ValidationError** → `setError` on the RHF form (field-level).
- **409 ConflictError (overridable)** → shared **`ConflictDialog`** → user confirms with reason → retry with `override:true`. (Single `useApiMutation` hook; per-feature override dialogs banned.)
- **5xx ServerError** → global toast.

### Categories the UI must surface
- **form (400):** `VALIDATION_ERROR`, `DUPLICATE_EMPLOYEE_ID` (bulk import), `INVALID_SCOPE_STATUS` (status not allowed in actor's division scope), `OBJECT_CHECKLIST_REQUIRED` (S2).
- **auth (401):** `AUTH_REQUIRED`, `TOKEN_INVALID` → redirect to login.
- **auth (403):** `PERMISSION_DENIED`, `USER_INACTIVE` → "access denied" / inactive-user messaging.
- **not_found (404):** `ENTITY_NOT_FOUND`, `VERSION_NOT_FOUND`.
- **conflict_soft (409, overridable → ConflictDialog):** `SOFT_CONFLICT_DETECTED` (body carries `conflicts[]`), `STATUS_OVERLAP_WARNING` (manual status overlaps a soft status), `DUTY_CONFLICT_DETECTED` (S2).
- **state (409, NOT overridable — show blocking explanation):** `MARKS_INCOMPLETE` (missing required INITIAL marks → can't build FINAL report), `NOT_READY` (doc file not yet generated — async state), `REPORT_NOT_READY_FOR_DATE`, `HASH_MISMATCH` (S2), `POST_IN_USE` (S2), `RECONNAISSANCE_REQUIRED` (S2), `CHECKLIST_ISSUES_UNRESOLVED` (S2), `NOT_IMPLEMENTED_FOR_MVP`.
- **business_hard (422, NOT overridable — block):** `HARD_UNAVAILABLE_STATUS`, `OVERLAPPING_HARD_STATUS` (manual status overlaps an existing hard-block status), `REST_AFTER_DUTY_BLOCK` (S2), `EMPTY_GROUP` (S2), `UNDER_MINIMUM_GROUP_MEMBERS` (S2), `INVALID_RECONNAISSANCE_DECISION` (S2), `TEMPLATE_DATA_MISSING` (doc gen).
- **state_locked (423):** `ASSIGNMENT_VERSION_LOCKED` (S2).
- **server (500):** `INTERNAL_ERROR`, `DOCUMENT_GENERATION_FAILED`.

### conflict_codes inside `SOFT_CONFLICT_DETECTED.conflicts[]` (severity WARNING; row-level markers in the grid)
`DOUBLE_ASSIGNMENT_CONFLICT, UNAVAILABLE_STATUS_CONFLICT, REST_VIOLATION_CONFLICT, WORKLOAD_EXCEEDED_CONFLICT, POST_REQUIREMENT_MISMATCH_CONFLICT, DUTY_OVERLAP_CONFLICT, OVERQUALIFICATION_DETECTED, RATING_DATA_MISSING` (mostly Stage-2 ОМ assignment conflicts).

**Pilot-specific named codes that appear in stories but NOT yet in the registry (flag — see §8):** `DAY_ALREADY_SUBMITTED` (409, repeat submit — Story 5.3), `BUSINESS_DATE_OUT_OF_WINDOW` (422 — Story 5.3), `TOMORROW_BLOCKED` (422 with list of laggards — Story 5.6). These are referenced by acceptance criteria but absent from `error-codes.yaml`.

> Grid error UX (Story 9.6): zod per-row validation + conflict markers — **hard = blocks the row**, **soft = warning**; backend 409 row-detail maps to the corresponding rows, other rows stay editable.

---

## 5. Audit events (from audit-events.yaml)

Record shape: `actor_user_id, action, entity_type, entity_id, before/after JSON, request_id, IP`. Append-only enforced at DB level. Actions are UPPER_SNAKE from registry.

`audit_logs.action` values:
- `AUTH_LEGACY_TOKEN_ACCEPTED`, `AUTH_LEGACY_TOKEN_REJECTED` (auth)
- `ASSIGNMENT_CREATED`, `ASSIGNMENT_DELETED`, `GROUP_ASSIGNMENT_CREATED` (S2 assignment)
- `POST_DEACTIVATED` (S2 post)
- **`DOCUMENT_DOWNLOADED`** — sensitive document download is mandatorily audited (BR-DOC-003). → personal export "щит" (Story 10.8) and any расход download triggers an audit record. UI can surface "downloaded by/when".
- **`DAILY_SUBMISSION_SUBMITTED`** — division submitted the day (snapshot act).
- **`DAILY_SUBMISSION_AMENDED`** — re-submission/amendment (who/when/reason/sanction).

Status-history `action_code` (controlled vocabulary, audited — the most audit-heavy area): `CREATED, APPLIED, EXTENDED, TERMINATED, COMPLETED, CANCELLED, MODIFIED`. (CREATED/EXTENDED/TERMINATED/CANCELLED/MODIFIED are user actions; APPLIED/COMPLETED are SYSTEM-actor auto-transitions.)

Story-named audit events not yet in registry (Story 5.9): `DAY_SUBMITTED`, `DAY_AMENDED`, `TOMORROW_BLOCK_OVERRIDDEN` — naming differs from registry's `DAILY_SUBMISSION_*` (flag — see §8).

**UX implication:** every mutation leaves a before/after trail → the UI can/should show "кто изменил, когда, было→стало" on status cards, submission history, amendment chains, and overrides. Overrides are first-class auditable entities (override reason captured in ConflictDialog and in TOMORROW_BLOCK override).

---

## 6. PersonnelStatus epics / stories (features & screens in scope) — build order

Dependency chain (epics.md §Epic List): E1 → E2 → E3 → E4 → E5 → E6 → E7 → {E8→E9→E10, E11} → 13.1–13.3 → E12 (pilot) → 13.4–13.6. Pilot = E1–E13 (merged stages 0+1). Stage 2 = E14–E18 (ОМ cycle, NOT PersonnelStatus pilot UX). Stage 3 = E19–E20.

**Frontend / UX epics (the PersonnelStatus surface):**

### E8 — SPA Foundation (the portal opens)
- 8.1 Vite react-ts scaffold (firefox100 target, bundle ≤300KB gzip, vendored fonts, dev proxy /api & /ws).
- 8.2 canon linters; 8.3 typed codegen; 8.4 apiClient + DomainError parsing; 8.5 `useApiMutation` + **ConflictDialog**.
- 8.6 Auth: login (JWT / dev X-User-Id), AuthContext + `usePermissions()`, **route guards** (hide unauthorized routes; 401→login).
- 8.7 Router + `routes.ts` + Mantine layout (size="sm") + Tailwind layout.
- 8.8 Print scaffold (separate print-route, bare HTML + print.css).

### E9 — Keyboard grid (blind operator entry) — screen №1, the hardest
- 9.1 paper contract (columns, prefill "вчера", grammar **Enter↓ / Tab→ / Esc-cancel**, type-over selection).
- 9.2/9.3 grammar state machine (pure, no React) + property-based (fast-check): focus in bounds, no lost keystrokes, Esc → pre-edit.
- 9.4 grid (TanStack Table + Virtual; status select by dictionary; **1 React commit per keystroke**; ≤N DOM nodes @5000 rows; empty-state for 0-row division).
- 9.5 focus layer (Enter commits+down, Tab right, focus never falls to body; focus returns to cell after ConflictDialog).
- 9.6 in-grid validation (zod per row; hard=block row, soft=warning; backend 409 maps to rows).
- 9.7 prefill yesterday + enter only deviations + changed-counter (daily ritual = minimal entry).
- 9.8 perf smoke; 9.9 E2E blind entry (20 rows keyboard-only → DB).

### E10 — Portal screens (operator submits the day in minutes)
- 10.1 paper contracts for traffic-light tree + расход screen.
- 10.2 **Mass-update screen** (grid + date/division picker + bulk submit; ConflictDialog on row conflicts; **beforeunload warning** on unsaved changes; autosave DEFERRED).
- 10.3 **Submit-day screen** (preview slice with diff-vs-yesterday, "Сдать день" button, confirm, post-submit drift marker).
- 10.4 **Traffic-light tree** (division tree, tri-color markers, cascade, "только отстающие" filter, **polling** refresh; responsive @400 divisions, lazy branches).
- 10.5 **Расход screen** (date / "на завтра" — 422 block with list of laggards; download .docx/.xlsx; "взамен исх.№" issue history).
- 10.6 **Amendment-flow UI** (re-submit with reason/sanction; version v1/v2 distinction; stale-summary marker).
- 10.7 print form of расход (bare HTML per §77 contract; official file stays .docx from backend).
- 10.8 personal operator export ("щит") — "моя копия" download (.xlsx with submit time/version; download audited).
- 10.9 "сообщено → исправлено" journal scaffold + app version in footer.
- 10.10 E2E full submit flow (mass-update → submit → green light → расход downloaded).

### E11 — Notifications (center + WebSocket)
- 11.1 Channels + channels_redis consumers; 11.2 publish to WS from notify() on_commit; 11.3 WS client (reconnect/backoff/heartbeat/`?since=` re-read, "no connection" indicator); 11.4 **notification center UI** (bell + unread + list + read-mark); 11.5 kill-switch (silent fallback to polling); 11.6 E2E.

**Backend epics that shape these screens' states/behaviors:** E2 (core + RBAC), E3 (status engine, conflicts 422/409+override, «уточняется», bulk-API for the grid), E4 (audit), E5 (DailySubmission + amendment + tri-color light + tomorrow-block + override entity + login + notifications backend), E6 (расход generators + DocumentSequence "взамен" + byte-exact file). E13 (fix loop: bug-report channel in UI, footer version, "fixed in vX.Y" journal).

> UX-1 (epics): paper contracts for the **three load-bearing screens** (mass-form blind entry, расход+светофор, ОМ checklist) precede API freeze. The ОМ checklist is Stage-2.

---

## 7. UX-affecting constraints from architecture

- **Frontend stack (named):** **Vite + React-TS** (React 19.2 + React Compiler, TypeScript strict). Router: **React Router v7** (plain Routes; all paths as constants in `src/shared/routes.ts`). State: **TanStack Query** (server) + URL search params + useState/useReducer + 2 Contexts (Auth/Theme) — zustand/redux/jotai/mobx **banned**. UI lib: **Mantine v7+** (core/hooks/dates/notifications, CSS Modules, density `size="sm"`, ru-locale Tree/DatePicker). Layout: **Tailwind** (layout only, preflight off; color/typography Tailwind classes on Mantine banned; styled-components/emotion banned). Forms: **react-hook-form (uncontrolled) + zod**. Tables: **TanStack Table + TanStack Virtual**. Codegen: drf-spectacular → openapi-typescript → `schema.d.ts`. Tests: Vitest + RTL + MSW + Playwright (≤5 E2E scenarios) + fast-check.
- **Hardware target (hard constraint):** old office PCs, **4 GB RAM, no GPU, Firefox ~100** (FF100). `build.target: 'firefox100'`; browserslist `Firefox >= 100`; eslint-plugin-compat blocking. **No runtime CSS-in-JS** (CPU without GPU).
- **Bundle budget:** ≤ **300 KB gzip** initial — enforced in gate.
- **Density / pagination / virtualization:** data-dense; **all long tables virtualized/paginated**; server-side aggregation; **never render 5000 rows as one canvas**; one screen = one division × month. List envelope `{count, next, previous, results}`; default limit 50, max 200; **ordering mandatory on every list endpoint, `id` last tie-breaker** (else pagination silently loses rows). Calendars (FR-37) paginated, NOT 5000 rows.
- **Perf invariants (deterministic counters, not timings):** exactly **1 React commit per keystroke** in the grid (React Profiler, blocking); **≤N DOM nodes @5000 rows** (virtualization). p95 keydown→commit is trend-only (non-blocking).
- **Offline:** штабист sits at a computer → **offline-first NOT needed** (architecture, confirmed by customer). But **WS is best-effort** with REST re-read + kill-switch fallback to polling — UI must degrade gracefully and show a "no connection" indicator and reconnect.
- **Real-time is MVP** (customer decision, re-confirmed; polling alternative rejected) → WebSocket via Channels/ASGI; kill-switch from day one.
- **Time / dates:** intervals stored half-open `[start, end)`; **UI displays "по … включительно"** (inclusive end). Calendar days, midnight Asia/Qyzylorda (UTC+5, no DST). business-dates `YYYY-MM-DD`; timestamps ISO 8601 with offset, conversion only at the boundary.
- **JSON:** snake_case end-to-end (no camelCase transform; types generated from schema).
- **Печатные формы (print):** separate route, **bare semantic HTML + print.css**, NO UI-library components (print is a legal artifact). Vendored Kazakh-cyrillic fonts.
- **Masking:** SensitiveFieldPolicy applied on screen / export / print (FR-3 card blocks gated by rights; FR-40 export with masking).
- **Versioning of API:** none (single SPA consumer); contract held by spectacular schema + CI diff.
- **App version in footer** (UI) — part of the "system is alive and being fixed" loop (NFR-8); "сообщено → исправлено" journal accessible to users.
- **The "survival" NFR (donor lesson):** the whole UJ-1 flow must be **faster than the same ritual in Excel**; bug-report cost ~0; visible fix speed. Operator gets immediate value from entering data (auto-statuses from duties, own slice, personal export "щит"). The competitor is not Excel but **the phone call**.

---

## 8. Open questions / contradictions

1. **Pilot error codes missing from registry.** Stories reference `DAY_ALREADY_SUBMITTED` (409), `BUSINESS_DATE_OUT_OF_WINDOW` (422), `TOMORROW_BLOCKED` (422) (Stories 5.3/5.6) but they are **absent from `error-codes.yaml`**. The registry is explicitly a "стартовый seed" and codes are added "тем же PR" — so these arrive with E5 implementation. The UI must surface "TOMORROW_BLOCKED → who hasn't submitted" (Story 10.5).
2. **Audit action naming divergence.** Registry uses `DAILY_SUBMISSION_SUBMITTED` / `DAILY_SUBMISSION_AMENDED`; Story 5.9 names `DAY_SUBMITTED` / `DAY_AMENDED` / `TOMORROW_BLOCK_OVERRIDDEN`. Naming must be reconciled at implementation (STOP-rule: action not in registry → STOP).
3. **No dedicated UX spec — by design.** "UX-спека отсутствует (осознанно)." Substitutes: paper contracts of three screens (UX-1), the keyboard grid grammar (UX-2), print = bare HTML (UX-3), stack canon (UX-4). DESIGN.md/EXPERIENCE.md will be the first real UX contract — there is no prior wireframe to inherit.
4. **«Уточняется» (PENDING_CLARIFICATION) semantics partially open** (AR-11): own расход row, **yellow** light, batch-resolution → auto-amendments; **N days of escalation is an open question** (STOP marker). UI must represent a "уточняется" status distinct from both В строю and hard statuses.
5. **Scope levels: model vs FR.** FR-33 names `ORGANIZATION/DEPARTMENT/OWN_DIVISION/CUSTOM`; implemented model only has `scope_division_id` (subtree). The conditional-UI mapping of these four levels onto the single subtree field is not yet pinned down.
6. **Traffic-light: polling vs WS.** Светофор tree refreshes by **polling** (Story 10.4) while the notification center uses WS — two refresh mechanisms that must reconcile (drift shown server-side). Cadence of polling unspecified.
7. **Operator profile spread (architecture open question):** "20 subordinates vs 300" → different mass-form tools. The grid must scale across this range (the 4GB/virtualization budget assumes the high end).
8. **FR-27 personal cabinet undecided:** "does a rank-and-file employee have a computer?" → личный кабинет vs "screen for reading out". Affects whether there's an employee-facing surface at all (likely Stage-2).
9. **Bug-report anonymity open** (hierarchical culture risk) — affects the E13 bug-report UI; "the button dies if not anonymous."
10. **Recipient-dictated расход format** (external constraint on golden master) — print/document layout (§77) may be imposed top-down.
11. **Two-machine duplication caveat (memory):** graphify path dupes; `docs/VisitX→PersonnelStatus` rename not committed on one machine — source paths may differ between environments. Not UX-affecting but a provenance caveat.
