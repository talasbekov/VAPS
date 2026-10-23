# Role workdesk implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Owner requested autonomous implementation of the proposed redesign; no additional design approval round.

**Goal:** Replace the link catalogue at `/workspace` with a role-specific workdesk containing actual work and a clear first action, and give the shared shell a coherent visual hierarchy.

**Architecture:** Keep existing routes, backend authorization, scope-aware protected reads and idempotent assistant writer. Reuse assistant input and self-service next-shift components. New workdesk models select presentation only; permission names and account roles are unchanged.

**Tech Stack:** Existing Next.js/React, TanStack Query, Tailwind and CSS modules. No new dependency.

**Spec:** This document records the owner's accepted direction in the preceding conversation: role home, short task navigation, one continuous assignment journey, functional assistant and visibly redesigned shell. Implementation choices: deep navy navigation; quiet neutral content; role title, one primary action, compact real work rows, secondary destinations in a disclosure. No invented metrics or claims that a bounded list covers all outstanding work.

## Global constraints

- Local Smart only; production and Digital Twin unchanged. Preserve all business data, users, grants and secrets.
- Existing worktree `codex/requirements-fixes-20261007`; base442f45ad, clean at start.
- Admin: access management first. Department: requests first. Commander: prompt and recent tasks. Employee: next shift from own server-linked record. Status manager: daily personnel action.
- Combined roles retain all authorized entries. Revocation/error hides protected data; no protected request before permission readiness.
- Desktop and mobile navigation remain keyboard operable and preserve active destination/deep links.
- Text creation uses one shared input component and existing writer; no automatically sent messages. Manual entry remains available.
- Builds only under outer `.build/role-workdesk-20261023`; evidence in ignored `.local-review/role-workdesk-20261023`. Preserve previous accepted image and backups.

## Review focus

Unknown/mixed roles; denied or failed refresh with cached rows; partial assistant pagination; offline text submission and double click; 320px long titles and dark mode. Tests cover each below.

## Task 1: Role presentation and real work

Files: new `features/portal-workspace/desk-model.ts`, `work-queues.tsx`, `workspace.module.css`; modify `workspace.tsx`; test `scripts/tests/workdesk.test.cjs`, `e2e/role-workdesk.spec.ts`.
Interfaces: `workdeskKind(tasks, administrator)` returns admin/department/commander/status/personal; `departmentWorkRow(row)` returns link/title/context/action/tone. Existing `portalWorkspace` remains the source of destination access.

- [x] Add tests proving role selection, correct request targets, zero responses distinct from unanswered, completed stages not actionable, no invented total; observe RED.
- [x] Implement role headings, dominant action, compact secondary links, actual protected assistant/department sources and self next shift.
- [x] Verify tests, empty/loading/403/503/recovery, permission changes and mixed roles in browser.

## Task 2: Shared prompt and visual shell

Files: new `features/om-assistant/brief.tsx`; modify assistant `workspace.tsx`, navigation sidebar/header/CSS and shell.
Interface: shared `AssistantBrief` takes controlled value/onChange/disabled/pending/onSubmit, used by home and assistant text mode. Existing writer owns request keys and error/retry behavior.

- [x] Add browser scenario: home prompt yields one creation with same payload, retry same request key, saved task opens; existing manual/text drafts remain intact.
- [x] Implement shared prompt, home queue and authoritative next-stage links; style shared shell, retain readable dark mode/mobile and accessible names.
- [x] Run targeted portal/assistant/navigation suites and inspect actual screenshots at320/390/1440.

## Task 3: Delivery

- [x] Run gate:front and production browser scenarios on exact frozen build; independent whole-change review and required fixes.
- [x] Install on local rehearsal then primary with fresh quiet backup and before/after data fingerprints; native role checks.
- [x] Update canonical role guide, tasks, journal and handoff with exact evidence/limitations; commit changes. Publish through existing safe VAPS export if feasible after local acceptance.

## Verified delivery

FE918/918, build45; browser31+6 passed. Native4 roles x3 widths on both local stacks.
Frozen frontend6e0fe087, unchanged backend2b5a5e68; quiet backup8ed0fee1.
Evidence is local-only under `.local-review/role-workdesk-20261023`.
VAPS publication is recorded separately after remote verification. Production and Digital Twin unchanged.
