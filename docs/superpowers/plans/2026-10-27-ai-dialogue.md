# AI dialogue and durable processing implementation plan

> **For agentic workers:** Use focused parallel agents for backend, frontend and deployment; root integrates and verifies.

**Goal:** Continue one OM task through multiple messages, preserve it before model work, and recover clearly after failures.
**Architecture:** Existing Django/PostgreSQL task and authenticated execution workflow; append persisted dialogue, process interpretation through existing Celery worker. Worker proposes a plan only; domain actions remain authenticated and receipt protected.
**Tech Stack:** Existing Django/DRF/Celery/PostgreSQL, Next.js/React, offline Docker Compose. No new dependency or AI provider required.
**Spec:** docs/vault/Аудит-проекта-2026-10-27.md, dialogue/background/network findings. User explicitly requested autonomous implementation; implementation choices delegated.

## Design decisions

- Persist task and user message before queue dispatch; model latency must not delay initial save.
- Use Celery already shipped with the project. Rejected alternatives: synchronous model call (loses durable processing state) and a separate new queue service (unnecessary deployment burden).
- Persist user/assistant history with stable request keys. A second message updates the same proposed plan; it does not create another task/event.
- Expose processing separately from business status: queued/running/ready/failed, retryable error. Reload reads durable state. Failed enqueue/crashed work can be retried with revision protection.
- Model and worker never send department requests, sign records or impersonate the original user. Explicit continuation uses the existing authenticated endpoints and receipts.
- Preserve explicit earlier fields when new message omits them; explicit corrections override previous proposals. Conflicting totals and department allocations must be clarified. Created/sent business records cannot silently change through chat.
- Bound message/context size and handle ambiguous extraction truthfully. No claim of a live model test from synthetic provider fixtures.
- Keep the composer visible inside the task; manual correction is an optional fallback. No new global navigation section.
- Give backend and worker explicit LAN egress in the supplied Compose; preserve existing server configuration and document the scoped edit needed for already installed Compose files.

## API contract

- Add task.messages: [{id, role: user|assistant, text, requestKey, createdAt}].
- Add task.processing: {state: queued|running|ready|failed, attempt, error, retryable}, task.canMessage.
- Existing create with interpret:true saves and returns201 queued. Structured interpret:false retains manual path.
- POST tasks/{id}/messages/: {requestKey, message, revision}, response202 task. Owner access, CAS and request replay protection.
- POST tasks/{id}/retry/: {requestKey, revision}, response202 task. No duplicate user message.
- Existing continue stays authenticated; block unsettled interpretation/conflicts. Explicit validated manual fallback remains available after model failure.

## Constraints and review focus

- Preserve verified dirty non-OM changes and existing worktree. Reserve migration0152 after0151.
- No production changes, external messages, credential printing or new update package in this task.
- Previous background dev-server launch was rejected by automatic review (`blocked by policy`); do not retry or bypass that launch. Browser checks remain explicitly unexecuted until a permitted environment is available.
- Test revoked access before/during worker execution, request replay and stale revision, worker lease expiry, queue failure, ambiguous corrections, attempted edits after event creation/sending, and task/account switch with stale FE cache.
- Keep logs/manifests small, isolate PostgreSQL databases, remove only this task's temporary container after checks.

## Backend deliverable — ai_dialog_backend

- [x] Add failing tests for saved-before-model, dialogue continuity, conflict/permission/concurrency/recovery cases.
- [x] Extend operations/models_assistant.py and add0152 migration; register new history models read-only in Admin.
- [x] Add conversation/queue worker services, update views_assistant.py, provider/planning and execution guards.
- [x] Preserve current request authentication and receipt behavior; add bounded conversational context.
- [x] Run targeted assistant tests, schema/admin/migration checks; report results.

## Frontend deliverable — ai_dialog_frontend

- [x] Add regression tests for message/retry writers, stable keys, draft recovery and stale access/task isolation.
- [x] Extend features/om-assistant types/writer/workspace with permanent dialogue and clear processing/retry states.
- [x] Keep recognized summary, unresolved questions and explicit continuation; collapse optional manual form.
- [x] Update browser scenarios without claiming execution; run targeted Node tests and types.

## Deployment deliverable — ai_model_network

- [x] Add Compose network regression tests before change.
- [x] Connect backend and worker to default+ingress without new published ports or changes to other service networks.
- [x] Document exact scoped server Compose changes and bounded connection checks; updater continues preserving server customizations.
- [x] Run relevant deployment tests:143 passed/9 platform skips.

## Integration — root

- [x] Integrate routes/model registration/schema/audit coverage and migration graph.
- [x] Independently review permission, concurrency, model-failure and retry boundaries; fix material findings.
- [x] Real isolated Redis/Celery smoke with deterministic provider: same-task messages, duplicate replay, failure/retry, no business events. Not a live model check.
- [x] Run final frontend gate/build (995 passed), full isolated PostgreSQL suite (7899 passed/1 skipped), migration check and deployment checks (143 passed/9 platform skips).
- [x] Update role guide/journal/tasks/handoff and evidence with source vs installed state.
- [x] Remove this task's temporary test/Redis containers and snapshots, smoke database and Redis anonymous volume; restore audit PostgreSQL to stopped state. Keep receipts and current deliverables.
- [x] Real browser/HTTP/queue acceptance on a separately provisioned synthetic production-image stand; provider transport is deterministic, not a live LLM.

Follow-up evidence: `.local-review/real-assistant-browser-20261027/acceptance.json`.
The actual frontend null-actions rendering crash was reproduced and fixed; FE476773e9e623
passed the18-message complete-proposal workflow. Execution and installation remain separate.
