---
name: project-test-db-collision-parallel-sessions
description: Тестовая БД разведена ПО ЧЕКАУТУ; две сессии в ОДНОМ чекауте всё ещё дерутся — ручка PR_TEST_DB_NAME
metadata: 
  node_type: memory
  type: project
  originSessionId: 807ec139-f00d-43a7-b082-3b6f841e9206
---

`config/settings/test.py` даёт тестовой базе имя `test_personnel_records_<sha1(BASE_DIR)[:8]>`. Это развело РАЗНЫЕ чекауты (см. историю ниже), но две сессии, работающие в ОДНОМ worktree, получают одно имя и продолжают дропать базу друг под другом.

Подпись: `database "test_personnel_records_<tag>" does not exist — It seems to have just been dropped or renamed` (раньше — `is being accessed by other users`). Падают КАЖДЫЙ РАЗ РАЗНЫЕ тесты, в том числе заведомо детерминированные (чистая функция без БД и async). Плагинов рандомизации в проекте нет — «падают разные» значит внешнее условие, а не порядок. Это НЕ регресс кода.

**Как разводить:** `PR_TEST_DB_NAME=<уникальное>` — именно она, а НЕ `PR_DB_NAME` (та про рантайм-базу и для изоляции прогонов бесполезна; между разными чекаутами разводит сам `_CHECKOUT_TAG`). С 2026-08-06 ручка больше не краснит `test_test_db_isolation` (коммит 9f4172f на claude/smart-josparlau-e55).

**Прежде чем чинить «флейк»:** `ps -eo pid,args | grep pytest` — в чужом worktree часто уже работает соседняя сессия.

Связано: [[feedback-docker-port-foreign-container]], [[feedback-parallel-story-commit-sweep]], [[feedback_shared_test_db_name_collides_across_checkouts]], [[feedback_blame_by_data_destination_not_ps_path]].
