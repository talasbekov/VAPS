---
name: project-smoke-sweep-old-stack
description: Смоук-обход старого стека 12.08.2026 — инструмент, где отчёт, и главная находка (гвард прав есть на 6 страницах из 22)
metadata:
  node_type: memory
  type: project
---

12.08.2026, коммит `19b4db80`: обход портала СТАРОГО стека портирован со снятой
SPA. Инструмент —
`Backend/PersonnelStatus/PersonalRecordFront/e2e/smoke-buttons.spec.ts` +
`playwright.smoke.config.ts` + `scripts/smoke-report.mjs`.

Запуск (стенд поднимается СНАРУЖИ: Django :8100 local_postgres, Next :3106):
`SMOKE_LIVE=1 npx playwright test --config playwright.smoke.config.ts`
затем `node scripts/smoke-report.mjs > ../../../docs/smoke-old-stack.md`.
Ручки: `SMOKE_PERSONAS=erda`, `SMOKE_SETTLE`, `SMOKE_MAX_ELEMENTS`.
130 тестов ≈ 36 минут одним воркером. Отчёт — `docs/smoke-old-stack.md`
(untracked, как весь docs/).

**Итог прогона:** 0 × 5xx, 0 × pageerror, 0 отбитых на вход. Под `admin`
единственные 4xx — 400/422 на POST/PATCH из ПУСТЫХ форм (серверная валидация,
не дефект): dictionaries entries, objects passport, combat-duty-shifts ×2.

**Главная находка — гвард прав отстаёт от бэка.** Страниц, отдавших 403 при
загрузке: 22 у `erda` и 22 у `observer`; экран «Недостаточно прав» показали
ТОЛЬКО 6 и 2 соответственно (гварды живут в events/objects/duties/
command-center/calendar). Остальные 17-20 — `/security-ops/ratings/*`,
`analytics/*`, `audit`, `dictionaries`, `service-reports/*`, `settings`,
`duties/combat`, `feedback`, плюс хостовые `/settings`, `/employees`,
`/statuses` — рендерят пустой/битый экран вместо отказа. Список в отчёте,
§ «Гвард закрыл» против § 4xx.

**Закрывается срезами.** `main` (`2a2066b8`) — гвард на 16 страницах раздела
ОМ. `/employees` и `/statuses` — коммит `5f15b9f9` 13.08.2026 (ветка
`claude/frosty-lamport-ed0c21`): у них отказ НЕ по коду права, а ролевая
проверка ROLE_3/6/7 на одной ручке `staff-units/directorate/`, разводится по
`ApiHttpError.status` (не по тексту сообщения); подробности —
`docs/api-gaps.md` § 15. Осталось: `/settings` и хвост `/security-ops/*`
(ratings, analytics, audit, dictionaries, service-reports, duties/combat,
feedback).

**Прогон под свою правку — не по общему стенду.** `:3106` держит dev-сервер из
ЧУЖОГО worktree (`wizardly-chaplygin-f750e9`, ветка main) — правок текущей
ветки он не видит, и смоук по нему зеленел бы мимо кода. Свой поднимать
отдельным портом: симлинк `node_modules` и копия `.env.local` из того
worktree, `NEXTAUTH_URL=http://localhost:3107 next dev -p 3107`, смоук с
`SMOKE_BASE_URL`. Все три персоны ОДНОЙ командой падают по памяти (exit 137,
заодно убивает свой dev-сервер) — гнать персону за персоной.

Известное и НЕ новое: `statuses/absence_statistics` → 400/ERR_ABORTED у
non-admin — та самая дыра данных «user не привязан к employee»
(см. [[project-stand-raise-gotchas]]).

**Слепота метода, из-за которой «⚪ без реакции» ≠ дефект** (напечатана в самом
отчёте, § «Как читать»): сигнатура экрана = pathname+search, длина innerText,
число узлов DOM, число модалок. Свернуть сайдбар, сменить тему, подсветить
активную вкладку — всё это законная работа, попадающая в «без реакции».
Кандидаты на РЕАЛЬНЫЙ разбор из 74 строк: `/organization` «Развернуть/Свернуть
все», `/security-ops/analytics` «Показать строки» ×5, дни в календаре модалки
`/reports`, строки-карточки `/feedback` и `/security-ops/command-center`.

Ловушки порта (детали в теле коммита): `__dirname` вместо `import.meta.url`
(package.json без `"type":"module"` → CJS → «exports is not defined» до
старта); нормализация `trailingSlash: true`; трафик ловить по ДВУМ адресам
(same-origin `/api/*` через rewrites И прямой `:8100/api/*` — клиентский
BACKEND_URL в dev полный, `.env.local` в браузер не инлайнится).

Связано: [[project-new-stack-removed]], [[project-ops-live-mode-default]],
[[feedback-playwright-tail-hides-failures]].
