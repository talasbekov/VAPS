---
name: feedback-e2e-init-script-resets-persona
description: "Смена persona в середине Playwright-спеки: evaluate+reload молча возвращает исходные права, потому что seedCredential — addInitScript"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 91efc324-4f17-4e62-b3f5-b3fe5ce66187
---

`seedCredential(page)` в `frontend/e2e-mock/testUtils.ts` — это `addInitScript`, а не
одноразовый сид: он выполняется на КАЖДОЙ навигации, включая `page.reload()`. Поэтому
`page.evaluate(() => sessionStorage.setItem('vaps.credential', …))` + `reload` для смены
persona в середине спеки НЕ работает — исходный demo-admin возвращается молча.

**Why:** проверка «persona без права X ничего не видит» при этом ЗЕЛЕНЕЕТ по неверной
причине только если ассерт слабый; в худшем случае краснеет и выглядит как баг продукта.
Тот же класс, что [[feedback-vaultx-vacuous-optional-chain-assert]]: тест утверждает не
то, что проверяет.

**How to apply:** менять persona вторым `page.addInitScript(...)` перед `reload` —
поздний init-скрипт исполняется последним и перекрывает ранний. Найдено на Этапе 41
Smart Josparlau ([[project-smart-josparlau-frontend-state]]).
