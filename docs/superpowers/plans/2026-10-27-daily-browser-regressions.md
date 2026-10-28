# Real daily workflow regression Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Obtain an independent read-only review after implementation.

**Goal:** Preserve the accepted real-backend daily expense workflow as a permanent, reproducible Playwright regression.

**Architecture:** Reuse the existing actual JWT/NextAuth, Django/PostgreSQL, Redis, production Next and proxy scenario from real-daily-acceptance. Provision a separate empty synthetic database; the test consumes its metadata and unique accounts. No business API response is replaced. Keep the accepted R2 artifact and application runtime unchanged.

**Tech Stack:** Playwright/TypeScript, Django Python fixture, existing Docker production images.

**Spec:** `2026-10-27-real-daily-acceptance.md`, existing non-OM plan Task4 and the user's instruction to continue project improvements autonomously until 28 October11:30 Asia/Qyzylorda. This carries an already accepted workflow into repeatable tests, with no new product behavior.

## Global constraints

- Existing isolated worktree; preserve mixed dirty notes and untracked plans.
- Keep immutable FE1926eee31e08/BE3e46a84198fb/proxy42a96240ed29 and both delivered launchers untouched. No production/local install, live LLM, real user backup, dev server, blanket cleanup or previously rejected deletion.
- New source snapshots only under outer `.build/daily-browser-regressions-20261027`; evidence `.local-review/daily-browser-regressions-20261027`.
- Test execution requires an explicit loopback origin, metadata and password. Offline discovery needs none. No webServer or automatic application startup in Playwright.
- Fixture refuses a wrong DB prefix/host, existing users/structure/status/submission/duty sources/grants and invalid origin/password before the first write, including `python -O`.
- Three unique nonadmin/nonstaff accounts have only their exact scoped permissions. Validate authentication, permissions, fixture origin and known roster before any business write. Abort unexpected browser writes before dispatch.

## Review focus

- Wrong origin or stale metadata must fail before domain writes; verify unique identity and roster bindings.
- Cancellation must leave no submission; confirmation counts descendants and saved snapshot contains the same two people.
- Department assembly must pin the submitted version; composition and sending preserve its snapshot and actor.
- Foreign scope and missing authority must return403; repeated send409 must preserve the existing version/snapshot.
- Fixture refusal must survive optimized Python and orphan business rows; no cleanup or reset of existing data.

## One deliverable: permanent acceptance suite

Create frontend `playwright.daily-acceptance.config.ts`, `e2e/daily-expense-real.spec.ts`,
`e2e/fixtures/seed-daily-acceptance.py` and `e2e/fixtures/test_daily_seed_safety.py`.
Modify only frontend `scripts/gate-front.mjs`, root `README.md` and this plan, plus
canonical status notes when verified. Keep provisioning/audit helpers local to evidence.

- [x] Add safety tests against the actual old seed, verify meaningful failures, then implement explicit guards and unique metadata/accounts.
- [x] Add explicit configuration and permanent real-API scenario: exact scoped authority, seven denials, calendar/status, cancel/confirm2, department assembly/pinned composition, explicit send/duplicate409.
- [x] Add write interception with exact endpoint/payload checks and evidence attachments. No mock fulfillment.
- [x] Document provisioning/execution/one-use database constraints and include offline discovery in the existing gate.
- [x] Provision a new labelled synthetic stand from accepted images, run config refusals/safety checks and actual permanent browser test, then verify persistence in a read-only audit.
- [x] Obtain independent review, resolve material findings and repeat only invalidated checks.
- [x] Freeze exact sources; run appropriate frontend gate/build and safety tests in Linux. Verify runtime/backend/R2 unchanged.
- [x] Commit only owned paths, record current evidence and remove exact owned containers/network/new volumes. Continue the active goal; this phase does not end the user's time window.

## Accepted result

Evidence: `.local-review/daily-browser-regressions-20261027/acceptance.json`.
Current permanent scenario passed once on a fresh synthetic stand with actual
NextAuth/JWT/Django APIs, first-next-month label01 and target02, direct badge1,
confirmation/subtree2, pinned source version and explicit sending. It recorded
70 successful UI requests, exactly4 guarded mutations,7 permission denials403,
duplicate409 with persisted full-detail equality and exactly two version1 rows.
Read-only audit verified3 nonadmin users,3 employees,4 slots,1 status and2 submissions.

Four initial review findings were closed: calendar padding/host TZ/rendered month,
pre-write actor ID binding, post-duplicate persistence and displayed direct badge.
The earlier Nov1 calendar failure is retained with zero writes. Source formatting
matched actual date-fns/Calendar across5 dates and4 host timezones (40 comparisons).
Seed safety4 tests/40 subcases passed in Linux including optimized Python.
Six config refusals,7 metadata/credential refusals,1 used-DB refusal and6 actual
Django seed refusals passed;9 domain table fingerprints stayed unchanged.

Final independent review has no remaining findings. Frozen frontend1052 files
passed the full offline Linux gate1074/1074 and production build. All1342 accepted
backend files matched. Runtime FE1926eee31e08/BE3e46a84198fb and both launchers
remain unchanged. This is a test-only source successor to the accepted R2 release.
Three owned stands (18 containers,3 networks,9 newly created volumes) were removed;
14 pre-existing working containers retained their metadata. No working data/backup,
production/local installation, real LLM, publication or declined deletion was used.
The source snapshot remains in outer `.build/daily-browser-regressions-20261027/`.
