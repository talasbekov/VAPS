---
name: feedback-vaps-reuse-conflict-override-protocol
description: Перед своим кодом 409 проверь OVERRIDABLE_CODES + shared/ui/ConflictDialog — у VAPS уже есть сквозной протокол обхода мягкого конфликта
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 73d2546c-745c-41aa-8831-4abd577099ef
---

Во фронте VAPS есть ГОТОВЫЙ сквозной протокол мягкого конфликта, и новый
raise-сайт обязан в него встроиться, а не заводить свой:
`docs/registries/error-codes.yaml` (`overridable: true`) → `OVERRIDABLE_CODES`
в `shared/api/errors.ts` → `useApiMutation.conflict` → общий
`shared/ui/ConflictDialog` (правило причины 10–500 символов живёт там) →
`confirmOverride(reason)` повторяет запрос.

Две ловушки, обе стоили бы багом:
1. `confirmOverride` дописывает `override`/`override_reason` в **корень**
   переменных мутации. Привычная для фичи обёртка `{ id, body }` ⇒ ключи
   уедут РЯДОМ с телом, сервер их не увидит, повтор молча получит тот же 409.
   Переменные такой мутации = само тело запроса.
2. Свой код ошибки вместо канонического (`DUTY_CONFLICT_SOFT` вместо
   `DUTY_CONFLICT_DETECTED`) не включает `ConflictDialog` вовсе — получится
   второй, параллельный протокол обхода при живом первом (ARCH-FE-015 прямо
   требует «диалог ОДИН, в shared/ui»).

**Why:** реестр кодов несёт донорские фантомы, и по
[[feedback-vaps-verify-against-raise-sites]] его нельзя брать как описание
СУЩЕСТВУЮЩЕГО поведения. Но когда raise-сайт пишешь ты сам, реестр —
правильный источник ИМЕНИ: он определяет, какой код включает платформенную
цепочку. Два правила не спорят, они про разные направления.

**How to apply:** прежде чем сочинять код 409 — грепни `OVERRIDABLE_CODES` и
подходящий код в `error-codes.yaml`; если нашёлся, бери его и проверь красной
пробой, что override реально доезжает В ТЕЛЕ (обёртка `{ body }` — та самая
проба). Инцидент: Smart Josparlau Этап 32, коммит `d0a4570`, см.
[[project-smart-josparlau-frontend-state]].
