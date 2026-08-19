---
name: project_e3_retro_blockers
description: Два реальных бага из E3 должны быть закрыты ДО стори Epic 4 — иначе аудит зафиксирует некорректные мутации и будущие даты
metadata: 
  node_type: memory
  type: project
  originSessionId: bc4b7586-f856-4364-8664-7fee1c01d30d
---

Ретроспектива Epic 3 (2026-07-10, `_bmad-output/implementation-artifacts/epic-3-retro-2026-07-10.md`) выделила **два предварительных ремонта, которые обязаны приземлиться до Epic 4** (audit). Оба найдены стори 3.13/3.14, оба намеренно НЕ починены там (прод-код не трогали), оба ждут решения/работы.

**T1 — `update_status` асимметричен.** `status_service.py` (`update_status`) не вызывает `_lock_for_edit` и не проверяет `cancelled_at` — отменённый статус можно молча отредактировать. Тот же класс, что HIGH-баг 3.6 (`cancel_status` без `refresh_from_db()` → lost update append-once фактов). **Why:** стори 4.4 обязана писать `before/after` по каждой мутации E3; аудит правки отменённого статуса — восстановимая история бессмыслицы. Чинить ДО 4.4.

**T2 — нет forward-guard часов.** `CATCHUP_MAX_DAYS=400` — это chunk-cap, а НЕ hard-stop: прыжок часов на N дней вперёд материализует все N дней за `⌈N/400⌉` прогонов, верхнего sanity-потолка нет. Сегодня безвредно **ровно потому, что `materialize_day_effects` — no-op**; откат = `UPDATE core_watermarks SET last_materialized_date=…` (RUNBOOK, Вариант C). **Why:** стори 4.1 (AuditLog) — это и есть триггер, после которого catch-up начнёт писать реальные строки за будущие даты и откат перестанет быть бесплатным. Потолок `N` — продуктовое число за Bratan; гардом на CLI не закрывается (beat читает `Clock.today_local()` напрямую). Чинить ДО 4.1.

**How to apply:** при `bmad-create-story` для 4.1/4.4 — сначала проверь, закрыты ли T1/T2; если нет, поставь их предшественниками в дерево зависимостей, а не «попутной уборкой» внутри аудит-стори. Связано с [[project_test_full_concurrency_teardown]] (4.2 намеренно вернёт 2 teardown-ERROR) и [[project_bmad_story_cycle_flow]].
