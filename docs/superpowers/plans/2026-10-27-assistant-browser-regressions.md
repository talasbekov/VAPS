# Real assistant browser regression Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Obtain independent read-only source/evidence review. Do not delegate implementation.

**Goal:** Preserve the accepted real assistant dialogue, explicit OM creation and idempotent replay as a permanent, reproducible Playwright regression.

**Architecture:** Promote the accepted `.local-review/real-assistant-execution-20261027` text fixtures into the frontend's existing real-acceptance pattern. Require an explicit loopback origin, generated fixture metadata/password and a full owned backend container ID. Read-only Docker metadata and a database-guarded fingerprint helper preserve the original all-table checks. Keep actual NextAuth/JWT/Django/Redis/Celery; substitute only the model HTTP transport in an explicitly launched fixture worker. No application behavior changes or production hooks.

**Tech Stack:** Existing Playwright/TypeScript, Python/Django fixture, immutable R3 Docker runtimes, PostgreSQL16 and Redis7.

**Spec:** `2026-10-27-real-assistant-browser.md`, `2026-10-27-real-assistant-execution.md` and accepted execution evidence b40b2d6bae944eb0e8d6a9cb9475e0a48814a520d9d560a39c47b4d0b4f9bcf3. The user authorized continued planned work/improvements until28.10.2026 11:30 Asia/Qyzylorda. This transfers existing accepted behavior into repeatable tests.

## Global constraints

- Existing isolated worktree; preserve all mixed dirty/untracked notes. Commit only owned plan/test/config/gate/README paths.
- No production/local update, working DB/backup read, live LLM, external message/publication, declined dev-server start or declined deletion. No mutation of any accepted launcher or old evidence.
- R3 SHA25652b21498e3b9c209bc7f4afe34ca51c95feeb13c6da793bca738cbd3b3c78b91; FE476773e9e623/BE3e46a84198fb/proxy42a96240ed29 full IDs in accepted R3 receipt. No application runtime image rebuild or package replacement for test-only changes. A separate verification-only Linux gate/build image is permitted.
- New evidence `.local-review/assistant-browser-regressions-20261027`; source snapshots only outer `.build/assistant-browser-regressions-20261027` if required for Linux gate/build.
- Discovery works offline without credentials or Docker; execution requires explicit loopback origin, fixture path/password and a64-hex backend container ID. No Playwright webServer.
- New fixture prefix `sj_assistant_acceptance_`, backend DB host `db`, generated stand marker `assistant-acceptance-<10hex>` and generated run ID. Refuse wrong target, occupied business data, invalid origin/password/model credential/marker before first write, including optimized Python.
- Owner exact event.create/manage/view/bulletin+catalog.view, observer only event.view/catalog.view. Bind generated usernames/IDs/roles/origin before first write; no administrator/wildcards.
- Before fingerprint exec, verify full container ID, matching fixture verification label, expected internal-only network and read-only rootfs. The SQL helper independently requires exact fixture database/host/marker and read-only transactions; it never resets or seeds data.
- Allowed domain probes: observer task creation403, observer continuation403, exact original-actor continuation replay. UI fence permits only reviewed task create/message/retry and one explicit continuation. No force sends, staff assignment or external notifications.
- Remove only exact freshly owned resources. Prove14 stable working container metadata and all3 launcher hashes unchanged. Record inherited Gunicorn read-only control-server diagnostic separately from UI results; do not claim a clean backend log.

## Review focus

- Wrong/stale metadata or backend CID must refuse before domain writes and before any working DB read; swapped actor IDs or passwords must not pass identity binding.
- Fixture guards must survive python -O and orphan business rows; worker/fingerprint helpers cannot be mistaken for production startup/cleanup scripts.
- All18 messages, failure/reload/retry, deferral, short answers, ambiguous yes and checklist detail must survive promotion; no loss of the earlier semantic assertions.
- Preparation has zero event/visit/receipt effects; only an explicit UI continuation creates one OM/visit/two original-actor receipts; denied recon remains explicit pending.
- Replay keeps the complete event, task except updatedAt and every non-dialogue table equal; every unrelated table is preserved at creation. Do not weaken this to counts alone.

