# CLAUDE.md

This file defines how Claude Code must work in this repository.

It contains:

1. project-level development rules;
2. implementation and verification workflow;
3. optional Graphify guidance;
4. BMAD epic and story decomposition rules.

The BMAD section applies only when the user explicitly asks to create, review,
split, or update epics and stories. It must not turn a normal implementation
request into a planning exercise.

## 1. Project

**VAPS** is a personnel and operational management system that includes:

- Smart Josparlau;
- related organizational, reporting, scheduling, status, object, and access
  management modules.

Treat the repository itself as the source of truth for the current stack,
architecture, paths, commands, and implementation status. Do not infer the
technology stack from `.gitignore`, filenames, or old documentation.

Before changing code in an unfamiliar area, inspect:

- the relevant source files;
- nearby tests;
- project configuration;
- migrations and models when data is involved;
- existing architectural or product documentation;
- recent Git history when it helps explain current behavior.

If documentation and implementation disagree, do not silently choose one.
Identify the mismatch and determine which behavior the requested change should
preserve.

### 1.1 Repository Map

- `Backend/VAPS/` — target Django project (greenfield, built to canon 7.8.2
  read through `docs/RECONCILIATION.md`). All backend work happens here.
- `Backend/PersonnelStatus/` — legacy monolith, donor of logic and visual
  reference only (decision G1). Do not develop it.
- `frontend/` — Vite + React + TypeScript SPA (PersonnelStatus UI).
- `docs/` — specification hierarchy; `docs/README.md` is the index,
  `docs/RECONCILIATION.md` is the arbiter of contradictions between documents.
- `docs/registries/` — `error-codes.yaml`, `audit-events.yaml`,
  `ws-message-types.yaml`. Registries can carry donor phantoms: when verifying
  error behavior, check the actual raise sites in code, not the yaml.
- `_bmad-output/` — BMAD planning and implementation artifacts (epics, story
  files, `planning-artifacts/architecture.md` with the ARCH-* rules).
- `graphify-out/` — generated knowledge graph (see section 6).
- `spikes/`, `Прототип/`, `Smart Josparlau (Прототип HTML)/` — prototypes and
  visual references.

### 1.2 Backend Architecture (`Backend/VAPS/`)

Django 5 + DRF + drf-spectacular, Python 3.12, Postgres in gate/production
(docker compose `db`, host port 5433), SQLite for plain local pytest.

Bounded contexts live as Django apps under `apps/`:

- `core` — org structure, divisions, employees, reference data, `clock.py`
  (all "today" logic goes through Clock, never raw `date.today()`), `locks.py`,
  sensitive-field masking, authentication;
- `operations` — RBAC (`rbac/PermissionService`), employee statuses,
  daily submissions;
- `audit` — audit log (consolidation target per decision G2);
- `notifications` — notifications + WebSocket delivery;
- `migration_legacy` — legacy data import (runs in an air-gapped image).

Cross-context isolation (ARCH-004): a context imports another context only via
its `selectors.py`, never its models. Enforced by `tests/test_isolation.py` in
each app — architectural rules here are tested, not aspirational.

Auth: no passwords stored (ARCH-SEC-030 — a guard test scans string literals,
including docstrings). External JWT verification lives in `apps/core/auth/`;
an identifying request header (MVP stub for the JWT `sub`) sets
`request.actor_id`. `user_id` everywhere means the external auth account id
(ARCH-007), never `core_employees.id`.

API contract: `make schema` regenerates `schema.yaml` (drift is caught by a
gate test); the frontend generates its types from it via
`npm run generate:api` (ARCH-FE-011). After any API change run both.

Tests: pytest markers `property` (hypothesis), `concurrency`, `slow` are
excluded from `make gate` and included in `make test-full`. No factory_boy —
tests seed data directly (e.g. `bulk_create`).

### 1.3 Frontend Architecture (`frontend/`)

