# Real qualification history acceptance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Obtain an independent read-only final source/evidence review. Do not delegate implementation.

**Goal:** Verify qualification persistence, chronological history, profile revision sharing, attribution/idempotency and scope/revocation boundaries through the actual frontend and backend with synthetic restricted actors.

**Architecture:** Use immutable R3 frontend/backend/proxy and a freshly migrated isolated PostgreSQL/Redis stand. Actual NextAuth/JWT/HTTP requests reach Django without API fulfilments. Four synthetic actors exercise two bounded editor scopes, a read-only scope and self-only access without grants. A separately guarded fixture transition revokes only the owned editor grant immediately before a final intercepted POST is dispatched, exercising a stale authorized client against real canonical permissions.

**Tech Stack:** Existing Playwright/Edge, Django production images, PostgreSQL16, Redis7 and read-only table/model audits.

## Reproduced defect and bounded fix

The first actual run on R3 completed the explicit profile update, four assessments, exact replay and11 API refusal probes. At390px the history author paragraphs increased document width to435px. A read-only DOM experiment changing only overflow wrapping on those four author paragraphs reduced it to390px. A permanent existing UX case extended with a150-character author failed at the horizontal-width assertion on the unfixed R3 image. The diagnostic run remains retained as attempt1 and does not count as complete acceptance.

Owned product paths are limited to `PersonnelStatus/PersonalRecordFront/features/service-employees/ui/EmployeeQualificationsPanel.tsx` (wrap the complete author text) and `e2e/ux-non-om-qualifications.spec.ts` (mobile author regression). Build a new immutable frontend offline with the full existing gate, then run all5 qualification UX cases and the complete actual workflow on a fresh stand. Backend/proxy and all3 previously delivered launchers stay bound to their existing hashes. A separate later launcher revision may include the accepted frontend; no installation or publication is authorized by this plan.

The fixed image passed1076 Linux tests, the production build and all5 qualification UX cases. Attempt2 retained a diagnostic actual run that checked viewport width immediately during the responsive sidebar transition. A read-only resize probe measured574,559,414,390,390px over the transition; all author paragraphs already wrapped correctly. The local actual-workflow assertion now polls for the layout to settle, keeping the same390px bound. Repeat the full actual workflow on a new empty attempt3; keep both earlier attempts as diagnostics, not final acceptance.

**Spec:** `2026-10-27-non-om-workflows.md` qualification deliverable and review focus; existing `core/api/employee_qualifications.py`, `employee_service_profile.py`, `service_employees.py` and their backend/UX tests. User authorized continued work and improvements until28.10.2026 11:30 Asia/Qyzylorda.

## Global constraints

- Work in the current isolated worktree; preserve mixed dirty/untracked notes and the accepted assistant test commit479e5cf4.
- No production/local install, live LLM, working DB/backup read, external message/publication, declined dev-server startup or declined deletion.
- Preserve all3 launchers. R3 SHA25652b21498e3b9c209bc7f4afe34ca51c95feeb13c6da793bca738cbd3b3c78b91,428826720 bytes. FE476773e9e623/BE3e46a84198fb/proxy42a96240ed29 full IDs from R3 acceptance. No application image rebuild or package replacement unless an actual product defect is reproduced and fixed.
- Evidence `.local-review/real-qualifications-20261028/`; source snapshots only outer `.build/real-qualifications-20261028/` if a fix requires them. Local helper files stay ignored; commit only this owned plan and any justified product regression/fix.
- Unique marker `qualification-browser-<10hex>`; exact database `sj_qualification_acceptance_` + marker with hyphens replaced by underscores, host `db`. Seed/transition/audit helpers verify exact marker/target and explicit opt-in before writes/reads. Refusals survive python -O.
- Proxy loopback3399, separately owned internal services/networks/volumes; explicit checked /28 subnets. No worker/provider transport is needed for synchronous profile/qualification endpoints. Preserve14 stable working container IDs/images/start times/mounts/ports.
- No superuser/is_staff accounts or wildcard/global grants. Editor A and editor B each have only personnel.view/orgstructure.manage/admin.roles in their own department; reader A has only personnel.view there. Self actor has no grants and is linked only to its own synthetic employee. Verify exact effective codes/scopes/actor IDs before mutations.
- Allow only one reviewed own-employee profile PUT, four explicit qualification POSTs, and one final reviewed POST expected to be denied after fixture grant withdrawal. HTTP denial/replay probes are scoped to owned synthetic actors/employees; abort other browser mutations before dispatch.
- The grant withdrawal is a declared fixture injection, not an authorized-user role API claim: target only the nonce-bound editor UserRole using RoleAdminService.revoke_role in the owned database, with no external notification. Record it separately from user business writes and from unchanged-data snapshots.

## Review focus

