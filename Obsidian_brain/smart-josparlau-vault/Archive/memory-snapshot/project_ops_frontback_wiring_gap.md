---
name: project-ops-frontback-wiring-gap
description: Почему /ops «фронт-бэк работает некорректно» — связка с живым бэком не сделана ни на одном слое
metadata: 
  node_type: memory
  type: project
  originSessionId: 3aac1636-d916-401c-b1b4-1854aeb3784d
---

## РАЗРЕШЕНО 10.08.2026 (1edd09cc): проводка SPA НЕ НУЖНА

Дубль устранён с другой стороны: SPA-группа /ops/* выведена из сайдбара,
`app/ops/[[...slug]]` = карта редиректов на нативные `/security-ops/*`
(живой `/api/ops/*`, срезы A2-J) и живые хостовые экраны. Mock-pin
mount.tsx, host-прокси и identity SPA чинить больше не к чему — раздел
живёт на нативных страницах. Всё ниже — историческая диагностика на случай,
если SPA решат воскресить.

---

Жалоба «фронт и бэк работают некорректно» на разделе `/ops` — это НЕ баг запроса,
а отсутствующая проводка к живому бэку в три слоя (ревью 2026-08-08, ветка e55 —
стенд; main на 189 коммитов позади и срезов не содержит вовсе):

1. **mock захардкожен.** `PersonalRecordFront/josparlau/mount.tsx` безусловно
   ставит `globalThis.__JOSPARLAU_ENV__ = { MODE:'mock', VITE_DATA_SOURCE:'mock' }`
   и поднимает свой MSW+IndexedDB. Флаг `NEXT_PUBLIC_OPS_DATA_SOURCE=api`
   переключает ТОЛЬКО нативные `/security-ops/*`, встроенную SPA не трогает →
   всё сохраняется в браузер, не в БД.
2. **host-прокси не знает путей SPA.** `next.config.js` rewrites — белый список
   донора; `/api/core|operations|audit|documents/*` не проксируются (Next вернёт
   HTML вместо JSON), `/ws/` не проксируется в принципе (rewrites не умеют WS,
   в nginx.conf нет location).
3. **`/api/ops/*` (~41 путь) не существует НИГДЕ** — ни в старом бэке, ни в
   Backend/VAPS/schema.yaml. Это осознанный mock-first (`*/pending-contracts.ts`,
   `docs/api-gaps.md` на e55).

Плюс контрактные мины, если рубильник повернуть: расход зовёт
`/api/operations/expense-reports/*`, а в старом бэке это `strength-report/*`
(другое имя, 404); скачивание — `/api/documents/attachments/` vs
`/api/operations/attachments/`; уведомления/аудит на путях SPA отдают ДОНОРСКИЕ
вьюхи (форма без `results`) — портированные лежат под `/api/operations/*`; WS SPA
целит `/ws/notifications/`, портированный — `/ws/operations/notifications/`.
Вход: SPA шлёт `X-User-Id`/Bearer, старый бэк принимает только SimpleJWT → 403
на всём (у Backend/VAPS есть XUserIdAuthentication-fallback, у старого нет).

**Вывод для будущих сессий:** прежде чем «чинить» экран /ops, помни — связки нет
by design, это работа проводки (снять mock-pin + маппинг путей в прокси +
согласовать имена ручек + единая identity). См.
[[project-two-backends-spa-targets-new]], [[project-core-port-slices-progress]].
