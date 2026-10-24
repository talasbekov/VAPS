---
name: lock-asserts-by-table
description: "any(\"FOR UPDATE\" in sql) вакуумен — лок-ассерты фильтровать по имени таблицы, состав of= пинить буквально"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 51a84c74-ebf7-442d-bedc-d645b1565e9e
---

Ассерт `any("FOR UPDATE" in q["sql"])` по CaptureQueriesContext удовлетворяется ЛЮБЫМ локом транзакции (например, лок facility из селектора) — лок второй таблицы (шаблон, зачищаемые строки) остаётся незапиненным. Ревью 14.3a: 3 High этого класса.

**Why:** тот же механизм, что у вакуумных фокус-ассертов — проба зелёная при удалении проверяемого кода.

**How to apply:** фильтровать captured SQL по `'"имя_таблицы"'` на КАЖДЫЙ ожидаемый лок; состав `of=` пинить буквально (вырезать клаузу после `FOR UPDATE OF` и ассертить присутствие/отсутствие таблиц — исключение catalog-таблиц тоже контракт). Эталон: `test_binding_selector_lock_scope`, `_for_update_sqls` в test_checklist_services.py. См. [[qa-gap-heuristic-vaps]].
