---
name: feedback_vaps_label_substring_vacuous_assert
description: "Метки светофора — подстроки друг друга ('сдано' ⊂ 'сдано, расход разошёлся'), поэтому toContainText вакуумен; ассертить exact"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6a56d3fd-b598-4d5e-995b-bcee8cdbedb0
  modified: 2026-07-19T20:59:53.289Z
---

`STATUS_LABEL` светофора (`frontend/src/features/traffic-light/trafficLight.ts`):
GREEN=`сдано`, YELLOW=`сдано, расход разошёлся`, RED=`не сдано`. Три метки —
подстроки друг друга, поэтому `toContainText('сдано')` зелен на ВСЕХ трёх
состояниях, кроме RED.

**Why:** красная проба 10.10 №2 («сдача до массового обновления») осталась
зелёной именно так: перестановка шагов честно красит узел в YELLOW, тест этого
не видел, и стори «зелёный светофор» не проверяла того, что заявляла заголовком.
Тот же класс, что находка 10.9 (`/^Версия /` матчила два узла).

**How to apply:** метки-состояния ассертить ТОЛЬКО точным совпадением —
`getByText(label, { exact: true })`, плюс дубль-страховка
`not.toContainText('<отличающий кусок>')`. Перед тем как писать `toContainText`
на статусной метке, проверить весь словарь меток на вложенность. Смотри
[[feedback_redundant_guards_vacuous_probe]], [[project_vaps_frontend_e2e_blindspots]].
