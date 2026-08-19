# CLAUDE.md

This file defines how Claude Code must work in this repository.
Вообще не останавливайся. Как только заканчиваешь одну задачу, очищаешь сессию /clear и дальше начинаешь следующую задачу выполнять. 
It contains:

1. project-level development rules;
2. implementation and verification workflow;
3. optional Graphify guidance;
4. BMAD epic and story decomposition rules.

The BMAD section applies only when the user explicitly asks to create, review,
split, or update epics and stories. It must not turn a normal implementation
request into a planning exercise.

## 1. Project

**VAPS** is a personnel and operational management system. The live product
today is **Personnel-Records** (Django backend) + **PersonalRecordFront**
(Next.js frontend), under `Backend/PersonnelStatus/`.

A parallel greenfield stack (`Backend/VAPS/` + top-level `frontend/`) was
built earlier and withdrawn from active work on **2026-08-12** (commit
`c3fdc293`, decision by the project owner after a smoke-test walkthrough).
Those directories may still be physically present in the tree — do not treat
their contents, or any documentation written for them, as canon. If you find
yourself editing under `Backend/VAPS/` or top-level `frontend/`, stop and
confirm that's actually intended.

Treat the repository itself as the source of truth for the current stack,
architecture, paths, commands, and implementation status. Do not infer the
technology stack from `.gitignore`, filenames, or old documentation —
including this file: verify a claim against the actual code before relying on
it for anything consequential (migrations, security, contracts).

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

- `Backend/PersonnelStatus/Personnel-Records/` — live Django backend.
  Commonly run on `:8100`.
- `Backend/PersonnelStatus/PersonalRecordFront/` — live Next.js frontend.
  Commonly run on `:3106`. No fixed port in `package.json`/`next.config` —
  confirm the actual launch convention before assuming one.
- `Backend/VAPS/`, `frontend/` — the withdrawn greenfield stack (see §1).
  Historical reference only.
- `docs/` — specification hierarchy; untracked except `docs/registries/`
  (`.gitignore`: `docs/*` + `!docs/registries/` — donor material and PII stay
  off the remote). `docs/README.md` is the index, `docs/RECONCILIATION.md` is
  the arbiter of contradictions between documents — but `docs/README.md`'s
  own repository-map section still names `Backend/VAPS/` as "the target
  project"; that line predates the 12.08 pivot and is itself stale. Don't
  trust any `docs/` claim about "the current backend" without cross-checking
  the live code.
- `docs/registries/` — `error-codes.yaml`, `audit-events.yaml`,
  `ws-message-types.yaml`. Registries can carry donor phantoms: when verifying
  error behavior, check the actual raise sites in code, not the yaml.
- `_bmad-output/` — BMAD planning and implementation artifacts (epics, story
  files, `planning-artifacts/architecture.md` with the ARCH-* rules).
- `graphify-out/` — generated knowledge graph (see section 6). **Stale** —
  built against the withdrawn `Backend/VAPS/`; run `graphify update .` before
  trusting it for the live stack.
- `spikes/`, `Прототип/` — spike and prototype material. `deploy/` currently
  holds only a single spike (`spike-1.9`) — no live deployment orchestration
  exists at the repo root today.
- No root-level `Makefile` or `package.json`. Nothing at the repo root
  orchestrates backend and frontend together — each is installed, run, and
  tested independently from its own directory (§3).

### 1.2 Backend Architecture (`Backend/PersonnelStatus/Personnel-Records/`)

Django 5.1.15 + DRF 3.17.1 + drf-spectacular 0.29.0, Python 3.12,
djangorestframework-simplejwt 5.5.1 for auth.

Settings live under `organization_management/config/settings/`:

- `base.py` — shared `INSTALLED_APPS`, middleware, auth config;
- `production.py` — Postgres + Redis (Celery, Channels); used by
  `docker/entrypoint.sh`, which runs `migrate` then execs the given command;
- `sqlite.py` — file-based SQLite, in-memory cache/channels, `DEBUG=True` —
  local dev without Docker;
- `local_postgres.py` — layers Postgres onto `sqlite.py`'s other settings
  (cache/channels/logging stay local-dev-shaped, only `DATABASES` changes);
- `test.py` — in-memory SQLite, dummy cache, eager Celery, migrations
  disabled; `pytest.ini` pins `DJANGO_SETTINGS_MODULE` to this.
- `manage.py` defaults to `production` settings if `DJANGO_SETTINGS_MODULE`
  is unset — always export it explicitly.

Apps under `organization_management/apps/` (verified against `origin/main`):

- `audit` — audit log (CRUD + custom events);
- `common` — roles/permissions, IP-logging middleware, shared utilities;
- `core` — a thin projection of the donor's core contract over
  divisions/employees/dictionaries; no models of its own (see
  `apps/core/api/serializers.py`);
