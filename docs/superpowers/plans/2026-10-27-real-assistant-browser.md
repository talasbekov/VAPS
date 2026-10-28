# Real assistant browser and queue acceptance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; independent read-only review after the concrete acceptance or any product fix.

**Goal:** Verify the complete accepted OM dialogue through browser → NextAuth/JWT/HTTP Django → actual Redis/Celery → durable task state, on synthetic data.

**Architecture:** Existing immutable R2 application images, a new empty PostgreSQL database and a dedicated Redis/worker. Replace only provider HTTP transport inside the fixture worker, preserving real provider parsing, encrypted credential lookup and queue/task code. Use the actual frontend and API responses. Initially keep acceptance helpers local; preserve a repeatable regression when the verified scenario is stable.

**Tech Stack:** Existing production Next/nginx/Django/PostgreSQL16/Redis7/Celery, Playwright/Edge, Python fixture.

**Spec:** Existing `2026-10-27-ai-dialogue.md` and `2026-10-27-guided-assistant.md`; accepted 18-message queue fixture in `.local-review/production-update-20261027/queue-smoke/`. The outstanding browser integration is distinct from prior mocked-API UI checks and real queue checks executed separately.

## Constraints

- Continue the user's authorized autonomous work until28.10.2026 11:30 Asia/Qyzylorda. Existing isolated worktree, preserve unrelated dirty notes/plans.
- No production/local install, real LLM, external message, working data/backup access, declined dev-server startup or declined deletion. Both delivered launchers remain unchanged.
- Baseline FE1926eee31e08, BE3e46a84198fb, proxy42a96240ed29; no runtime change unless a concrete reproduced defect requires it and is revalidated.
- Helpers/evidence `.local-review/real-assistant-browser-20261027/`; new source snapshots only outer `.build/real-assistant-browser-20261027/` if needed.
- A new `sj_assistant_acceptance_*` DB on host `db`, unique nonadmin fixture identity, exact permissions, sealed synthetic model key. Explicit guards before all seed writes.
- Backend/worker/DB/Redis isolated on a new internal network; only proxy also joins a separately owned ingress bridge with a loopback port. No actual provider egress.
- Browser never fulfills business responses. Allow only exact fixture create/messages/retry writes, abort continuation/settings/domain writes before dispatch. Manual and execution actions remain untouched.
- Read-only database fingerprints and persisted task/message/receipt assertions distinguish dialogue writes from domain changes. Cleanup exact owned IDs/labels/networks/new volumes and verify14 stable working containers.

## Review focus

- Initial task and user message must be durable before the delayed provider finishes; pending hides old guidance and locks the composer.
- Failure/retry and reload must preserve the same task/question binding and exactly one copy of every user message.
- Deferral remains unknown and blocking; short numeric replies bind to the actual current object/sector/post question.
- Actual authenticated actor and permissions must be verified before writes; no accidental event/visit/request/receipt execution or settings mutation.
- Polling/caches and mobile/desktop layout must work with actual HTTP and worker states, rather than only mocked task responses.

## Work

- [x] Bind current source/images/launchers; inspect the actual UI, API and worker fixture contracts.
- [x] Provision a labelled, separately networked synthetic stack with guarded fixture data and an actual dedicated Celery worker.
- [x] Run actual browser creation/pending/reload, guided deferral, deliberate transport failure/retry and continuing short answers to a complete proposal; no execution action.
- [x] Verify durable actors/messages/context, decrypted fixture credential used only by worker, no domain mutations and stable source/runtime bindings.
- [x] Reproduce and fix any concrete defect with a meaningful failing regression, relevant checks, frozen reviewed sources and new runtime proof as required; preserve failed evidence.
- [x] Preserve the accepted scenario as an appropriate permanent regression, or explain its local-only fixture boundary; independently review the concrete work/evidence.
- [x] Update canonical notes and actual browser plan status, commit only owned paths, remove exact owned temporary resources and retain all evidence. Continue the active goal until the deadline.

## Reproduced application defect

The actual R2 frontend crashes immediately after successful201 task creation.
Its API returns `plan.briefingPending: null`; `AssistantBriefingSummary` reads
`pending.length` after a default that handles only undefined. The saved task and
actual worker processing remain durable. Two permanent renderer regressions fail
with the same null-length TypeError (125 passed/2 failed). Fix only the nullable
frontend contract and local display normalization, then validate a new FE image
and repeat the complete actual UI/HTTP/queue scenario. Backend is unchanged.
The accepted R2 launcher remains preserved; prepare a verified successor after
the application fix passes, rather than changing or installing that artifact.

The first fixture worker separately exited because its script lacked
PYTHONPATH=/app; that setup failure and seven-container/two-network cleanup remain
in attempt1. Attempt2 reached real Redis/Celery and exact nonadmin authentication,
then reproduced the application crash. JWT logins added outstanding refresh-token
rows;140 other tables outside dialogue/audit/auth issuance stayed equal. The final
dialogue-preservation baseline must be captured after authentication and before
the first task write, retaining strict comparison of all141 outside tables.

## Accepted proposal-only result

Acceptance: `.local-review/real-assistant-browser-20261027/acceptance.json`.
New immutable FE476773e9e623 is bound to manifestfec118322ac6 and three changed
frontend files; all1052 source files match,1342 backend inputs remain unchanged.
Two renderer regressions fail the original null contract and pass with the fix
(127/127 focused); full offline Linux gate1076/1076 and production build passed.
Independent source and acceptance evidence reviews have no findings.

Real NextAuth/JWT/browser/HTTP/Redis/Celery acceptance on a fresh synthetic DB:
initial201 queued saved in133ms before a five-second fixture model delay, reload
while queued, one transport failure, reload and explicit retry retaining the
same three user messages. All18 messages subsequently complete the same proposal
at revision39, with deferral, short sector/post answers, five checklist results,
protected person and chief resolution. There are19 guarded POSTs,172 successful
UI requests, no JS/console errors, and a verified390px mobile view. Every one of
141 tables outside tasks/messages/audit is unchanged after authentication; actual
read-only audit confirms zero events, visits and execution receipts. Worker makes
19 credential-decrypted transport calls with exactly one injected failure.

The two added renderer cases are permanent in the frontend gate. Full real-stack
orchestration, provider-only transport replacement and audit helpers remain local
fixture evidence, with no application provider hook or automatic CI runtime.
Three owned stands were removed:21 containers,6 networks,9 new volumes.14 existing
working containers retain their metadata. Both old launchers remain unchanged;
the real R2 rendering defect means the verified fix needs a successor package.
Next required work is `2026-10-27-update-r3.md`; R3 is not yet accepted or installed.
No production/local update, real LLM, working data/backup read or publication.
