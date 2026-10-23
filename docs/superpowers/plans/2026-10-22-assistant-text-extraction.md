# Assistant explicit text fields correction

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development with independent backend/frontend ownership and review. User authorization is the reported broken assistant flow; proceed autonomously within the local copy.

**Goal:** Preserve the user's explicitly supplied object, day and headcount in the OM task and correction form.

**Evidence:** Primary task b923af17-bc65-4024-ab44-8cbb0eee70c6, actor1, created2026-10-22T04:37:33Z. Text: «собери наряд на объект Стенд: объект с готовым паспортом на 23 число 200 человек». Stored proposal has objectName=Стенд, no date, no allocations, no notice. Current schema has no standalone total; exact object matching loses the full catalog label and grounding supports full dates/relative words but not this day-of-month expression. Read-only investigation; no data change yet. Docker restarted independently during investigation and existing stacks returned healthy; this was not an application-code fix.

**Design:** Keep the existing task/request/role workflow. Add optional personnelTotal (integer1..100000 or null) to proposal/plan/human fields, separate from published demand and sent allocations. A deterministic evidence pass preserves explicit facts omitted or shortened by the model: whole catalog object labels (no fuzzy prefix choice), an unambiguous upcoming day in the current business month, and an explicit total associated with people. Unknown title/kind/departments remain questions. Do not infer 200 recipients or mutate event demand, assignments, approvals, roles or nullable import dates.

## Contract and scope

- Existing frontend/old tasks tolerate missing personnelTotal and show «Не указано». Human draft uses personnelTotal:string, JSON uses number|null. Empty human input clears it; bool/float/negative/zero/overflow are rejected. Correction remains unavailable after dispatch and backend enforces it.
- Pure planning helper complete_explicit_proposal(message, proposal, *, object_names) may be used only in initial interpretation. Exact catalog text is authoritative; ambiguous/missing/duplicate objects must request a choice rather than guessing an ID. Human corrections override earlier text and are not re-extracted during continue.
- «на 23 число» on business date2026-10-22 means2026-10-23. Past/invalid/multiple/conflicting days require clarification, not silent next-month/year rollover. Preserve supported full dates and relative-date behavior. Do not misread department/post/time quantities as a personnel total. Negations/alternatives/conflicting totals require review.
- Explicit total is «Людей по поручению», not the published forceDemandTotal, request count, reserve, roster or post count. Allocation rows remain recipient/count pairs and all existing grounding, permissions and receipts stay authoritative.
- Backend owner: assistant/planning.py, provider.py, execution.py, api/views_assistant.py and existing test_ops_assistant_planning.py/test_ops_assistant_api.py only, relative to organization_management/apps/ops. Frontend owner: features/om-assistant/model.ts, workspace.tsx and existing scripts/tests/om-assistant.test.cjs. No migration, dependency or other product source changes without explaining the concrete need first.
- Baseline installed Task25 backend888f/image0898 and frontend8242/image01e9. Preserve all old proofs and files. New source snapshots only outer .build/assistant-text-extraction-20261022. New evidence namespace .local-review/project-audit-20261022-text-extraction; previous09:00 READY windows expired and must not be reused.

## Implementation and verification

- [ ] Capture exact task/catalog facts and before2252 source rows before source edits; reproduce old extraction on the same message with the actual local model, no business writes.
- [ ] Backend RED: actual user text, catalog full-label resolution and duplicate/prefix/alternative controls; day-of-month current/past/invalid/conflicting cases; standalone totals and non-personnel/negation/alternative controls; ordinary JWT create/correct and manual overrides, immutable dispatched count. Keep unsafe model facts rejected.
- [ ] Minimal backend fix, GREEN focused suites and source boundary.
- [ ] Frontend RED/GREEN: human fields validation/clear, legacy unknown, card shows total separately, correction form preserves200/date/object. Preserve request/reserve/post meanings and authority checks.
- [ ] Independent source review against this contract, capture/freeze current source and immutable build snapshot.
- [ ] Run appropriate full backend suite with isolated PostgreSQL --create-db/--dist=load; frontend gate:front, fresh current API contracts and migration dry-run. No primary/clone test DB reuse or application-data reset.
- [ ] Actual model result and ordinary-authority API/browser reproduction on the reviewed clone, desktop/mobile personal visual inspection; no notification sends, roster selections or signatures for this correction.
- [ ] Quiet backup, reviewed same-stack native local update, unchanged unrelated137-table rows/files/volumes and166/1240/4960 monthly data, ordinary login/UI verification. Preserve every prior release receipt.
- [ ] Correct only the user's existing broken task through its ordinary authorized continuation using explicit date/object/total, leaving missing title/kind as questions and avoiding duplicate tasks/events/requests. Keep original task snapshot and exact action receipt.
- [ ] Update canonical handoff/tasks/journal/role guide only as needed and report actual tested scope, remaining questions and local-only delivery.

No production/DT/publication/commit/push/cleanup is part of this fix. The user may supply a different actual example while work continues; incorporate it without abandoning this reproduced defect.
