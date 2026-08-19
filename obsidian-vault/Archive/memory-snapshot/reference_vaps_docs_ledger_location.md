---
name: reference-vaps-docs-ledger-location
description: «обнови docs-ledger и graphify» = docs/api-gaps.md § дефектов (+ registries/*.yaml при новых событиях/кодах) и graphify update . — где что лежит и что НЕ является леджером
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2ea2c5e9-60e0-4c3f-8917-ede558ab9736
---

Ритуал сохранения состояния (см. [[feedback-save-state-after-each-task]]) бьётся
на три конкретных файла — искать их каждый раз заново не надо:

- **Журнал дефектов** — `docs/api-gaps.md`, раздел «Найденные и починенные
  дефекты (для контекста)» в конце. Туда идут закрытые баги стенда/фронта
  нумерованным списком; НЕ-дефекты (валидация, библиотечный шум) выносить явно
  рядом, иначе их чинят повторно.
- **Реестры** — `docs/registries/audit-events.yaml` и `error-codes.yaml`:
  правятся только когда срез завёл НОВОЕ событие аудита или код ошибки
  (образец — `861958bf`). Читать их как справочник нельзя, см.
  [[feedback-vaps-verify-against-raise-sites]].
- **Граф** — `graphify update .` из корня, отдельным `chore(graphify)`-коммитом
  ([[project-bmad-story-cycle-flow]]). Строка «Skipped graph.html: 25085 nodes —
  too large (limit 5000)» — ШТАТНО, граф репо давно за лимитом виза, это не сбой.

Что леджером НЕ является: `docs/ops-backend-plan.md` § 6 «Сделано в этом заходе»
застыл на срезе A1 и с тех пор не ведётся — фактическое состояние срезов живёт в
[[project-ops-backend-plan]], не в документе. Шапка `api-gaps.md` («ни один путь
/api/ops/ не существует», ветка `claude/smart-josparlau-e55`) тоже устарела —
раздел ОМ закрыт целиком; правится только хвост с дефектами.

`docs/` ЗДЕСЬ отслеживается гитом (в отличие от того, что описано в
[[project-docs-local-only-remote-blindspot]] — там про другие пути), коммит
идёт обычным `git add docs/...`.
