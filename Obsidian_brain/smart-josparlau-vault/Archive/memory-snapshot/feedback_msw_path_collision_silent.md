---
name: feedback-msw-path-collision-silent
description: "Новый pending-contract путь надо грепать по src — занятый путь MSW разрешает молча в пользу первого handler'а, без ошибки и предупреждения"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fe88cbbb-78e3-4909-9dea-e3a6e19d2934
---

Перед тем как завести новый путь pending-contract в VAPS-фронте, грепнуть строку пути по
всему `frontend/src`. Занятый путь MSW **не** считает ошибкой: он отдаёт ПЕРВЫЙ
зарегистрированный совпавший handler, а порядок задаёт `app/mocks/compose-handlers.ts`.

**Why:** инцидент Этапа 39 — `features/personnel` завёл `/api/ops/personnel/`, который с
Этапа 2 занят узким ростером кандидатов на посты в `features/security-events`. Ни tsc, ни
eslint, ни unit-тесты (там свои `server.use`) этого не видят: экран личного состава просто
получал чужой ответ из другого ID-пространства и рисовал пустой список. Поймано только
живым e2e, и то не сразу — симптом выглядел как «фильтр ничего не находит».

**How to apply:** `grep -rn "'/api/ops/<новый-путь>'" frontend/src` до написания handler'а.
Если путь занят другой фичей — брать своё имя (в инциденте стало
`/api/ops/personnel-directory/`) и оставить в `pending-contracts.ts` комментарий, ПОЧЕМУ
имя не очевидное: следующий разработчик иначе «исправит» его обратно. Соседний класс —
[[feedback-vaps-label-substring-vacuous-assert]] (одинаковые подписи) и
[[project-vaps-frontend-e2e-blindspots]].
