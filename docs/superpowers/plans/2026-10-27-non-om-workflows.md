# Non-OM workflows implementation plan

> **For agentic workers:** Use superpowers:executing-plans or focused parallel agents to implement independent tasks.

**Goal:** Implement the non-OM improvements approved by the user after the 27 October audit.
**Architecture:** Extend existing Django services and scoped permissions; reuse Next.js workspaces, no new global navigation sections. PostgreSQL additive migrations, no fabricated historical data.
**Tech Stack:** Existing Django/DRF/PostgreSQL; Next.js/React/TypeScript.
**Spec:** docs/vault/Аудит-проекта-2026-10-27.md, section «Дополнение: разделы вне ОМ».
**Authorization:** User: «ну так давай сделаем их». Implementation choices delegated; no renewed design approval needed.

## Global constraints
- Current isolated worktree on codex/requirements-fixes-20261007. Preserve user data, credentials, production, current update package.
- No global permission grants or bypass of existing scope. Root integrates shared routes/model imports.
- Agent migration reservations: templates0149, qualifications0150, inspections0151; dependencies form one chain.
- Existing historical scores remain unverified until explicit evidence entered. No operational doctrine invented for checklist.
- Avoid repeated build snapshots and heavy artifacts; one test namespace .local-review/non-om-20261027.
- Tests use isolated PostgreSQL, not application data. Build and focused browser tests before claiming ready.
- No automatic notifications outside app. No production deployment/publishing in this task.

## Review focus
- Cross-department read/write denial, deactivated roles and stale client cache.
- Concurrent updates, double submissions and task switch while editing.
- Empty data vs active filter vs inaccessible/error/loading states.
- Invalid/expired assessment dates, existing unverified numbers, no fabricated attestation.
- Legacy object links/local templates survive upgrade through explicit safe handling.

## Task 1: Duty templates (agent duty_shared_templates)
Files: duty-register/ui/DutyTemplates.tsx, model/templates.ts; separate backend model/API/service/tests.
- [x] Failing tests for shared/personal scope, validation, revisions and legacy import.
- [x] Server persistence and scoped shared templates; personal owner-controlled templates.
- [x] FE asynchronous loading/save/delete, visibility choice, explicit import of prior local values.
- [x] Focused backend/FE tests; report integration needs.

## Task 2: Qualification evidence (agent qualification_history)
Files: employee service-profile FE/BE and new assessment module.
- [x] Failing tests for evidence dates, scope and existing unverified values.
- [x] Append-only assessments with skill, score, date, optional expiry, basis, recorded-by actor.
- [x] Current validity and history in concise profile, permission-aware editing.
- [x] Focused tests; no invented historical metadata.

## Task 3: Objects and inspections (agent object_inspections)
Files: object detail page, object-passport features; new inspection API/model/tests.
- [x] Hide infrastructure/groups placeholder tabs and handle legacy URLs.
- [x] Real inspection draft/completion with user-defined checklist, findings, due date/responsible/resolution.
- [x] History and truthful freshness; scoped access, revisions, audit.
- [x] Focused backend/FE tests including empty state and concurrency.

## Task 4: Daily work and duty states (root)
Files: duty-dispatch workspace/model; ops-daily/status-day-close; daily-expense views; portal links as needed.
- [x] Distinguish no people allocated from all placed and filtered empty; hide useless filters.
- [x] Clear daily flow date → changes → preview → submission using existing endpoints.
- [x] Show snapshot/current distinction and next action without duplicating submit controls.
- [x] Relevant behavioral tests and static/rendered UI checks.
- [x] Browser acceptance of the complete daily workflow with real Django/PostgreSQL and restricted synthetic roles; cancellation, subtree confirmation, pinned composition and explicit summary sending passed. Evidence `.local-review/real-daily-acceptance-20261027/acceptance.json`.

## Task 5: Reports and effective access (root)
Files: report workspace, admin users/role access views, existing diagnostic APIs.
- [x] Find existing capabilities first; improve existing role-specific entry, scope/date/freshness labels.
- [x] Expose effective user access and contributing roles/scopes using canonical server authority.
- [x] Clear separate health/backup/update state where evidence exists; unknown rather than invented success.
- [x] Relevant tests; preserve data masking.

## Task 6: Integration and delivery (root)
- [x] Review agent changes, route/model imports and sequential migration graph.
- [x] Frontend gate/build: 973 tests, production build successful.
- [x] PostgreSQL full collection: 7868 passed, 1 skipped across four disjoint groups with isolated databases; migration check passed.
- [x] Focused browser contracts: accepted production frontend with synthetic auth/mocked business APIs,52 existing non-OM scenarios plus9 diagnostics passed. That earlier mocked pass did not cover real daily submission; the later accepted real-backend daily workflow is recorded separately in Task4. Prior declined dev-server launch was not retried; evidence `.local-review/non-om-browser-20261027/acceptance.json`.
- [x] Independent review and resolve material findings.
- [x] Update role guide, journal, tasks and acceptance evidence; report precisely installed vs source-only.
- [x] Remove dedicated test container and its source snapshots; drop two remaining dedicated test databases and restore audit PostgreSQL to stopped state. Keep logs, manifests and current application build. No application data or volumes removed.
