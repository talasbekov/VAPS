---
name: project-ops-live-mode-default
description: Раздел ОМ живой по умолчанию (907f9c99); права тоже живые (7666db11) — на моке остался только WS-колокольчик
metadata: 
  node_type: memory
  type: project
  originSessionId: ca87ba8c-5dcd-464c-9aee-73899fd6b4da
---

С коммита `907f9c99` (11.08.2026) живость раздела `/security-ops/*` задана в
коде: `lib/ops-env.ts`, домен живой по умолчанию, на мок возвращает явный
`NEXT_PUBLIC_OPS_MOCK_DOMAINS`. До этого живость держал untracked `.env.local`
со списком `NEXT_PUBLIC_OPS_LIVE_DOMAINS` — на чистом клоне раздел уезжал в мок
и выглядел рабочим (фикстуры несут те же названия ОМ, что и сид БД; отличие —
третья строка `ОМ-2026-3`, которой в БД нет).

**11.08.2026 (`7666db11`): `identityHandlers` СНЯТ — прав мок больше не рисует.**
`my-permissions` идёт на живой бэк. Под мок-wildcard-ом (`["*"]` любому
посетителю) прятались три дефекта: коды фронта `ops.object.view`/`ops.duty.view`/
`ops.security_event.view` НЕ существуют в справочнике RBAC (там `object.view`,
`duty.view`, `event.view` — префикса `ops.` нет нигде); запрос прав не уходил без
host-логина, а `/security-ops/*` не в `matcher` middleware (выключенный запрос =
вечный isLoading → гейт не срабатывает → раздел открыт анониму); календарь звал
реестр ОМ без `event.view`. Проверено на трёх учётках, таблица в
docs/api-gaps.md §9-12. Роль `OPS_READER` (object.view+duty.view, БЕЗ event.view)
внесена в сид (`2fbe1ef9`) — единственное отступление от дословного порта
раскладки; неполнота намеренная: это единственная сеяная персона, на которой
видно, что гейты работают (закреплено тестом + красная проба). ОТКРЫТОЕ: кому
в проде полагается `event.view` — за владельцем продукта.

Что ОСТАЛОСЬ на моке осознанно:
- WebSocket. `isOpsMockMode()` НЕ трогали: он про транспорт, не про данные.
  Реальный сокет — `${location.host}/ws/notifications/`, то есть Next-хост
  (:3106), а он WS не проксирует (в `next.config.js` нет rewrite на `/ws`).
  Бэк channels умеет (`ASGI_APPLICATION`, `notifications/routing.py`), но висит
  на :8100. Захочешь живой колокольчик — сначала маршрут, потом флаг.

`onUnhandledRequest: "bypass"` в `mocks/ops/browser.ts` означает, что опечатка в
пути handler-а не падает, а тихо уходит в сеть. Поэтому «данные показались» ничего
не доказывает — сверять мутацией БД.

**Приём обхода (11.08.2026, 29 маршрутов).** Решающий признак живости домена —
запрос ДОШЁЛ до Django: перехваченный MSW в access-лог бэка не попадает. Гонять
страницы через iframe изнутри одной вкладки (`f.src=route`, ждать, читать
`contentDocument`) — весь раздел проходится тремя вызовами eval вместо
двух на страницу, контекст не теряется. Потом
`preview_logs --search 'django.server: "GET /api/ops/'` и сверить с картой
маршрутов. Итог обхода: живы все 12 доменов, ни одного перехвата; в логе не
появился только `my-permissions` (он и есть оставшийся мок), а
`/security-ops/changelog` не ходит в сеть вовсе — страница статическая по
устройству (`features/ops-changelog`, проп-шов `fixes`).

Учётки стенда: `admin/admin123` (ADMIN → `*`), `observer/observer123`
(OPS_READER → duty.view+object.view), `erda/erda123` (DIVISION_OPERATOR, ОМ-прав
нет; пароль сброшен 11.08 — прежний `string` не подходил).
Смена персоны без UI: POST `/api/auth/callback/credentials` с csrfToken из
`/api/auth/csrf` (`json:true, redirect:false`), потом iframe-обход.
Не пройден маршрут `objects/[id]/passports/[versionId]`.

Связано: [[project-ops-backend-plan]], [[project-stand-raise-gotchas]],
[[feedback-next-dev-shared-build-cache]].