- Legacy numeric scores without evidence stay unverified and do not gain fabricated assessments, dates or basis from reading/updating unrelated fields.
- Profile editing and assessments share a revision; explicit current/older assessments preserve other fields and the latest assessed date wins.
- Date validity is explicit: expiry today is valid inclusively, expired is expired, no expiry remains unknown. Historical ordering is assessed date rather than insertion order.
- Same actor/key/payload replays without a new row/revision; changed-payload key reuse and stale revisions return409 without mutation. Server supplies recorded_by; unsupported update/delete and forged actor/future dates are rejected.
- Reader/foreign/self boundaries and late grant revocation deny writes, preserve all records and remove previously rendered private qualification data after an actual authority failure. Keep intentional denial network errors separate from unexpected JS errors.

## One deliverable: actual qualification acceptance

**Files:** local `seed.py`, `test_seed_safety.py`, `stand.py`, `verify-started.py`, `browser.cjs`, `fingerprint.py`, `revoke.py`, `audit.py` and receipts under the evidence directory. Product files remain unchanged unless a real defect is reproduced.

- [x] Freeze current source/runtime/launcher bindings, add guarded empty-database seeding with four exact synthetic actors, two departments/children, three employees and one legacy profile; verify target/occupied-data guards before first write.
- [x] Provision a new labelled stand from R3, migrate and seed it, verify exact restricted permissions and actor/fixture origin bindings. Confirm qualification count0 and that initial reads keep legacy scores unverified.
- [x] Check reader403, foreign404 and self-only read/no-write boundaries before business changes; retain an exact post-authentication table baseline.
- [x] Use the real UI to change only height180→181 while preserving other profile values; require the refreshed shared revision for the first explicit shooting assessment4 (yesterday, expiry today, synthetic basis and actual actor).
- [x] Add an older shooting assessment3 that must not replace current4, an expired hand-to-hand assessment2 and a no-expiry physical assessment3. Inspect all four ordered history records, validity labels and numeric profile synchronization; no automatic evidence for legacy scores.
- [x] Replay the original confirmed POST and verify complete current envelope/table equality. Reject changed-key payload, stale revision, forged actor, future date, verified-score profile override and unsupported PATCH/DELETE without changing records.
- [x] Prepare one further UI draft, revoke only the exact owned editor grant inside the write fence, forward the original POST with unchanged credentials and require denial/no record plus clearing of private data. Verify retained history through the still-authorized reader and raw read-only audit.
- [x] Review model rows/authorship/expiry/order/profile/revisions and complete table preservation, distinguish the fixture grant transition, inspect390px, independently review all evidence and resolve material findings. If a product bug appears, first add a meaningful failing regression, then the minimal fix and appropriate verification/rebuild.
- [x] Remove exact owned containers/networks/volumes, prove14 working metadata records and all3 launchers unchanged, update canonical notes, commit only owned paths and leave the overarching goal active until the agreed deadline.

## Accepted result

Acceptance `.local-review/real-qualifications-20261028/acceptance.json`; independent source/evidence review matched all150 proofs without remaining findings. Final new attempt3 exercised four ordinary restricted actors, real NextAuth/JWT/HTTP, one explicit height update and four actual assessments with shared revision6, chronological history, valid-through-today/expired/unknown states, immutable original attribution, exact replay and11 API refusal probes. Six initial scope probes passed. One separately declared fixture role withdrawal preceded forwarding the final UI POST;403 preserved all142 non-audit tables relative to the post-transition baseline, removed private rendered qualification data and retained the exact history for the authorized reader.40 browser API responses,5 successful UI writes/1 denied UI write,0 unexpected errors or blocked writes. Actual mobile390/390px inspected.

The original R3 real author overflow435px and permanent150-character author width regression were reproduced before the minimal wrapping fix. All5 qualification UX cases passed on the fixed image; these use mocked business APIs and actual synthetic authentication, preserving140 non-authentication/non-audit tables. The final real workflow uses no business API fulfilments. An intermediate immediate resize assertion failed during the responsive sidebar animation; the read-only timing probe reached390px and the actual runner now waits for layout settlement. Earlier attempts remain diagnostics. The source snapshot1058 FE files passed1076 Linux tests and production build offline, new FE398fc4f456c4;1342 BE files/unchanged BE3e46a84198fb/proxy42a96240ed29 matched. Six seed-safety tests and28 actual helper refusals including python-O passed; all144 tables remained unchanged during refusals. Read-only raw audits matched row fields/request hashes/authors/dates/history/profile and4 qualification audits plus1 fixture withdrawal.

All3 stands removed:18 containers,6 networks,9 new volumes;14 working container metadata sets and all3 previous launchers unchanged. R3 launcher remains the prior delivery and excludes the new author wrapping fix; prepare a separate R4 next. No working database/backup, real LLM, installed copy, production or publication touched. Existing nonfatal read-only Gunicorn control-server diagnostic retained; clean backend logs are not claimed. Commit only the two owned FE paths and this plan. Canonical mixed notes stay uncommitted. Overarching goal remains active until28.10.2026 11:30 Asia/Qyzylorda.