Target environment is a closed network: Firefox ≥ 100, no CDN or external
requests. `size-gate` enforces ≤ 300 KB gzip of JS in `dist/` and rejects any
external-host loads. Tailwind is pinned to v3.4 (v4 needs FF128+); shadcn
components are vendored by hand into `shared/ui` — never use the shadcn CLI.

Layers (ARCH-FE-013), enforced by eslint-plugin-boundaries:

- `src/app/` — entry, root App, providers, section stubs, cross-layer flow
  tests;
- `src/features/` — user-facing flows (`auth/`, `print-forms/`);
- `src/shared/` — `api/` (client, errors, `useApiMutation`, generated
  `schema.d.ts`, MSW testing), `auth/` (context, permissions, guards),
  `ui/`, `routes.ts`.

Forbidden imports: `features/A → features/B`, `shared → features/app`.

Playwright e2e (`e2e/`) is deliberately outside `npm run gate`: a broken e2e
assertion does not turn the gate red, so run e2e explicitly when touching
flows it covers.

### 1.4 Documentation Hierarchy

When product documents contradict each other, seniority is defined in
`docs/README.md`: `RECONCILIATION.md` (arbiter) → `ПланРасстановка` (MASTER)
→ `VAPS_7.8.2.md` (canon detail) → use cases → superseded/historical docs.
When documents contradict code, apply section 1 above: surface the mismatch.

## 2. Instruction Priority

When instructions conflict, follow this order:

1. the user's current request;
2. explicit repository safety and security rules;
3. established behavior verified by tests and current source code;
4. project documentation and architecture decisions;
5. this file;
6. general conventions.

Do not use this priority list to ignore a real conflict. Surface conflicts that
can affect behavior, security, data, compatibility, or scope.

## 3. Verified Commands

Do not invent setup, run, lint, migration, or test commands.

Before running a project command, verify it from the repository, for example
from:

- `README.md`;
- `pyproject.toml`;
- dependency files;
- `Makefile`;
- Docker or Compose files;
- CI workflows;
- package scripts;
- existing developer documentation.

Update this section only after the commands have been verified in the current
repository.

Both gates must be run from their own directories. Running vitest from the
repository root silently picks up a foreign config and produces a false
result.

Backend — run from `Backend/VAPS/`:

```text
Install:   python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
Migrate:   .venv/bin/python manage.py migrate
Seed:      .venv/bin/python manage.py seed_core
           .venv/bin/python manage.py seed_operations
Gate:      make gate        # ruff check + fast pytest subset + makemigrations --check;
                            # starts Postgres via docker compose (host port 5433); 300s budget
Test all:  make test-full   # adds property/concurrency/slow markers, HYPOTHESIS_PROFILE=full; 1500s budget
One test:  .venv/bin/pytest apps/core/tests/test_clock.py -k <name>
                            # plain pytest runs on SQLite; the gate runs under Postgres
Lint:      .venv/bin/ruff check .   # gate lints rules E,F only; ruff format is NOT part of
                                    # the gate — when formatting, scope it to changed files only
Schema:    make schema      # regen schema.yaml; then: cd ../../frontend && npm run generate:api
```

Frontend — run from `frontend/`:

```text
Install:   npm install       # Node >= 22.12 (.nvmrc = 24)
Dev:       npm run dev       # proxies /api/* and /ws/* to http://localhost:8000
Gate:      npm run gate      # deps-gate → schema-check → tsc -b → eslint →
                             # canon/drift self-tests → vitest run → vite build → size-gate
Test:      npm test          # vitest run
One test:  npx vitest run src/app/AppLayout.test.tsx
E2E:       npm run test:e2e  # Playwright; NOT part of the gate — run explicitly
Lint:      npm run lint
Types:     npm run generate:api   # after make schema on the backend
```

Never report a command as passing if it was not run successfully.

## 4. Working Principles

### 4.1 Understand Before Editing

Before implementation:

- identify the requested outcome;
- inspect the smallest relevant part of the repository;
- state assumptions that materially affect the solution;
- identify compatibility, migration, permission, and data risks;
- define how the result will be verified.