## One deliverable: permanent real assistant suite

**Files:** create frontend `playwright.assistant-acceptance.config.ts`, `e2e/om-assistant-real.spec.ts`, `e2e/fixtures/seed-assistant-acceptance.py`, `e2e/fixtures/test_assistant_seed_safety.py`, `e2e/fixtures/assistant-provider-worker.py`, `e2e/fixtures/assistant-acceptance-fingerprint.py`. Modify frontend `scripts/gate-front.mjs`, root `README.md` and this plan. Keep provisioning/audit/orchestration receipts local to the new evidence directory.

- [x] Add meaningful failing fixture-safety cases for new stand-marker/database/origin/credential bindings against the copied seed, then implement minimal explicit guards. Preserve old empty-database checks.
- [x] Add explicit config and typed real-API E2E, safe container/DB fingerprint binding, exact UI fence,18-message dialogue, observer denials, explicit creation and full replay preservation. No mock fulfillments.
- [x] Promote the worker transport fixture with explicit test-only DB/host/stand/credential guard; preserve actual decryption, provider parsing and Celery execution. Promote the independent guarded read-only fingerprint helper.
- [x] Include offline discovery in the existing gate and document concrete safe provisioning/execution, one-use databases, fixture-only worker transport and exact allowed writes.
- [x] Run TypeScript/discovery, config/metadata/CID refusal checks and safety tests; prove refusals leave owned synthetic business snapshots unchanged.
- [x] Provision a fresh labelled stand from R3 runtimes using the actual permanent seed/worker/fingerprint files. Run the actual permanent browser suite, audit persisted data/worker transport and all-table preservation, visually inspect390px.
- [x] Obtain independent source/evidence review; fix material findings and repeat only invalidated checks. Add product regressions only if an actual application defect is found.
- [x] Freeze owned source; run relevant offline Linux frontend gate/build and Python guards; bind accepted runtime source and preserve R3. No new backend tests/migrations or image build for unchanged application code.
- [x] Commit only owned paths; update canonical notes and retain failures/limits. Remove exact owned containers/networks/volumes and verify14 working metadata records/all3 launchers. Keep the overall user goal active.

## Accepted result

Acceptance `.local-review/assistant-browser-regressions-20261027/acceptance.json`. Final sourcev3 and new attempt2 permanent Playwright case passed:18 persisted user messages/19 worker transport calls,186 successful UI requests/20 guarded POSTs, one event/visit/two original-actor receipts, observer403, unchanged full replay and internal committedBriefing. Before creation and after replay all141 non-dialogue tables are preserved; creation changes only five expected tables,136 others equal. Recon remains pending for the assigned chief, with no force requests/assignments. Mobile390 inspected. New final Linux snapshot1058 FE files passed1076 tests and production build offline;1342 backend inputs match accepted R3. Five Linux seed-safety tests/60 subcases,7 configuration refusals,22 actual helper refusals including -O,9 metadata/credential refusals preserving140 non-auth tables (JWT issuance explicitly excluded),17 semantic mutation refusals. Guard proofs were carried forward from attempt1 because those source paths/guards are unchanged; final accepted actual browser and Linux source are v3. S1/S2 source findings fixed; three source reviews and final evidence review have no remaining findings. A shallow proof-save alias found after the first passed v2 browser run was reproduced red and fixed with detached snapshots plus explicit 19-before/20-after phase assertions. The first report remains diagnostic, never the final accepted case. Its Linux snapshot is also retained separately. Both stands removed:14 containers,4 networks,6 new volumes;14 working metadata sets and all3 launchers unchanged. Verification-only Linux images are not app runtimes. No application behavior, backend, installed copy, production, real LLM or publication changed. Known read-only Gunicorn control-server diagnostic retained; a clean backend log is not claimed. Code commit is recorded in `code-commit.json` after this plan/test-only commit; canonical mixed notes stay uncommitted. Goal remains active until28.10.2026 11:30 Asia/Qyzylorda.
