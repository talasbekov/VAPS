# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**VAPS** — Personnel Records, VisitX (visitor management), and Accreditation system. Python project (inferred from `.gitignore`).

## Status

This repository is freshly initialized. No source code, build configuration, or test framework has been added yet. Commands below will need to be updated as the project takes shape.

## Common Commands

_Not yet configured — add build, lint, test, and run commands here as the project is set up._

Likely candidates once scaffolded:

```bash
# Install dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Lint
ruff check .
```

# Команда «цикл» — автономный стори-цикл BMAD

Когда Bratan пишет **«цикл»** (или **«цикл N»** — повторить для N стори подряд), веди полный цикл разработки автономно, без промежуточных вопросов.

## Изоляция контекста (экономия токенов)

- Главная сессия — **тонкий оркестратор**: читает sprint-status, выбирает стори, запускает шаги, принимает короткие отчёты, коммитит. Сама она НЕ читает большие файлы и не держит диффы.
- **Каждый крупный шаг (create-story, dev-story, review) — отдельный субагент** (Agent tool) со свежим контекстом. Промпт субагента самодостаточен: путь к стори-файлу, номер стори, команда гейта, порт БД — всё явно, без ссылок на «выше по разговору».
- **Передача состояния — только через файлы**, не через контекст: стори-файл = контракт между шагами (спека → Dev Agent Record → Review Findings), плюс sprint-status.yaml, deferred-work.md и git. Ничего из истории шага N не нужно шагу N+1, кроме того, что записано в файлы.
- Субагент возвращает **краткую сводку** (статус, результат гейта, список файлов, блокеры) — не простыни кода и не логи.
- При «цикл N» между стори тоже ничего не тащить: новая стори = новые субагенты.
- Если субагенты недоступны/запрещены и цикл идёт в основной сессии — после done каждой стори доложить итог и предложить Bratan сделать `/clear` перед следующим «цикл» (цикл stateless: всё состояние в файлах, потери нет).

## Выбор стори

1. Прочитай `_bmad-output/implementation-artifacts/sprint-status.yaml` целиком (порядок важен).
2. Возьми первую стори со статусом `ready-for-dev`; если таких нет — первую `backlog`-стори эпика со статусом `in-progress`.
3. Планово запаркованные эпики (сейчас E7 — миграция данных, ждёт parallel-run) не трогать, даже если они численно раньше.
4. Перед create-story сверься с ретроспективой предыдущего эпика: action items с критерием-гейтом обязаны попасть в спеку.

## Шаги цикла (для одной стори)

1. **create-story** (если стори в backlog): `bmad-create-story`; `baseline_commit` = текущий HEAD; факты для спеки собирать чтением реального кода (raise-сайты и типы возврата, НЕ словари/макеты).
2. **dev-story**: `bmad-dev-story`, TDD (RED обязан реально покраснеть до реализации). Гейты: `make gate` из `Backend/VAPS` (не из корня) + `npm run gate` из `frontend`, если фронт затронут. `ruff format` — только по изменённым файлам, никогда по папке. После изменения API: `make schema` + `npm run generate:api` (обе половины схемы).
3. **review**: `bmad-code-review`, 3 адверсариальных слоя. **Красная проба — обязательный гейт** для каждого важного ассерта (perf-счётчик, блокировка, scope, surfacing, аудит): мутация прод-кода → тест покраснел → откат. Бэкап мутируемых файлов через `cp`, НИКОГДА `git checkout` (стирает незакоммиченные правки). Сверить каждый чекбокс стори с фактическим кодом (дрейф чекбоксов — системная проблема dev-агентов). Патчи применить и переверифицировать гейтом; defer'ы записать в `deferred-work.md`.
4. **done**: Status → `done` в стори-файле и `sprint-status.yaml`; секция Review Findings в стори; правки стори-файла — точечными Edit, не скриптами со сборкой строк.
5. **commit**: один коммит `feat(story-X.Y): <суть>` со всеми артефактами стори (код + тесты + схемы + BMAD-трекинг), `Co-Authored-By: Claude <модель>`. `graphify update .` — отдельным chore-коммитом и только если менялся `Backend/VAPS/apps`.
6. При «цикл N» — перейти к следующей стори; иначе доложить итог и остановиться.

## Жёсткие остановки (единственные причины прервать цикл)

- **Ultra-стори**: стори, которым ретро предписал `ultra`-ревью или независимую модель (для E10 это 10.2, 10.4, 10.10). `/code-review ultra` запускает только Bratan — довести стори до статуса `review`, доложить и ждать.
- **Policy-решения**: гранты ролей в seed (раскладка PROVISIONAL — решает Bratan), продуктовые развилки, изменения контрактов, затрагивающие другие эпики.
- **Красный гейт**, не починенный за 3 подхода, или тест, падающий по причине вне scope стори.
- **Новые зависимости** (пакеты/сервисы), не заявленные в спеке.

## Окружение

- Тестовая БД: Postgres из `Backend/VAPS/docker-compose.yml` на `:5433`. Если порт занят чужим контейнером (напр. `masterqalakz-db_test-1`) — НЕ останавливать чужое; поднять изолированный `postgres:16` на `:5434` (креды vaps/vaps/vaps) и гонять pytest/spectacular с `VAPS_DB_PORT=5434`. `make gate` перед коммитом требует освобождённый 5433 — если занят, прогнать эквивалент гейта вручную на 5434 и отметить это в стори.

# BMAD Epic and Story Decomposition Rules

When creating epics and stories with BMAD, always decompose work as deeply as possible.

The goal is to create small, implementation-ready stories that can be built, tested, reviewed, and reverted independently.

## Main Rule

Do not create large stories that mix multiple responsibilities.

Bad examples:

* Build authentication
* Build admin panel
* Build Telegram bot
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
* it contains several bot commands
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

## Telegram Bot Decomposition

Split Telegram bot work into separate stories:

1. Bot initialization
2. Command registry
3. Each command separately
4. Conversation state
5. Callback handlers
6. Message templates
7. Backend API integration
8. Logs and status tracking
9. Error handling
10. Tests

Each bot command must be its own story.

## Claude Code / Shell Execution Decomposition

Split Claude Code, Codex, shell, SSH, and tmux work into separate stories:

1. Command validation
2. Execution adapter
3. Non-interactive execution
4. Interactive/tmux session handling
5. Output parsing
6. Status tracking
7. Log collection
8. Timeout handling
9. Error handling
10. Security restrictions
11. Audit log
12. Tests

Do not mix command execution, logs, status tracking, and security in one story.

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
