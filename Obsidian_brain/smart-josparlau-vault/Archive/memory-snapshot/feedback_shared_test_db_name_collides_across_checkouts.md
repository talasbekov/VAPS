---
name: feedback-shared-test-db-name-collides-across-checkouts
description: "Флейк «дефекта ограничений БД» в Personnel-Records был гонкой за общим именем test_personnel_records между чекаутами; чинится разъездом имён, а виновника ищи по тому, куда процесс ходит, не по пути интерпретатора в ps"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 629625a1-2d16-4906-b30d-85cc3995e997
---

Тестовая БД Personnel-Records звалась `test_personnel_records` — **одно имя на весь Postgres:5434**, без разделения по чекауту или процессу. Проект выложен на машине не один раз (worktree — тоже чекаут), и параллельные прогоны делили одну базу: кто заканчивал первым, тот её и удалял из-под соседа. Починено 2026-08-04 (`test_personnel_records_<sha1(BASE_DIR)[:8]>`, переопределение `PR_TEST_DB_NAME`, регресс-тест `apps/operations/tests/test_test_db_isolation.py`).

**Why:** симптомы садились не на общий ресурс, а на прикладной тест, и читались как дефект кода. Флейкал `test_status_service.py::TestDatabaseGuarantee` ~1 прогон из 4 — то есть выглядело так, будто врут ExclusionConstraint и периметр отмены. Настоящая подпись гонки — не имя упавшего теста, а связка: `database ... does not exist` → `relation ... does not exist` → в teardown `is being accessed by other users`. Это НЕ то же, что [[project_test_full_concurrency_teardown]] (там Backend/VAPS, append-only-триггер против TRUNCATE) — не путать по слову «teardown».

**How to apply:**
- Флейк, где падают тесты про **гарантии БД**, а в логе есть «does not exist» или «accessed by other users» — сначала проверяй общий ресурс, а не логику. Диагноз ставится опытом за минуту: два одновременных прогона с общим именем против двух с разными (`PR_DB_NAME=a` / `=b`). У меня вышло 4/4 красных против 4/4 зелёных.
- **Виновника определяй по тому, куда процесс ходит за данными, а не по пути интерпретатора в `ps`** — отдельно: [[feedback_blame_by_data_destination_not_ps_path]]. Я записал в столкнувшиеся чекаут `govtech/pr_gov`, увидев его `.venv/bin/python`; на деле это был чужой интерпретатор, запущенный из каталога VAPS-worktree — у govtech `settings.test` вообще SQLite in-memory, боевая БД `organization_db:5432`, и `test_personnel_records` он создать не может. Надёжный способ — грепнуть имя БД по настройкам всех чекаутов: нашлись ровно два, оба наши.
- Третий случай одной семьи после [[feedback_docker_port_foreign_container]] и [[feedback_docker_compose_p_flag_still_collides_on_generic_name]]: **любой ресурс с родовым именем на этой машине рано или поздно столкнётся**, потому что чекаутов больше одного. Заводя БД, порт, том, префикс — сразу вешай метку чекаута.
- Что осталось необъяснённым (в коммит записано честно): в одном красном прогоне пришёл `IntegrityError` на `django_content_type.name` — колонки, которой нет ни в Django 5, ни в 6, и которой сейчас нет нигде на сервере. После разъезда имён не воспроизводился.
