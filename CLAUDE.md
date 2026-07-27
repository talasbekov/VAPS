# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**VAPS** — веб-система кадрового учёта: оргструктура, штатное расписание,
статусы сотрудников и ежедневный расход личного состава. Реализуемый контур —
PersonnelStatus; исходная спека — `docs/VisitX/VAPS_7.8.2.md`.

- **Backend** — `Backend/VAPS`: Django 5.1 + DRF, PostgreSQL 16, Redis/Channels.
  Приложения: `core`, `operations`, `audit`, `notifications`, `documents`,
  `parallel_run`, `migration_legacy`.
- **Frontend** — `frontend`: Vite + React + TypeScript, типы API кодогенерятся
  из `Backend/VAPS/schema.yaml`.
- Планирование — BMAD, артефакты в `_bmad-output/`.

## Common Commands

Оба гейта запускаются **из своих папок** — не из корня репозитория.

```bash
# Backend (из Backend/VAPS) — ruff + pytest + makemigrations --check, бюджет 300s
make gate
make test-full        # полная сюита: property/concurrency/slow/golden
make schema           # регенерация schema.yaml после изменения API

# Frontend (из frontend) — tsc + eslint + vitest + build + size-gate
npm run gate
npm run generate:api  # после make schema
npm run test:e2e      # Playwright, вне npm run gate
```

Первый запуск бэка: `python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`.
Гейт сам поднимает `docker compose up -d --wait db redis`.

# BMAD Epic and Story Decomposition Rules

When creating epics and stories with BMAD, always decompose work as deeply as possible.

The goal is to create small, implementation-ready stories that can be built, tested, reviewed, and reverted independently.

## Main Rule

Do not create large stories that mix multiple responsibilities.

Bad examples:

* Build authentication
* Build admin panel
* Build user management
* Build CRUD
* Build integration
* Build API layer

Always split large work into smaller stories.

## Story Size Rules

Each story must have:

* one clear goal
* one responsibility
* one small deliverable
* clear acceptance criteria
* clear technical tasks
* clear dependencies
* clear tests
* clear files to create or modify

A story is too large if:

* it touches more than 5 files
* it mixes backend and frontend
* it mixes database and API logic
* it mixes implementation and review
* it contains several endpoints
* it cannot be tested independently
* it cannot be implemented in one focused coding session

If a story is too large, split it before finalizing.

## Required Structure For Every Story

Every story must use this structure:

```md
## Story X.Y: Title

### Goal
Short result of this story.

### Scope
What must be implemented.

### Out of Scope
What must not be touched.

### Acceptance Criteria
- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...

### Technical Tasks
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

### Files To Create
- `path/to/file`

### Files To Modify
- `path/to/file`

### Dependencies
- Depends on Story X.Y
- Blocks Story X.Z

### Tests
- Unit:
- Integration:
- Manual:

### Definition of Done
- [ ] Code implemented
- [ ] Tests added
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed
```

## Backend Decomposition

Split backend work into separate stories by layer:

1. Models
2. Migrations
3. Schemas / Serializers
4. Repository / Query layer
5. Services
6. API Views / ViewSets
7. URL routing
8. Permissions / RBAC
9. Validation
10. Error handling
11. Audit logging
12. Tests
13. Documentation

Do not combine all backend layers into one story.

## API Decomposition

Each endpoint with business logic must be a separate story.

For every API story include:

* HTTP method
* URL path
* request schema
* response schema
* permissions
* validation rules
* error responses
* tests

If one story contains multiple endpoints, split it.

## Frontend Decomposition

Split frontend work into separate stories:

1. API client
2. Page layout
3. Form
4. Validation
5. Table / list
6. Detail view
7. Loading state
8. Error state
9. Permissions / route guard
10. Tests

Do not create a story called “Build page”. Split it into smaller stories.

## Database Decomposition

Split database work into separate stories:

1. Table/model creation
2. Migration
3. Indexes
4. Constraints
5. Seed data
6. Data migration
7. Rollback strategy
8. Query optimization
9. Data integrity tests

Every risky migration must include rollback notes.

## Final Output Required

After creating epics and stories, always include:

1. Epic list
2. Story list
3. Dependency map
4. Recommended execution order
5. Risks and edge cases
6. Blockers
7. Next BMAD command

Before finalizing, check every story.

If any story is too large, split it.
If any dependency is unclear, add it.
If any test is missing, add it.
If implementation order is unclear, create dependency map first.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships. It is an OPTIONAL aid, not a mandatory step — reach for it only when it earns its keep.

Rules:
- For targeted lookups (a known file, function, symbol, or string), use grep/Read/git directly — they are faster and exact. graphify is NOT needed for these.
- Reach for graphify on BROAD or cross-cutting questions where you don't yet know where to look — "what calls X", "how does Y relate to Z across modules", architecture orientation in unfamiliar code. Then: `graphify query "<question>"` (scoped subgraph), `graphify path "<A>" "<B>"` for relationships, `graphify explain "<concept>"` for focused concepts; `graphify-out/wiki/index.md` for navigation; read `graphify-out/GRAPH_REPORT.md` only for broad architecture review.
- Updating the graph is by NECESSITY, not routine: run `graphify update .` (AST-only, no API cost) only when backend app-code (`Backend/VAPS/apps`) changes meaningfully. Skip it for throwaway spikes (`spikes/`, `deploy/spike-*`) and docs — they don't belong in the graph.