- `dictionaries` — reference data / lookup tables;
- `divisions` — org hierarchy (MPTT tree);
- `documents` — a thin projection of the donor's documents contract over the
  same rows `operations`'s attachment-download endpoint serves;
- `employees` — employee records; its own API router is wired in
  `config/urls.py` but currently commented out;
- `notifications` — notifications + WebSocket delivery;
- `operations` — the large native-ported core: daily statuses/submissions,
  catch-up clock (`catch_up.py`, `clock.py`, `lagging_check.py`), expense
  reports (`expense_*.py`), traffic-light — **and** the models for the
  «Охранные мероприятия» / раздел ОМ domain (`models_event.py`,
  `models_object.py`, `models_duty.py`, `models_combat.py`,
  `models_rating.py`, `models_feedback.py`, `models_settings.py`,
  `models_report.py`, `models_watermark.py`). ОМ models live here even though
  its API surface is a separate app;
- `ops` — the API/URL surface for the раздел ОМ resources whose models live
  in `operations` (per `config/urls.py`: "Модели живут в apps/operations
  рядом с остальными ОМ, здесь — только адреса"); backs the frontend's
  `/security-ops/*` route group (§1.3);
- `reports` — reporting/analytics;
- `secondments` — secondment/delegation; the donor route was disabled since
  import (it referenced a custom-user `role`/`division` the target model
  doesn't have) and was re-enabled after porting the area onto
  `User → Employee → StaffUnit → Division`;
- `staff_unit` — staff unit/position structures; its
  `directorate_management` endpoint is role-gated (ROLE_3/6/7) and is the
  single data source behind both `/employees` and `/statuses` on the
  frontend — a 403 there must close the whole page, not just a widget (§1.3);
- `statuses` — employee status lifecycle.

URL routing (`config/urls.py`): `/api/token/` + `/api/token/refresh/`
(SimpleJWT), `/api/schema/` + `/docs` + `/redoc` (drf-spectacular, schema
cached 1h), then `/api/{common,operations,core,documents,ops,staff_unit,
statuses,secondments,reports,notifications,audit,dictionaries,divisions}/`.
`/api/employees/` exists in code but is commented out.

Auth: JWT via `djangorestframework-simplejwt`. `POST /api/token/` returns
`{access, refresh, user: {..., role}}`; the frontend's NextAuth
`CredentialsProvider` bridges this into a session (§1.3).

### 1.3 Frontend Architecture (`Backend/PersonnelStatus/PersonalRecordFront/`)

Next.js 15.2.4 (App Router) + React 19 + TypeScript + Tailwind CSS 3.4 +
`@tanstack/react-query` 5.90.

Directory layout:

- `app/` — App Router routes: `dashboard/`, `employees/`, `organization/`,
  `statuses/`, `reports/`, `feedback/`, `api/auth/` (NextAuth), and
  `security-ops/` — 20+ route groups implementing the «Охранные мероприятия»
  / раздел ОМ module (events, objects, duties, combat, ratings,
  daily-expense, feedback, dictionaries, analytics, service-reports,
  settings, audit, gvo, laws, persons, command-center, changelog, calendar);
- `components/` — shared/shadcn-style UI components;
- `entities/` — domain models (`employee/`, `status/`);
- `features/` — feature modules (`add-employee`, `edit-profile`,
  `feedback-chat`, `notifications`, `organization-structure`,
  `secondment-requests`, `send-feedback`, ...);
- `hooks/` — data-fetching hooks (react-query wrappers over `lib/api.ts`);
- `lib/` — `api.ts` (API client, see below), `auth-config.ts` (NextAuth),
  `auth.tsx`, `ops-env.ts` (live/mock toggle for раздел ОМ, see below);
- `widgets/` — composed UI (calendars, KPI cards, steppers, ...);
- `mocks/ops/` — MSW fixtures for раздел ОМ when a domain is in mock mode.

`lib/api.ts` is not a single generated client — at least two error models
coexist, and more than one call site still throws a bare `Error` with no
typed status at all. Check the specific method you're touching rather than
assuming one shape project-wide:

- `OpsApiError` — раздел ОМ (`/api/ops/*`); answers with an
  `{error_code, message, details}` envelope;
- `ApiHttpError` — the older per-endpoint style (`staff_unit` and
  neighbours); the backend answers with `{"error": "..."}` or bare text, no
  envelope. Introduced 18.08.2026 for the `/employees` and `/statuses`
  403-guard (see below) — most older call sites still throw plain `Error`.

Раздел ОМ (`/security-ops/*`) live/mock toggle: `lib/ops-env.ts`. Per-domain
data source is controlled by `isDomainLive()` — **live by default** since the
ОМ backend was closed out (2026-08-10); `NEXT_PUBLIC_OPS_MOCK_DOMAINS` is the
opt-**out** (comma-separated domains to force back onto MSW mocks), not an
opt-in. `NEXT_PUBLIC_OPS_DATA_SOURCE=api` is a *separate* switch that only
controls the WebSocket notification transport (host-MSW vs real socket) — do
not confuse the two; read the comment block at the top of `lib/ops-env.ts`
before touching either.

`/employees` and `/statuses` are both entirely fed by one endpoint
(`staff_unit`'s `directorate_management`, role-gated ROLE_3/6/7): a 403 there
must close the whole page (`DirectorateAccessNotice`), not degrade into
zero-filled counters and empty filters. Follow this pattern if you add
another screen with a single all-or-nothing data source.

Frontend does **not** auto-generate types from the backend's OpenAPI schema —
no `generate:api` step exists. Backend response shapes are hand-mirrored as
TypeScript interfaces in `lib/api.ts`; keep them in sync manually when the
backend contract changes.

### 1.4 Documentation Hierarchy

`docs/README.md` still defines seniority: `RECONCILIATION.md` (arbiter) →
`PersonnelStatus/ПланРасстановка` (MASTER) →
`PersonnelStatus/VAPS_7.8.2.md` (canon detail) → use cases →
superseded/historical docs. This hierarchy structure appears intact, but
apply §1's rule here too: `docs/README.md`'s own repository-map still calls
`Backend/VAPS/apps/` "the target project" — that predates the 12.08 pivot and
is stale. When a `docs/` claim is about "the current backend," cross-check
the live code before trusting it.

Note: `docs/` is deliberately untracked (`.gitignore`: `docs/*` with the sole
exception `!docs/registries/` — donor material and PII stay off the remote).
A clone or tarball of the remote therefore contains only the registries. Do
not conclude from remote contents that the documentation hierarchy is missing
or stale, and never "fix" this by committing `docs/` content.

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
repository. Where a command below is marked "not independently re-verified,"
confirm it works before relying on it — don't propagate the gap by copying it
into a future edit without checking.

Backend — run from `Backend/PersonnelStatus/Personnel-Records/`:

```text
Install:    pip install -r requirements.txt
                              # Python 3.12; requirements.txt has no separate [dev] extra
Settings:   export DJANGO_SETTINGS_MODULE=organization_management.config.settings.<sqlite|local_postgres|test|production>
                              # manage.py defaults to production if unset — always set this explicitly
Migrate:    python manage.py migrate
Seed:       python scripts/create_users.py
                              # per repo docs; not independently re-verified this session
Test:       pytest            # pytest.ini pins settings.test (in-memory SQLite, migrations disabled)
Schema:     python manage.py spectacular --file schema.yaml
                              # drf-spectacular is installed; exact flags not independently
                              # re-verified this session — check `manage.py spectacular --help`
Docker:     docker/entrypoint.sh runs `migrate` then execs the given command under settings.production
CI:         .github/workflows/ci.yml runs `python manage.py makemigrations --check --dry-run`
```

No repo-root or backend-root `Makefile` was found, and no dedicated lint
command was found for the backend this session — do not assume `ruff`,
`black`, or `flake8` are wired; check `requirements.txt`/CI before inventing
one.

Frontend — run from `Backend/PersonnelStatus/PersonalRecordFront/`:

```text
Install:    npm install
Dev:        npm run dev       # `next dev --turbo`; no fixed port in config — commonly run as
                              # `npx next dev -p 3106`, backend expected on :8100
Build:      npm run build     # next build
Start:      npm run start     # next start, after build
Lint:       npm run lint      # next lint
Test:       not wired as an npm script — jest ^29.7.0 is a devDependency; invoke directly
                              # (`npx jest`) and verify config before relying on it
E2E:        not wired as an npm script — @playwright/test ^1.56.1 is a devDependency; a
                              # smoke config exists at playwright.smoke.config.ts
                              # (`npx playwright test --config=playwright.smoke.config.ts`) —
                              # verify the exact invocation before relying on it
```

No `generate:api` step exists — API types are hand-maintained in `lib/api.ts`
(§1.3), not generated from the backend schema.

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
- Work only on top of the current HEAD and produce delta patches against it.
  Never regenerate a file from an older baseline, an earlier snapshot, or
  memory of a previous version — that silently reverts commits that landed in
  between.

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

Commit discipline: a Graphify update is always its own separate `chore`
commit — never mixed into a commit with code changes, and never applied via
history rewrite or force-push. A graph regeneration must not be able to
revert or absorb anyone's code.

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

No Telegram bot exists in the repository today; it appears only in product
documents as future scope. This subsection is planning guidance for when that
module is actually commissioned — do not create bot stories or scaffolding
before then.

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

When the work includes commits or pushes, verify them before reporting:
confirm the commit exists by SHA in `git log`, and when pushing, confirm the
SHA is present on the remote (`git ls-remote` / branch tracking status).
Report the SHA itself, not just "committed". Trust the diff and the log, not
an execution transcript.

Keep the report factual. Do not claim tests, compatibility, or completion that
was not verified.
