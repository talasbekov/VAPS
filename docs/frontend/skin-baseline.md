# База «до» — e2e и скриншоты перед слоем прототипа

Дата снятия: 2026-08-19
Ветка: `feat/prototype-skin`
SHA на момент прогона: `a383bdd842264b09ec5c4adf2fab567a4d445415`
(Note: бриф Task 0 ссылался на SHA `766638ca` — это HEAD~2, коммит спеки
«слоя прототипа» ДО того, как поверх лёг план из 16 задач (`a383bdd8`).
Фактический HEAD worktree на момент прогона — `a383bdd8`, тот же, что и в
`.superpowers/sdd/2026-08-19-prototype-skin-plan/progress.md`.)

Стенд: Django `:8100` (pid 198232, `manage.py runserver` с
`DJANGO_SETTINGS_MODULE=organization_management.config.settings.local_postgres`,
cwd `Backend/PersonnelStatus/Personnel-Records`) + `next dev -p 3106` (pid
198344/198376/198387, cwd `Backend/PersonnelStatus/PersonalRecordFront`).
Оба процесса подтверждены как принадлежащие ЭТОМУ чекауту через
`/proc/<pid>/cwd`. Учётка `admin/admin123`.

## Итог прогона

Команда:
```
cd Backend/PersonnelStatus/PersonalRecordFront
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts --reporter=list
```

**58 passed / 1 failed / 138 did not run** (из 197 тестов в 23 файлах, один воркер).

Итоговая строка репортера:
```
1 failed
  [chromium] › e2e/smoke-buttons.spec.ts:850:7 › смоук-обход портала › карта маршрутов покрыта обходом
138 did not run
58 passed (2.4m)
```

### Красная спека

`e2e/smoke-buttons.spec.ts:850:7` — «смоук-обход портала › карта маршрутов покрыта обходом»

```
Error: страницы app/ вне обхода
- Expected  - 1
+ Received  + 3
- Array []
+ Array [
+   "/security-ops/forces",
+ ]
```

Причина установлена: страница `app/security-ops/forces/page.tsx` («Сбор сил
на ОМ», введена коммитом `dda60d72 feat(ops): «Сбор сил на ОМ» — новый экран
актуального прототипа`) существует в `app/`, но не добавлена в карту
маршрутов `ROUTES` внутри `e2e/smoke-buttons.spec.ts`. Расхождение
существовало до Task 0 и никак не связано с этой задачей.

### Каскад «did not run»

Файл `smoke-buttons.spec.ts` объявляет
`test.describe.configure({ mode: 'serial' })` на весь `describe('смоук-обход
портала', …)`. Первый тест в этом блоке — упавшая «карта маршрутов покрыта
обходом» — блокирует все последующие тесты того же файла в serial-режиме:
обход по трём персонам (`admin`, `observer`, `erda`) × ~46 маршрутов + проверки
каркаса (aside/header) + выход из системы. Итого 138 тестов не выполнились
не из-за собственных проблем, а каскадно из-за первого падения в этом же
файле. Остальные 22 спек-файла (197 − 139 из smoke-buttons.spec.ts = 58
тестов) выполнились полностью и все прошли.

### Построчный список красных/не выполнившихся тестов

**FAILED (1):**
- `e2e/smoke-buttons.spec.ts:850:7` — смоук-обход портала › карта маршрутов покрыта обходом

**DID NOT RUN (138), каскадно из-за падения выше, все внутри `smoke-buttons.spec.ts`:**
- persona `admin` × 46 маршрутов (`/`, `/dashboard`, `/employees`, `/organization`,
  `/statuses`, `/reports`, `/settings`, `/feedback`, `/feedback/{feedbackId}`,
  `/security-ops/profile`, `/security-ops/command-center`, `/security-ops/events`,
  `/security-ops/events/{eventId}`, `/security-ops/gvo`, `/security-ops/gvo/{eventId}`,
  `/security-ops/persons`, `/security-ops/laws`, `/security-ops/objects`,
  `/security-ops/objects/{objectId}`,
  `/security-ops/objects/{objectId}/passports/{passportVersionId}`,
  `/security-ops/duties/combat`, `/security-ops/daily-expense`,
  `/security-ops/calendar`, `/security-ops/analytics`,
  `/security-ops/analytics/operations`, `/security-ops/ratings`,
  `/security-ops/ratings/workspace`, `/security-ops/ratings/evaluations`,
  `/security-ops/ratings/employees/{ratingEmployeeId}`, `/security-ops/ratings/audit`,
  `/security-ops/ratings/export`, `/security-ops/ratings/analytics`,
  `/security-ops/service-reports`, `/security-ops/service-reports/history`,
  `/security-ops/service-reports/{reportJobId}`, `/security-ops/audit`,
  `/security-ops/dictionaries`, `/security-ops/dictionaries/{dictionaryCode}`,
  `/security-ops/settings`, `/security-ops/changelog`, `/security-ops/feedback`,
  `/security-ops/feedback/{feedbackId}`, `/ops/objects`) + каркас (aside, header)
  + выход из системы
- persona `observer` × те же 46 маршрутов + каркас (aside, header) + выход из системы
- persona `erda` × те же 46 маршрутов + каркас (aside, header) + выход из системы

(Точные номера строк — см. `docs/frontend/skin-baseline-run.log`, сохранён
рядом как сырой лог прогона.)

### Passed (58)

