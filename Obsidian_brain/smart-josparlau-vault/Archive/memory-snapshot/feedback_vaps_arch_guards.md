---
name: feedback_vaps_arch_guards
description: "VAPS has tested architectural guards that BMAD story specs keep colliding with — check them at story-writing time, not just at gate"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4528e0ad-d3ce-4698-a732-a9ac699ef60d
  modified: 2026-07-19T15:48:42.714Z
---

VAPS enforces several architectural invariants as **tested guards** that fail the gate if violated. During E5 work (2026-06-29) auto-generated story specs collided with them TWICE: story 5.2 Task 3 told me to register a business model in Django Admin (violates `test_admin_registry_is_exactly_catalogs`, ARCH#L467/L485), and the 5.3a story I wrote told the dev to `import apps.core.models` inside `apps/operations/...` (violates `test_operations_does_not_import_core_models`, ARCH-003 isolation).

**Why:** create-story / research output describes the *mechanism* (e.g. "query Employee.objects...") without re-checking the *guards*, so the constraint surfaces only at `make gate` (or worse, slips through). Catching it at planning time is cheaper and keeps the story honest.

**Повторилось на 11.6 (2026-07-19), уже ТРЕТИЙ и ЧЕТВЁРТЫЙ раз, и один случай был неразрешим внутри стори.** Спека 11.6 предписывала (AC-10) добавить `uvicorn` в dev-extra, а `apps/notifications/tests/test_ws_guards.py::test_no_server_or_worker_stack_is_introduced` (заведён 11.1) запрещал `daphne`/`uvicorn`/`celery` в ЛЮБЫХ группах зависимостей — прямое противоречие, которого спека не заметила, хотя разбирала uvicorn целым Решением №2. Дев-агент остановился и эскалировал; решением Bratan клауза сужена до runtime-группы. Заодно тот же прогон поймал `apps/core/tests/test_isolation.py::test_x_user_id_literal_only_in_core_auth` — он краснеет на литерале `X-User-Id` даже в тексте `help` management-команды (сканируются строковые константы всех модулей вне `core/auth`), и `test_isolation` в `operations` распространяется на management-команды тоже (папка `commands/` не `tests/`), поэтому фикстуре пришлось писать watermark через шлюз `apps.core.watermark`, а не `Watermark.objects`.

**How to apply:** Known guards to respect when writing/implementing VAPS stories — `apps/notifications/tests/test_ws_guards.py` (нет серверов/воркеров в зависимостях: daphne/celery запрещены везде, uvicorn — только dev-extra; плюс запрет in-memory channel layer); `apps/core/tests/test_isolation.py` (литерал `X-User-Id` — только в `core/auth`, включая тексты сообщений; wall-clock denylist); `apps/operations/tests/test_isolation.py` (operations ↛ `apps.core.models`: cross-context reads go through **core selectors** like `CoreEmployeeSelector`/`CoreDivisionTreeSelector`, flat UUIDs, ARCH-003 — add a denorm method to the core selector rather than importing the model); `apps/core/tests/test_admin_platform.py` (Django Admin holds ONLY справочники + `auth.Group` — business models are service-only-write, never admin-registered); audit-coverage CI (story 4.6). When a story touches `operations`, admin, or audited mutations, scan these guards FIRST and bake the constraint into the tasks. Related: [[project_vaps_architecture]], [[feedback_vaps_db_integrity_checks]].
