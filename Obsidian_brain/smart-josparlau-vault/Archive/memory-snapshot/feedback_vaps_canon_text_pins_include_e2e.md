---
name: feedback_vaps_canon_text_pins_include_e2e
description: "Правишь канон-строку во фронте — грепай и frontend/e2e/: Playwright вне npm run gate, поэтому сломанный e2e-ассерт остаётся зелёным гейтом"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5f318049-d003-4509-b67c-1d72d133fa69
  modified: 2026-07-19T15:42:14.453Z
---

Найдено QA-прогоном 10.6 (2026-07-19). Стори 10.6 переписала текст 409
(`daySubmission.ts`) и синхронно обновила **три** ассерта, которые сама
перечислила в задаче. Ассертов было **четыре**: `frontend/e2e/day-submission.spec.ts`
пинил старую строку дословно. `npm run gate` был зелёным, стори ушла в review —
и обнаружилось только ручным `npm run test:e2e` (43 passed + 1 failed).

**Why:** `npm run gate` НЕ запускает Playwright (осознанно, Д4 стори 8.8:
бюджет <5 мин + офлайн-контур без браузеров). Значит e2e-спеки — поверхность,
которая не краснеет ни в одном автоматическом проходе дев-цикла. Любой пин
дословного текста там переживает переименование молча.

**How to apply:** при правке канон-строки (или `data-testid`, или роли/имени
кнопки) грепать по ВСЕМУ фронту, включая `frontend/e2e/` и `frontend/e2e-live/`,
а не только по `src/**/*.test.*`. Перед сдачей стори, тронувшей UI-копию,
гонять `npm run test:e2e` один раз руками. Спека, перечисляющая «текст запинен
N ассертами», обязана включать e2e в этот счёт.

⚠️ Порты 4173/4174 после прерванного прогона остаются занятыми — следующий
запуск падает «is already used»; лечится `pkill -f "vite preview"`.

См. [[project_vaps_gate_location]], [[project_vaps_frontend_e2e_blindspots]],
[[project_action_item_trigger_gate]].
