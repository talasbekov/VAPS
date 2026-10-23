# Assignment journey implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with scoped parallel domains as explicitly authorized by the owner. Root integrates and reviews; workers do not commit shared files or spawn reviewers.

**Goal:** Deliver all six approved simplifications: fewer duplicate controls, continuous request work, precise next actions, reuse known information, understandable candidate selection, and concise commander progress.

**Architecture:** Keep current routes and domain stages. Reuse authenticated reads and writers; add read-only candidate assessment using existing server rules and a compact progress projection on an already-authorized assistant event. No new permission or implicit business write.

**Tech Stack:** Existing Next.js/React/TanStack Query and Django/PostgreSQL. No new dependency.

**Spec:** The owner's accepted six-point proposal in this conversation: a request retains object/date/count throughout; the next actor and action are explicit; known fields do not need re-entry; suggestions are reviewed before submission. All six are one delivery. This document also records implementation choices delegated to us.

## Global constraints

- Local Smart only. Preserve business data, users, roles, passwords, import IDs and nullable dates. Production and Digital Twin unchanged.
- Existing isolated branch `codex/requirements-fixes-20261007`, base d685298. Do not switch/reset worktrees.
- Department quotas, recon, approvals and acceptance remain server-authoritative. No fabricated availability, skill, signature or confirmation.
- Physical squad reserve has no assigned event interval: show reserve eligibility without claiming availability for an event. Group selection assesses the actual event interval and distinguishes hard/soft conflicts. Final write revalidates.
- Scope changes and 403/failed reads must hide protected cached data. Preserve immutable retry keys and unsaved input within the current authorized context.
- Limited previews must say so; never label first-page data as all outstanding tasks. Complete list stays reachable.
- No external messages or automatic sending. User explicitly selects and confirms business writes.
- Frozen builds only under outer `.build/assignment-journey-20261023`; evidence under ignored `.local-review/assignment-journey-20261023`.

## Review focus

Mixed roles with different `/employees` query modes; active tasks after the first list page; zero answers versus unanswered; date interval conflicts and reserve semantics; authority/data changes between assessment, review and submit.

## Task 1: Main work and navigation

Owner: workdesk_simplification. Files: `features/portal-workspace/{workspace.tsx,workspace.module.css,desk-model.ts,work-queues.tsx}`, `components/navigation/sidebar.tsx`; existing workdesk/UI and portal-workspace/role-workdesk browser tests.

- [x] Add failing assertions that every authorized query-mode destination remains reachable after removing duplicate quick links; completed records start collapsed and returned requests remain active.
- [x] Remove right quick-link catalogue, keep admin/status primary actions; complete task navigation using full destination identity, not just base pathname.
- [x] Separate current preview/history with honest bounded labels and full-list link. Preserve scope-aware reads and concrete next actions.
- [x] Run targeted model/UI/browser tests; report exact files and evidence. Root registers new tests in the common gate.

## Task 2: Assignment context and next step

Owner: assignment_flow. Files: `features/om-assistant/{model.ts,workspace.tsx}`, `scripts/tests/om-assistant.test.cjs`, `e2e/om-assistant.spec.ts`.

- [x] Add failing tests for known date/object/count plus only missing-field questions, read-only next actor, correction anchor and retained drafts.
- [x] Implement a pure next-action presentation model, one compact recognized-context block and collapsible original instruction. Reuse current correction editor and writer.
- [x] Add optional event.progress type and mount root-owned `AssistantProgress` once after context. No duplicate dates/counts; no guessed kind or own-department target.
- [x] Run targeted tests including current revision/permission/idempotency coverage; report changes without committing shared work.

## Task 3: Candidate assessment and review

Owner: department_selection. Primary files: `features/forces-request-banner/ui/ForcesRequestBanner.tsx`, `hooks/use-forces-request-banner.ts`, relevant request/candidate types and status table integration; backend `apps/ops/forces_requests.py` and its API routes/tests. Exact helper extraction may follow existing validation boundaries; report additional ownership before editing.

- [x] Write failing backend tests: assessment is read-only, scope protected, same hard conflict as final group selection, reserve eligibility does not promise event-date availability; stale final selection remains rejected.
- [x] Expose minimal protected candidate assessment using existing rules, with explicit unavailable/unknown reasons. Avoid duplicating mutation logic or simulating writes by rollback.
- [x] Write failing browser tests: request/date/count remain visible, remaining count includes saved and selected people, candidates with restrictions are explained, named review is required before submit, changing request/selection/authority invalidates review.
- [x] Implement available-first selection only for assessed candidates, existing-context defaults, and explicit review/submit with current backend guards.
- [x] Run scoped backend/frontend tests and report limitations truthfully. Skills are considered only where the existing request defines requirements; no invented rankings.

## Task 4: Commander progress and integration

Owner: root. Files: new `features/om-assistant/{progress.tsx,progress-model.ts}`, new pure/browser tests; backend new `apps/ops/assistant/progress.py`, `execution.py` serialization and `test_ops_assistant_progress.py`. Common `scripts/gate-front.mjs`, canonical vault and deployment harness owned only by root.

Interface: `AssistantProgress({task: AssistantTask})`; optional `task.event.progress` contains published need, accepted roster count, remainder and sent department response summaries. Existing event read authorization is mandatory. Unknown demand stays unknown, numeric answer is not accepted staffing, draft requests are excluded.

- [x] Add failing projection/authorization tests for demand absent, zero/partial answers, returned/late departments, roster progress and inaccessible event redaction.
- [x] Implement read-only progress projection and compact need/roster/remainder with pending departments. Use existing stage/action authorization for links; detailed analytics remains separate.
- [x] Review each domain and combined diff; resolve cross-task mismatches, then run frontend gate, appropriate PostgreSQL tests and browser full journey on a frozen local build.
- [x] Install rehearsal then primary with fresh quiet backup and data fingerprints; inspect desktop/mobile/dark screens and actual role reads.
- [ ] Update role guide/tasks/journal/handoff, commit accepted source, publish bounded VAPS export under existing authorization and verify CI/tree. Report actual scope and remaining limitations.

## Pre-flight decisions

Task1/Task2 share assistant types but only Task2 edits model.ts. Task2/Task4 share progress contract: root owns projection/components, Task2 owns type and insertion. Task3 owns candidate API/domain only; no assistant edits. Root alone owns common gate/deployment/docs. Scoped agents may implement in parallel because files and interfaces are assigned explicitly; final integration is sequential.