Ask a clarifying question when ambiguity can materially change:

- business behavior;
- access control;
- data meaning or data loss risk;
- public API contracts;
- architecture;
- irreversible operations;
- the expected user experience.

For low-risk ambiguity, choose the most conservative interpretation, state the
assumption, and continue.

### 4.2 Prefer the Simplest Complete Solution

Implement the minimum complete change that satisfies the request.

- Do not add unrequested features.
- Do not introduce abstractions without a current, demonstrated need.
- Do not add configurability only for hypothetical future use.
- Reuse existing project patterns when they are suitable.
- Prefer clear code over clever code.
- Do not remove required validation or safety checks merely to reduce code.
- Cover realistic boundaries, external failures, security conditions, and
  domain invariants.

### 4.3 Make Surgical Changes

Every changed line must be traceable to the requested result or to a necessary
verification fix.

- Do not refactor unrelated code.
- Do not reformat unrelated files.
- Match the surrounding style unless the task explicitly changes it.
- Preserve unrelated user changes in the working tree.
- Mention unrelated defects when important, but do not fix them without scope.
- Remove only imports, variables, functions, and files made obsolete by the
  current change.

If a necessary change expands the original scope materially, stop and explain
why before proceeding.

### 4.4 Preserve Existing Contracts

Unless the request explicitly changes them, preserve:

- public API request and response formats;
- HTTP status codes;
- permission behavior;
- database meaning and constraints;
- user-visible terminology;
- integration contracts;
- audit behavior;
- backward compatibility expected by existing callers.

When a contract must change, identify affected consumers and include the
required migration or compatibility strategy.

### 4.5 Protect Security and Data

- Never hardcode secrets, tokens, passwords, private keys, or credentials.
- Do not expose personal or sensitive information in logs, fixtures, errors, or
  examples.
- Preserve authorization checks and organizational scope restrictions.
- Treat migrations, bulk updates, deletes, and permission changes as high-risk.
- Use transactions and rollback strategies where appropriate.
- Do not weaken validation or access control to make tests pass.

## 5. Implementation Workflow

For a small task, work directly. For a multi-step or risky task, use a short
plan with a verification step for each item.

```text
1. Inspect relevant behavior -> verify current state
2. Implement the smallest complete change -> run targeted checks
3. Run broader relevant checks -> inspect the final diff
```

### 5.1 Before Coding

- Read the target code and nearby tests.
- Search for existing implementations of the same pattern.
- Determine whether the behavior is local or cross-cutting.
- Identify affected permissions, data, API consumers, and UI states.
- For a bug, reproduce it with a test when practical.

### 5.2 During Coding

- Keep the change cohesive.
- Add or update tests in the same change as the implementation.
- Prefer targeted edits over broad rewrites.
- Follow the existing architecture unless the task explicitly changes it.
- Re-check assumptions when repository evidence contradicts them.

### 5.3 Verification

Use the narrowest relevant checks first, followed by the broader checks justified
by the change.

Depending on repository support, verification may include:

- targeted unit tests;
- integration tests;
- API contract tests;
- permission tests;
- migration checks;
- linting and formatting checks;
- type checking;
- frontend component or end-to-end tests;
- a focused manual scenario.

Before finishing:

- inspect the final diff;
- ensure no unrelated files changed;
- confirm new behavior is covered;
- confirm existing behavior was not unintentionally changed;
- report which checks ran and their outcomes;
- report checks that could not run and the reason.

Do not claim completion when the implementation is not verified to a reasonable
degree.

## 6. Graphify

The project may contain a knowledge graph under `graphify-out/`. Graphify is an
optional aid, not a mandatory step.

Use direct repository tools for targeted questions:

- known filename;
- known symbol or function;
- exact string;
- localized implementation;
- Git history for a known file.

Use Graphify when the question is broad or cross-cutting and the relevant files
are not yet known, for example:

- what calls or depends on a concept across modules;
- how two domains relate;
- where a cross-cutting rule is implemented;
- architecture orientation in unfamiliar code.

