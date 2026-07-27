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

## BMAD

Планирование ведётся через BMAD; артефакты — в `_bmad-output/`.

**Правила декомпозиции эпиков и стори — `_bmad/custom/decomposition-rules.md`.**
Там обязательная структура стори, критерии «стори слишком большая» и порядок
декомпозиции по слоям. Правила жёсткие: если стори не проходит критерии —
дробить, а не подгонять.

Врезаны в сами воркфлоу через `_bmad/custom/bmad-create-story.toml` и
`_bmad/custom/bmad-create-epics-and-stories.toml`: файл грузится в контекст на
активации (`persistent_facts`), а проверка блокирует сохранение — стори не
сохраняется и `sprint-status.yaml` не меняется, пока есть FAIL. Читать вручную
нужно только при работе вне этих воркфлоу (например `bmad-correct-course`).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships. It is an OPTIONAL aid, not a mandatory step — reach for it only when it earns its keep.

Rules:
- For targeted lookups (a known file, function, symbol, or string), use grep/Read/git directly — they are faster and exact. graphify is NOT needed for these.
- Reach for graphify on BROAD or cross-cutting questions where you don't yet know where to look — "what calls X", "how does Y relate to Z across modules", architecture orientation in unfamiliar code. Then: `graphify query "<question>"` (scoped subgraph), `graphify path "<A>" "<B>"` for relationships, `graphify explain "<concept>"` for focused concepts; `graphify-out/wiki/index.md` for navigation; read `graphify-out/GRAPH_REPORT.md` only for broad architecture review.
- Updating the graph is by NECESSITY, not routine: run `graphify update .` (AST-only, no API cost) only when backend app-code (`Backend/VAPS/apps`) changes meaningfully. Skip it for throwaway spikes (`spikes/`, `deploy/spike-*`) and docs — they don't belong in the graph.
