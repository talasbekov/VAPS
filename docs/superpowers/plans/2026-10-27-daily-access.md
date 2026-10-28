# Daily expense access implementation plan

> **For agentic workers:** Use superpowers:executing-plans in the assigned shared worktree. Parent coordinates final review and full integration checks.

**Goal:** Open daily expense work without granting force allocation and correct exact-division personnel reads.

**Architecture:** `/daily-expense` reuses the existing expense components and APIs. Its entry requires `status.view` plus one of `daily_report.mark_update`, `daily_report.generate`, `daily_report.correct`. `/employees` keeps its existing forces gate. Server write permissions and division flags remain authoritative.

**Tech Stack:** Next.js/React/TypeScript, Django REST Framework/PostgreSQL, Node tests and pytest.

**Spec:** Parent-approved contract in the 27 October autonomous-work session; audit `docs/vault/Аудит-проекта-2026-10-27.md`.

## Constraints

- No new permission, role grant or migration. Preserve prior uncommitted work.
- No production writes, server/browser launches, deployment or AI changes.
- Existing explicit daily links redirect only after access is known, before business components mount. Force-target links keep their meaning.
- Daily APIs keep existing status scopes; personnel.view and the shared OM registry policy are unchanged.

## Tasks

- [x] Add failing Node tests for daily task visibility, permission conjunction, preserved force denial, query preservation and role revocation.
- [x] Add the route and canonical navigation, retaining explicit legacy daily links.
- [x] Test and explain the selected role's actual shared OM read/management effect before assignment.
- [x] Add failing PostgreSQL regressions for ancestor/repeated-division requests and temporary/revoked grants; use the existing scoped permission guard.
- [x] Run focused checks and provide documentation patch text to parent. Full integration verification remains parent-owned.

## Verification

- Node: 135/135 across ten affected/regression suites, including the real legacy entry gate and redirect; `daily-access-front.log`.
- PostgreSQL: 42/42 daily API/role/expense-chain tests; `daily-access-backend-final.log`.
- Scope bug demonstrated first with four expected 200-versus-403 failures.
- An additional speculative unknown-division test was corrected after reading `subtree_ids`: the established global-reader contract is 200 with an empty list, not 403. The failed intermediate run remains in `daily-access-backend.log`.
- TypeScript initially passed. The final parallel run encountered an in-flight, root-owned AI cancellation signature mismatch at `app/settings/ai/page.tsx:50`; communicated to root for integrated verification.
- No browser/server launch, migration, grants, commit, deploy or production mutation.

## Review focus

- A status reader with no daily permission must not gain the daily workspace.
- A daily-only actor must not load force or broad personnel components.
- A force target embedded in a legacy daily URL remains a force target.
- Exact daily employee queries must not return ancestor or sibling staff outside the active grant.
- Narrow scopes never promise isolation of the shared OM registry.
