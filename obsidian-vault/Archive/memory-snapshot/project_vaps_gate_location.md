---
name: project_vaps_gate_location
description: "Оба гейта запускаются из своих папок, не из корня worktree: make gate — Backend/VAPS, npm run gate — frontend"
metadata: 
  node_type: memory
  type: project
  originSessionId: 837d121e-78ac-4219-a990-2ffe4e307eb7
  modified: 2026-07-19T10:51:04.988Z
---

Гейт качества VAPS запускается как `make gate` **из папки `Backend/VAPS/`** — Makefile с целью `gate` там, в корне worktree его НЕТ. Запуск `make gate` из корня даёт «Нет правила для сборки цели gate» (ложный «красный гейт»). Цель gate: docker compose db (Postgres :5433) → pytest (~2100+ тестов) → ruff → makemigrations --check, ~45с.

**Фронт — тот же класс грабель, но опаснее (проверено 2026-07-19, стори 11.3).** `npm run gate` / `npx vitest run` — **из `frontend/`**. Из корня worktree vitest НЕ падает с понятной ошибкой, а молча берёт другой конфиг и прогоняет чужой набор: вместо «33 файла / 401 тест, всё зелено» выдал «7 файлов упало, 19 тестов, 25 errors». Ложный красный, который легко принять за регрессию. Признак подмены в выводе — `setup 0ms` / `environment 1ms` и заниженное число файлов.

Известный флейк в гейте: `test_vacancies_endpoint` краснит ночью 00:00–05:00 UTC в одиночку — не регрессия (см. [[project_tz_flake_vacancies_test]]).
