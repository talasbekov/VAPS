---
name: update-persistence-assert-from-db
description: Успешный update ассертить refresh_from_db-значениями; поведенческая проба tie-breaker ordering вакуумна — пинить _meta.ordering литерально
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cf58fa1a-a57d-4f22-9177-f69cd72f9ea2
---

Два новых класса вакуумных ассертов из ревью 14.4 (VAPS):

1. **Персистентность update.** Тесты смотрели в AuditLog и in-memory
   возвращённый объект — мутация «выбросить реальные поля из
   update_fields» проходила всю сюиту (setattr сделан, save не записал).
2. **Tie-breaker ordering.** Поведенческая проба `list(...) == sorted(...)`
   не различает `["code"]` и `["code","id"]`: heap-порядок ties в Postgres
   совпадает с порядком вставки (= pk). Доказано пробой двумя финдерами
   независимо.

**Why:** родня [[vaultx-vacuous-optional-chain-assert]] и
[[lock-asserts-by-table]] — ассерт удовлетворяется побочным состоянием, а
не проверяемым контрактом.

**How to apply:** после успешного update — `refresh_from_db()` + ассерты
значений полей И `updated_at > snapshot`; состав ordering пинить литерально
`Model._meta.ordering == [...]` (аналог of=-пина). Красная проба мутацией
обязательна для обоих.

**Продолжение (ревью 10.1d, 2026-08-01): пин Meta не покрывает дубль в
селекторе.** У `StatusTypeSelector.catalog()` порядок задан ДВАЖДЫ — Meta
модели и явный `order_by("priority","code")` в селекторе. `_meta.ordering`
пинился, а tie-break в селекторе — нет, и на живом сиде (все 17 priority
уникальны) мутация `-code` оставляла всю сюиту зелёной. Правило: если
инвариант имеет ДВУХ владельцев, пин одного не защищает второго; tie-break
проверяется только фикстурой с РАВНЫМИ ключами первого уровня. Родня
[[order-assert-needs-three-items]] и [[redundant-guards-vacuous-probe]].
