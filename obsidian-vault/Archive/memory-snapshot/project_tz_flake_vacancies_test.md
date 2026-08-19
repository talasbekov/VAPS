---
name: tz-flake-vacancies-test
description: "test_vacancies_endpoint: ночной красный гейт — баг теста, фикс Clock.today_local(); ПРОВЕРЯЙ НАЛИЧИЕ ФИКСА НА ТЕКУЩЕЙ ВЕТКЕ (worktree-дивергенция)"
metadata: 
  node_type: memory
  type: project
  originSessionId: fed59e49-d0da-4a00-bf7a-fda969e77236
  modified: 2026-07-18T22:12:45.192Z
---

**ИСПРАВЛЕНО 2026-07-10** (QA-прогон спайка 3.13). `apps/core/tests/test_staffing_api.py::test_vacancies_endpoint` детерминированно падал при `make gate` в окне **00:00–05:00 местного** (Asia/Qyzylorda, +05) и был зелён днём. Корень: тест брал бизнес-дату как `timezone.now().date()` — это дата в **UTC**, мимо `Clock`; ночью она на сутки позади местной, `local_midnight()` уводил границу за `valid_from` слота → `count == 0`.

Фикс: `today = Clock.today_local().isoformat()`. **Не** `timezone.localdate()`, как предлагал E5-ретро (AI-1): `timezone.localdate` стоит в `WALL_CLOCK_DENYLIST` AST-гарда `test_no_wall_clock_reads_in_domain_layers`; `Clock.today_local()` — единственная легитимная точка чтения времени (ARCH-DATA-022). A/B-проба сделана внутри окна (00:15 +05, та же минута/БД): с `Clock` — passed, с `timezone.now().date()` — failed.

**Урок шире одного теста:** «ночной флейк» был **багом теста**, а не свойством окружения — списывать красный гейт на tz-флейк больше нельзя. `timezone.now().date()` ≠ бизнес-дата. Выражение больше нигде в `apps/**` не встречается, но AST-гард не смотрит в тесты вовсе — расширение денилиста отложено в `deferred-work.md`. Тот же дефект-класс: `Watermark.updated_at` (`auto_now`) и `core/api/views.py:176/191/207`. См. [[test-full-concurrency-teardown]], [[vaps-arch-guards]].

**ВАЖНО (дополнено 2026-07-19, dev-story 11.1).** Фикс живёт НЕ на всех ветках. На worktree `claude/vigilant-sutherland-fddc31` (Epic 11, baseline 52e1c7d) фикса не было — последний коммит файла `c5779d9 «2.8 story»` — и гейт снова покраснел в 02:59 местного. Это [[bmad-worktree-divergence]] в чистом виде.

Порядок действий при красном `test_vacancies_endpoint`: (1) НЕ списывать на tz и НЕ ждать утра; (2) `git log -1 -- apps/core/tests/test_staffing_api.py` — есть ли фикс на ЭТОЙ ветке; (3) доказать пред-существование прогоном на baseline (`cp`-бэкап → `git checkout` изменённых файлов → прогон → восстановление из бэкапа, см. [[red-probe-backup]]); (4) порт фикса — вне скоупа любой стори, спросить Bratan (на 11.1 ответ был «портировать»); (5) проверять фикс до/после в ОДНО И ТО ЖЕ окно суток, иначе зелёный даёт смена даты, а не правка.
