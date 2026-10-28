# Real assistant explicit execution acceptance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Request an independent read-only review of the final execution evidence. Do not delegate implementation.

**Goal:** Verify that an ordinary authorized actor can explicitly create an OM from the accepted assistant dialogue through the real browser, and that a replay does not duplicate the event, visit or execution receipts.

**Architecture:** Reuse the accepted real browser/NextAuth/Django/Redis/Celery fixture, extended by one guarded UI continuation. Run the immutable accepted R3 frontend/backend/proxy against a newly migrated empty synthetic database. Keep provider substitution restricted to its transport in the fixture worker; use the actual authenticated manual DRF execution actions. This is testing existing behavior, without a proposed product change.

**Tech Stack:** Existing production Docker images, PostgreSQL16, Redis7, Celery, Playwright/Edge and read-only Django database audit.

**Spec:** `2026-10-27-real-assistant-browser.md`, `2026-10-27-ai-dialogue.md` and the existing receipt-bound `ops/assistant/execution.py`/`briefing_execution.py` contract. The user authorized continuing planned work and improvements until28.10.2026 11:30 Asia/Qyzylorda; fixture design choices here are the implementer's decisions.

## Global constraints

- No production/local installation, working DB/backup read, real LLM, external message/publication, declined dev-server startup or declined deletion.
- Preserve all three accepted launchers. R3 SHA25652b21498e3b9c209bc7f4afe34ca51c95feeb13c6da793bca738cbd3b3c78b91,428826720 bytes; app sourcef2ee1fe4 and delivery source3655b23a. No package rebuild for evidence-only work.
- FE476773e9e623/BE3e46a84198fb/proxy42a96240ed29 are the same full immutable IDs in R3 acceptance. No mutable tags, app runtime hooks or permission bypass.
- New evidence `.local-review/real-assistant-execution-20261027/`; new database prefix `sj_assistant_execution_` on the owned `db` host; namespace/credentials/resource IDs generated afresh. Reuse only text fixture helpers, never a prior live database or old private state.
- Owner has exactly event.create/manage/view/bulletin and catalog.view; observer has only event.view/catalog.view. No administrator/wildcard/force-command grants.
- Only the exact task create/message/retry UI requests and one reviewed task `/continue/` are allowed. Direct HTTP probes include the denied observer continuation and replay of the exact confirmed continuation against the same owned fixture. The inherited preflight also probes denied observer task creation (403, no task written); this narrow additional probe was identified in independent review and explicitly acknowledged here after the run.
- Do not send force requests, choose people, place staff or trigger notifications. Real OM creation and bounded draft briefing effects are permitted only in this newly owned synthetic database.
- Internal-only backend/worker/DB/Redis/frontend, own proxy ingress loopback3398; explicit checked private /28 networks. Remove only exact owned resources and prove14 stable working container metadata unchanged.

## Review focus

- No event, visit or execution receipt exists before the explicit UI confirmation; preparation remains a saved proposal.
- The ordinary actor's original authentication/permission policy and identity reach the manual APIs; the observer receives a refusal without changing data.
- Object, protected person, chief and three-person post facts come from the reviewed dialogue; denied draft actions remain explicitly pending rather than being reported successful.
- Replaying the exact continuation produces no duplicate event/visit/post/receipt or altered confirmed business fields.
- Read-only audits use the owned database guard, preserve unrelated tables after authentication, and do not mistake legitimate token issuance for business mutation.

## Task1: Actual execution and preservation evidence

**Files:** create local `stand.py`, `seed.py`, `test_seed_safety.py`, `worker-fixture.py`, `verify-started.py`, `browser.cjs`, `fingerprint.py`, `audit.py` and receipts under the evidence directory. Product files stay unchanged unless an actual defect is reproduced.

- [x] Copy accepted text-only helpers into the new namespace; change database/resource guards and bind images directly to the accepted R3 receipt. Run fixture safety tests before starting the new stand.
- [x] Start a fresh migrated synthetic stand; verify exact actors, immutable images, internal topology and actual Celery ping before any browser write.
- [x] Run the real18-message dialogue and existing failure/reload/retry assertions; prove no execution side effects before the final button.
- [x] Check observer continuation refusal and unchanged execution baseline; record its actor and response separately from successful UI requests.
- [x] Click the single explicit creation action through the browser. Record the exact POST/revision, rendered result, event ID, returned execution receipts and any pending authorized draft steps.
- [x] Replay that exact continuation through HTTP as the original actor; compare full event/task domain snapshots and unique receipt keys. Require no duplicate business effects.
- [x] Run read-only database audit: correct event/visit linkage, original executing actor, reviewed object/person/chief/checklist/post facts or explicit pending status, no allocations/assignments/force sends; preserve every unrelated table from the proper post-authentication baseline.
- [x] If a product failure occurs, retain it and add a focused permanent failing regression before the minimal fix; rebuild and independently review only when runtime source changes.
- [x] Independently review actual evidence and limits, remove exact owned containers/networks/volumes, verify14 pre-existing container metadata and all launcher hashes, update canonical notes and commit only owned plan/source changes. Keep the overarching goal active until the agreed deadline.

## Accepted result

Evidence `.local-review/real-assistant-execution-20261027/acceptance.json`. R3 immutable images unchanged. Actual18-message dialogue/19 worker calls, 187 successful UI requests/20 guarded POSTs; explicit UI continuation body{}, observer403 with no changes, one event/visit and two original-actor receipts. Exact continuation replay preserves the full event, task except updatedAt and all141 non-dialogue tables. Only five expected tables change at creation,136 others preserved. Chief applied; recon explicitly pending for its assigned chief, no force requests sent or personnel assignments. Mobile390 checked, independent review clean. Initial read-only audit helper used an incorrect model field; its log is retained and corrected audit passes. No product defect or source changes; conditional product regression/fix/rebuild step was unnecessary. The inherited preflight also refused observer task creation403 beyond the original narrow direct-probe wording; the plan now acknowledges that safe additional check. Backend log retains a Gunicorn control-server read-only /root/.gunicorn diagnostic; HTTP/UI passed, a clean backend log is not claimed. Seven owned containers/two networks/three volumes removed,14 working metadata sets and all3 launchers preserved. No working DB/backup access, real LLM, installation or publication. Goal continues until28.10.2026 11:30 Asia/Qyzylorda; next improvement is a permanent real assistant browser regression suite with protected fixture seeding.