Useful commands:

```bash
graphify query "<question>"
graphify path "<A>" "<B>"
graphify explain "<concept>"
```

Use `graphify-out/wiki/index.md` for navigation. Read
`graphify-out/GRAPH_REPORT.md` only for broad architecture analysis.

Run:

```bash
graphify update .
```

only when meaningful backend application code changes make the graph stale.
Do not update it for documentation-only changes, temporary experiments, or
unrelated files.

Do not manually edit generated Graphify output unless its documentation
explicitly requires it.

## 7. BMAD Planning Mode

Apply this section only when the user asks for BMAD planning, epics, stories,
backlog decomposition, or review of story size.

### 7.1 Main Decomposition Rule

Decompose work into the smallest **complete vertical stories** that produce a
testable result.

Each story must:

- have one clear outcome;
- represent one cohesive behavior or enabling capability;
- be implementable in one focused coding session when practical;
- include its own relevant tests;
- be reviewable and reversible independently;
- leave the repository in a valid state;
- provide value or safely enable a clearly identified next story.

A story may cross model, migration, service, API, UI, and test layers when those
changes are all necessary for one complete behavior.

Do not split a small vertical feature solely because it touches several
technical layers or more than an arbitrary number of files.

### 7.2 When to Split a Story

Split a story when it:

- contains multiple independently valuable behaviors;
- contains unrelated user flows;
- mixes a feature with an unrelated refactor;
- includes several high-risk changes that need separate rollout or rollback;
- cannot be tested meaningfully as one unit;
- has unclear ownership or dependencies;
- is too large for one focused implementation and review cycle;
- requires an enabling platform change that can be completed and verified
  independently.

File count is a warning signal, not a hard limit. Review the scope when many
files or modules are involved, but split by behavior, risk, ownership, or
release boundary.

### 7.3 When Not to Split

Do not create separate stories only for:

- a model and its required migration;
- a serializer and its endpoint;
- URL registration for a single endpoint;
- tests for newly implemented behavior;
- loading and error states required by one UI flow;
- small permission checks required by one operation;
- documentation required to complete the same change.

These belong in the same story when separating them would produce incomplete
or untestable intermediate states.

### 7.4 Enabling Stories

An enabling story is appropriate when it delivers a reusable and independently
verifiable foundation, such as:

- a shared permission service;
- a reusable integration client;
- common infrastructure;
- a large or risky data migration;
- a backward-compatible schema preparation step;
- an isolated architectural boundary needed by several later stories.

Every enabling story must name the stories it enables and explain why it should
be implemented separately.

## 8. Domain-Specific Decomposition Guidance

### 8.1 Backend

Prefer vertical stories organized around a business capability.

A backend story may include:

- model and migration changes;
- schema or serializer changes;
- repository or query logic;
- service behavior;
- API view or ViewSet;
- URL routing;
- permissions and validation;
- error mapping;
- audit logging;
- tests;
- focused documentation.

Separate a layer only when it is independently reusable, risky, deployable, or
needed by several stories.

### 8.2 API

Use one story per meaningful operation or cohesive resource behavior.

Every API story must define:

- HTTP method and path;
- request contract;
- response contract;
- permissions and scope;
- validation rules;
- relevant error responses;
- compatibility considerations;
- tests.

A complex business action normally deserves its own story. A small cohesive
CRUD resource may remain one story when its operations share the same rules and
can be implemented and verified together.

### 8.3 Database

Every database change must consider:

- schema and model consistency;
- constraints and indexes;
- existing data;
- migration order;
- backward compatibility;
- rollback or recovery;
- integrity and performance checks.

Create a separate migration story when the change is large, destructive,
long-running, requires staged rollout, or must be deployed independently.

### 8.4 Frontend

Split by user-visible workflow, not automatically by component type.

A complete frontend story may include:

- API client changes;
- page or component UI;
- form and validation;
- loading, empty, and error states;
- permissions and route guards;
- accessibility behavior;
- tests.

