---
name: reference-vaps-test-run-recipe
description: "Как прогнать тесты Backend/VAPS точечно без make gate (Postgres на 5434, sqlite не тянет)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3aac1636-d916-401c-b1b4-1854aeb3784d
---

Точечный прогон тестов `Backend/VAPS` (без полного `make gate` с docker compose):

```
VAPS_DEBUG=1 VAPS_DB=postgres VAPS_DB_NAME=<uniq> VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps \
  VAPS_DB_HOST=localhost VAPS_DB_PORT=5434 \
  .venv/bin/pytest apps/core/tests/test_masking.py -q -p no:cacheprovider
```

- **`VAPS_DEBUG=1` обязателен с 2026-08-08** (fail-closed дефолты, коммит 853dad17):
  без него DEBUG=False → settings падают `ImproperlyConfigured` на SECRET_KEY.
  Makefile-таргеты его уже экспортируют, прямой pytest — нет.
- **Свежий venv ловит битую связку** pytest 9.1.1 + pytest-django 4.13.0
  (`AttributeError: _pre_setup_ran_eagerly` в db-фикстуре) — диапазонные пины без
  lock-файла; пиновать `pytest==9.0.3 pytest-django==4.12.0`.

- **sqlite-фолбэк НЕ работает** для тестов с миграциями: миграция append-only
  триггера аудита (`CREATE OR REPLACE FUNCTION audit_logs_reject_modification`,
  ARCH-SEC-032) — чистый Postgres SQL, на sqlite падает `near "OR": syntax error`.
  sqlite годится только для ORM-free юнитов.
- Мой контейнер `vaps-db-5434` (Postgres, креды `vaps/vaps/vaps`, роли `postgres`
  нет) держит порт **5434** — 5433 занят чужим (masterqalakz). Имя тест-БД давать
  уникальным (`test_<uniq>`), чтобы не столкнуться с параллельной сессией.
- `.venv` в worktree бывает НЕПОЛНЫМ (нет `channels`, `sentry_sdk`): доставить
  `.venv/bin/pip install -e '.[dev]'`. Импорт `sentry_sdk` в `config/settings.py`
  сделан ленивым (внутри `if _SENTRY_DSN`) — без DSN приложение грузится без пакета.

Гейт целиком: `make gate` из `Backend/VAPS` (см. [[project-vaps-gate-location]]).
