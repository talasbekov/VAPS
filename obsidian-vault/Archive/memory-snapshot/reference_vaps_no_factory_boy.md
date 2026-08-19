---
name: reference_vaps_no_factory_boy
description: В VAPS нет factory_boy — тесты сеют данные напрямую; architecture.md исправлен на ретро E3, но донорские/старые спеки могут ещё обещать фабрики
metadata: 
  node_type: memory
  type: reference
  originSessionId: c141dc7d-262c-467a-af79-79cbbea38273
---

VAPS tests seed data **directly** (hand-rolled `make_employee`/`make_division`/`make_status` helpers + `bulk_create`), NOT via `factory_boy`. `factory_boy` is **not** in `Backend/VAPS/pyproject.toml` dev-deps (only pytest/pytest-django/hypothesis); there is no `tests/factories.py` and zero `DjangoModelFactory` subclasses. Test files state it explicitly ("no factory_boy").

**Doc-drift — исправлено 2026-07-10 (ретро E3):** `architecture.md` (Structure Patterns + ARCH-DEFERRED-043) больше НЕ обещает factory_boy — обе строки переписаны на «прямой посев в тестах; factory_boy не вводить». Строчные номера (:437/:439) сдвигаются — ищи по тексту, не по номеру. Если увидишь обещание фабрик в другом артефакте (донорская спека VAPS_7.8.2, старые стори) — это остаточный дрейф, не новая правда.

**How to apply:** когда стори требует синтезировать/посеять тестовые данные (volume benchmarks, golden-master 6.8, импортёры E7), НЕ тянуть factory_boy и не предполагать, что он есть — использовать прямой `bulk_create`. Добавление factory_boy = scope creep (триггер снятия — только нагрузочные тесты, ARCH-DEFERRED-043).

Surfaced writing [[project_bmad_story_cycle_flow]] story 6.6 (fresh-context validation caught a spec that told the dev to reuse non-existent factories). Relates to [[project_vaps_architecture]].
