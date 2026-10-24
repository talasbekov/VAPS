---
name: feedback_stand_postgres_conn_exhaustion
description: Повторные e2e-прогоны исчерпывают соединения Postgres 5434 — падают РАЗНЫЕ спеки, лечится перезапуском Django
metadata:
  type: feedback
---

Симптом: после нескольких прогонов Playwright по стенду начинают падать
разные спеки в общем прогоне, а поодиночке каждая зелёная. Ошибки в консоли
страницы — 500, в логе Django:
`OperationalError: FATAL: sorry, too many clients already` (Postgres на 5434).

**Why:** `manage.py runserver --noreload` держит соединение на поток, потоков
при обходе страниц набирается много, `max_connections=100` кончается. После
остановки Django остаётся 6 соединений — значит держал их именно он.

**How to apply:** «падают разные тесты» = внешнее условие, не регресс твоей
правки (см. [[project_test_db_collision_parallel_sessions]] — там тот же
признак по другой причине). Проверять: `docker exec vaps-db-5434 psql -U vaps
-d postgres -tAc "select count(*) from pg_stat_activity"`. Лечение —
перезапуск Django; поднимать стенд заново командой из
`Personnel-Records`: `DJANGO_SETTINGS_MODULE=organization_management.config.settings.local_postgres ./.venv/bin/python manage.py runserver 0.0.0.0:8100 --noreload`.
Не гонять полный `smoke-buttons.spec.ts` без нужды — он же однажды выел
память и OOM-killer снял оба сервера стенда.