Separate reusable components or infrastructure only when they have a clear
independent contract and more than one current consumer.

### 8.5 Telegram Bot

Split by complete command or conversation flow.

A story may include:

- command registration;
- handlers and conversation state;
- callbacks;
- message templates;
- backend integration;
- permissions;
- error handling;
- tests.

Separate shared bot infrastructure only when several flows depend on it.

### 8.6 Command Execution, Claude Code, Codex, Shell, SSH, and tmux

Split by independently verifiable capability or security boundary, such as:

- command policy and validation;
- non-interactive execution;
- interactive session management;
- output and status handling;
- timeout and cancellation;
- logs and audit;
- security restrictions.

Do not split output parsing, error handling, and tests away from the execution
behavior that requires them unless they are shared infrastructure.

## 9. Required Story Structure

Use this structure for every implementation story:

```md
## Story X.Y: Title

### Outcome
One concise, testable result.

### User or Business Value
Why this result matters and who benefits.

### Context
Current behavior and relevant constraints.

### In Scope
- Required behavior.

### Out of Scope
- Explicit exclusions.

### Acceptance Criteria
- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...

### Technical Notes
- Existing patterns or architectural constraints.
- API, data, permissions, compatibility, and audit considerations.

### Expected Files
- `path/to/file` — only when confirmed by repository inspection.
- Mark uncertain paths as `TBD after repository inspection`.

### Dependencies
- Depends on: Story X.Y / None
- Blocks: Story X.Z / None

### Risks and Edge Cases
- Risk or edge case.

### Verification
- Unit:
- Integration:
- Permission:
- Migration:
- Manual:

### Definition of Done
- [ ] Acceptance criteria satisfied
- [ ] Implementation completed
- [ ] Relevant tests added or updated
- [ ] Relevant tests passing
- [ ] Lint, formatting, and type checks passing where configured
- [ ] Permissions and organizational scope verified
- [ ] Migration and rollback considerations documented where relevant
- [ ] No secrets or sensitive data introduced
- [ ] Documentation updated where required
- [ ] Final diff contains no unrelated changes
```

Do not invent exact file paths before inspecting the repository. Expected files
are planning guidance, not a contract that forbids necessary changes discovered
during implementation.

## 10. Epic Requirements

Every epic must contain:

- objective;
- business value;
- actors or affected roles;
- in-scope capabilities;
- out-of-scope capabilities;
- assumptions;
- dependencies;
- risks;
- success measures;
- ordered stories.

Avoid epics named only after a technical layer such as “Backend”, “Database”, or
“Frontend” unless the epic is genuinely infrastructure-focused.

## 11. Required BMAD Output

After creating or revising epics and stories, include:

1. epic list;
2. story list with concise outcomes;
3. dependency map;
4. recommended execution order;
5. risks and edge cases;
6. blockers and unresolved decisions;
7. the next recommended BMAD command.

Use a dependency map only when it makes ordering clearer. Keep the map readable
and avoid dependencies created only by unnecessary layer-based splitting.

## 12. Final BMAD Quality Check

Before finalizing the backlog, verify:

- Does each story produce a complete and testable result?
- Are tests included with implementation?
- Does each dependency represent a real technical or product constraint?
- Can stories be implemented without leaving broken intermediate states?
- Are risky migrations and permission changes explicit?
- Are file paths based on repository evidence rather than guesses?
- Is the execution order clear?
- Is any story split only because it crosses technical layers?
- Could any stories be combined without increasing risk or ambiguity?
- Does every story avoid unrelated work?

If a story is too large, split it by behavior, risk, ownership, or release
boundary. If stories are too fragmented, combine them into a complete vertical
slice.

## 13. Completion Reporting

When finishing implementation work, report:

- what changed;
- what user-visible or system behavior now works;
- which tests and checks ran;
- any checks that could not run;
- remaining risks, limitations, or follow-up work.

Keep the report factual. Do not claim tests, compatibility, or completion that
was not verified.