Все тесты в файлах: `acknowledgement-stage.spec.ts` (1), `approval-stage.spec.ts` (1),
`bulletin-stage.spec.ts` (3), `closure-stage.spec.ts` (2), `command-center.spec.ts` (2),
`events-registry.spec.ts` (1), `forces-screen.spec.ts` (3), `forms-validation.spec.ts` (4),
`gvo-sections.spec.ts` (2), `legal-documents.spec.ts` (2), `my-profile.spec.ts` (3),
`object-passport.spec.ts` (5), `objects-tabs.spec.ts` (2), `operations-analytics.spec.ts` (4),
`org-structure-status.spec.ts` (3), `org-structure-view.spec.ts` (4), `placement-stage.spec.ts` (1),
`protected-persons.spec.ts` (2), `recon-stage.spec.ts` (1), `service-analytics.spec.ts` (4),
`stage-chain.spec.ts` (1), `tables-data.spec.ts` (7) — все зелёные, без исключений.

## Как этим пользоваться в задачах 2, 3, 5–8, 10–13, 15

«Без новых падений» = после правки должно быть по-прежнему ровно
**1 failed** (`smoke-buttons.spec.ts:850`, «карта маршрутов покрыта обходом»)
и ровно **138 did not run** того же каскада, если только отдельная задача из
плана прямо не чинит карту `ROUTES` (в текущем плане такой задачи нет — это
не в скоупе «слоя прототипа», задача про CSS/токены/вёрстку, а не про
рассинхрон карты обхода с `app/`). Любое ДРУГОЕ падение — новое, требует
разбора. Любое падение из passed-58 списка, ставшее красным, — тоже новое.

## Базовые скриншоты

Каталог: `docs/frontend/skin-baseline-shots/`
72 файла = 12 маршрутов × 2 темы (`light`/`dark`) × 3 ширины (`1440`/`1024`/`375`).

Маршруты (по списку Task 15 Step 2):
`/dashboard/`, `/employees/`, `/organization/`, `/statuses/`, `/reports/`,
`/security-ops/command-center/`, `/security-ops/events/`, `/security-ops/objects/`,
`/security-ops/daily-expense/`, `/security-ops/persons/`, `/security-ops/analytics/`,
`/security-ops/ratings/`.

Имя файла: `<маршрут>__<тема>__<ширина>.png`, например
`security-ops_command-center__dark__1440.png`.

Снято скриптом на Node + Playwright (логин через NextAuth credentials-flow:
`GET /api/auth/csrf/` → `POST /api/auth/callback/credentials/?json=true` с
формой `{csrfToken, username, password, json:'true', redirect:'false'}`,
хвостовые слэши — `trailingSlash: true` в проекте). Тема ставится классом
`dark` на `<html>` через `page.addInitScript` до навигации. Все 72 навигации
вернули HTTP 200, ошибок скрипта — 0.

## Про gitignore

Проверено заранее: `docs/*` глушит `docs/`, но негейт `!docs/frontend/`
(строка 235–240 `.gitignore`) снимает игнор для этого каталога и его
содержимого. `git check-ignore` подтвердил — файлы скриншотов НЕ
игнорируются, `git status` их видит, `git add` (без `-f`) сработал штатно.
`git add -f` не понадобился.

## Технические артефакты (не коммитятся отдельно, для справки)

- `docs/frontend/skin-baseline-run.log` — полный сырой лог прогона Playwright
- `docs/frontend/skin-baseline-shots.log` — JSON-отчёт скрипта скриншотов (все `ok: true`, `status: 200`)

---

# Дополнение Task 0b: карта обхода починена, обход частично прогнан

Дата: 2026-08-19, вечер. SHA правки: см. коммит ниже.

## Что сделано

В константу `ROUTES` файла `e2e/smoke-buttons.spec.ts` внесена недостающая
запись:

```ts
  // «Сбор сил на ОМ» — разрез по ВСЕМ мероприятиям на сборе разом (не по
  // одному id), поэтому маршрут статический, как и command-center.
  { template: '/security-ops/forces' },
```

## Результат

Самопроверка **«карта маршрутов покрыта обходом» прошла за 3 мс** — значит
дыра была ЕДИНСТВЕННОЙ, других страниц `app/` вне обхода нет. Каскад из 138
`did not run` разблокирован.

Обход пошёл дальше и дал **14 зелёных подряд, ни одного падения**, включая
ранее недостижимый маршрут: `admin /security-ops/forces (4.0s) ✓`.

## Почему полный прогон ОСТАНОВЛЕН, а не доведён до конца

Замер скорости: старт `19:44:29`, на `19:56:30` пройдено 13 тестов — **~55 с
на тест**. В файле 139 тестов, то есть полный обход занимает **около двух
часов**, и всё это время нельзя тронуть ни один файл приложения: `next dev`
подхватывает правку и портит замер, а поднять второй `next dev` нельзя —
общий `.next` травит стенд.

Решение принято контролёром: два часа заблокированного стенда не окупаются.
Сплошной снимок 139 тестов нужен только на случай, если что-то потом упадёт, —
а в этом случае **точнее и быстрее сделать A/B по ОДНОМУ маршруту** против
базового коммита (~1 мин), чем держать заранее снятый снимок всех.

Частичный лог сохранён:
`.superpowers/sdd/2026-08-19-prototype-skin-plan/smoke-partial-baseline.log`

## Чем пользоваться как базой

| набор | статус | как использовать |
|---|---|---|
| 22 предметные спеки (58 тестов) | **58/58 зелёные** | полноценная база; после каждой задачи сверять «без новых падений» |
| `smoke-buttons.spec.ts` (139 тестов) | 14/14 зелёные, остальные не гонялись | база НЕПОЛНАЯ. Прогнать целиком в Task 15. Любое падение там разбирать A/B: `git stash` → тот же тест на базовом коммите → сравнить |

**Не считать молчание обхода доказательством.** Если в Task 15 всплывёт
падение, оно может быть как регрессом слоя прототипа, так и pre-existing
дефектом, никогда прежде не проверявшимся: до этой починки обход не
доходил ни до одного маршрута вообще.
