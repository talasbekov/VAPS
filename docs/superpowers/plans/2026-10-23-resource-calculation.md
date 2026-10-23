# Resource calculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Bring the supplied route/group calculation prototype into existing Smart OM with scoped server persistence and a simple screen.

**Architecture:** Dedicated OneToOne calculation aggregate, revision-checked scoped API, independent feature editor, event entry and role workdesk. Preserve shared physical segment semantics and saved-only exports.

**Tech Stack:** Existing Django/DRF/PostgreSQL, python-docx, Next/React/TypeScript; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-resource-calculation.md`

## Global Constraints

- Separate planning data; never mutate real staff/rosters/vehicle allocations.
- No automatic grants to existing accounts, no production/DT deployment, no prototype secrets/sample data.
- GET read-only, atomic revision-checked writes, owner-scoped permissions, closed events read-only.
- Shared segment assignment across routes; distinct groups in totals; saved-only exports.
- Existing isolated branch/worktree; preserve other work. Temporary build sources only outer `.build`; no cleanup-policy retries.

## Review Focus

1. Foreign-owner document access through direct URL/export/list and unscoped fallback.
2. Two clients save version zero or stale version concurrently.
3. Draft removal of a shared route or catalog entity followed by cancel/export.
4. Unknown end date, changed event dates, archived export snapshots.
5. Small screen, no permissions, empty list, stale failure and revoked access after initial load.

## Task 1 — Backend aggregate, authorization and exports

Files BE `organization_management/apps/operations/models_resource_calculation.py`, models.py import, migration0147; `ops/resource_calculation.py`, `ops/resource_calculation_documents.py`, `ops/api/views_resource_calculation.py`, urls.py; new backend tests. Update permission catalog and seed template narrowly as required; coordinate role metadata with Task3, Task1 owns backend files.

Interface: exact API and JSON types in spec. Model owner immutable; event snapshot server-derived; expectedVersion mandatory. New profile `RESOURCE_CALCULATION_PLANNER` has event.view + calculation view/manage and is not assigned to users.

- [x] Add meaningful failing regression tests for validation/shared segments/scope/stale writes/closed exports.
- [x] Implement model/additive migration, pure validation/summaries, scoped API and DOCX/JSON.
- [x] Run focused PostgreSQL tests and migration check; independently review fixes.

## Task 2 — Calculation feature screen

Files FE `features/force-calculation/*`, `app/security-ops/events/[id]/force-calculation/page.tsx`, focused pure tests. Task2 owns only these feature/route files. Task3 owns browser tests and entry points.

Consumes exact API contract. Export main `ForceCalculationWorkspace` accepting `{eventId: string}`. Pure helpers shared in own feature: summary/row removal/group availability/validation, only export types/helpers when necessary. Protected downloads use existing utility.

- [x] Test unique totals, shared removal, draft cancel and selection logic.
- [x] Implement one view/edit workflow, inline catalogs, issue list, conflict/access states, saved print + Word/JSON.
- [x] Run focused tests/types and review responsive output with Task3.

## Task 3 — Role entry, event navigation and scenario checks

Files FE `features/portal-workspace/{desk-model,workspace,work-queues}.tsx/ts` as needed, `app/security-ops/events/[id]/page.tsx` or event header component, new e2e resource-calculation.spec.ts; docs/vault role guide. No Task2 feature edits without coordination, no backend edits.

Consumes profile/new permission codes and list API. Introduce resources workdesk for a user whose primary permission is calculation; preserve existing multi-role priorities. One event entry, no new global sidebar section/stage. Profile access guide explains event.view broad existing semantics vs scoped calculation.

- [x] Test profile routing, visibility and no regression for existing roles.
- [x] Implement minimal entry/workdesk and manual role assignment guidance.
- [x] Browser scenarios: empty/create/save/reload/shared segment/cancel/export conflict/readonly/error/mobile using isolated fixtures, no business mutations on existing live events.

## Task 4 — Integration and delivery (root)

- [x] Resolve interface differences, run independent code/security/UX review and fixes.
- [x] Freeze source and run gate:front, full PostgreSQL pytest and migration check with isolated test DB.
- [x] Build offline images; rehearse additive migration on local clone with backup, compare preserved business tables/role assignments.
- [x] Install accepted local version with backup; verify HTTP and role paths without changing existing operational data.
- [ ] Update canonical notes/status/access instructions; bounded VAPS publication under prior authorization only after acceptance, preserving unrelated files. Report exact remaining constraints and no production claim.

Local acceptance complete: fresh backend 7722 passed / 1 skipped, migration check, frontend 945/945 and production build45; production browser29/29, native15/15 on each local stack. Existing data and role assignments preserved; one additive calculation table and narrowly enumerated metadata only. Source f1092e93, frozen final4. VAPS publication remains the final delivery step; production/DT unchanged.
