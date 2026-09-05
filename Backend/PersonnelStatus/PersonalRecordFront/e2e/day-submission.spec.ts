/**
 * «Сдать день» (`/employees?view=daily`) — панель сдачи, восстановленная из
 * `4d83f361^` (`features/ops-daily/day-submission-panel.tsx`) и посаженная В
 * КАЖДУЮ группу управления «Ежедневного расхода» (решение координатора
 * 21.08, журнал 21→22.08): сдача версионируется ПО УПРАВЛЕНИЮ
 * (`DaySubmission.division_id`) — одна кнопка на весь департамент технически
 * невозможна без бэк-этапа (ручка принимает ровно один `division_id`).
 *
 * Борд сверху несёт СВОДКУ «Сдано N из M управлений на <дата>» + кто не
 * сдал — числа из ЖИВЫХ ответов, без своего счёта. Само действие — кнопка/
 * бейдж в шапке КАЖДОГО управления, доступная кнопка ищется ВНУТРИ группы
 * конкретного управления (`role="group"` по имени из расхода).
 *
 * Третья находка ревью (21.08, после второй фикс-секции): панель сдачи
 * заводит СВОЙ внутренний запрос истории версий на каждое монтирование
 * (`historyQuery`, БЕЗ гейта на `open`) — держать её смонтированной у КАЖДОЙ
 * группы сразу означало бы N безусловных запросов при каждой загрузке
 * экрана, что прямо противоречит правилу ленивости, которое сам файл
 * объявляет в шапке («шесть управлений … иначе означали бы шесть запросов…»).
 * Починено: панель монтируется ТОЛЬКО при раскрытии строки; в свёрнутом виде
 * шапка несёт лёгкий БЕЗ-интерактивный бейдж («День не сдан» / «Сдан · vN»),
 * собранный из ОДНОГО списочного запроса борда (`business_date`-фильтр, без
 * `division_id`) — того же, что кормит сводку сверху. Спека проверяет ОБА
 * состояния бейджа (до и после сдачи) и то, что сводка/бейдж синхронно
 * реагируют на сдачу БЕЗ дополнительного действия пользователя.
 *
 * Проба НЕ мутирует стенд: POST сдачи перехвачен `page.route` и отвечает
 * подменённым, но валидным по форме конвертом (`DaySubmission`, 9 полей) —
 * реальной строки в БД не появляется. После успешного POST перехвачен ТОЛЬКО
 * повторный списочный GET борда (`business_date`-фильтр, без `division_id`)
 * — он и есть тот запрос, который борд перечитывает по сигналу инвалидации
 * панели; отвечает списком с добавленной (фейковой) записью, имитируя то,
 * что легло бы в БД. Любой другой GET (история версий конкретного
 * управления, другие управления) идёт НАЖИВУЮ.
 *
 * 🔴 Service worker MSW блокируется: без этого `page.route` не перехватывает
 * запросы приложения.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface StrengthReport {
  business_date: string
  rows: { division_id: number; name: string; list_total: number }[]
}

interface DaySubmissionRow {
  division_id: string
  business_date: string
  is_current: boolean
}

interface DaySubmissionBody {
  division_id: string
  business_date: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return (await res.json()) as T
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

// 🔴 Название управления — не литерал теста: голые скобки («Управление
// (стенд)») читались бы `new RegExp` как группа захвата. Имя экранируем —
// тот же приём, что уже в `daily-expense.spec.ts`.
/**
 * Подпись группы подразделения на борде: «имя · путь» (Plane №250).
 *
 * 🔴 ИМЕНИ НЕ ХВАТАЕТ. Имена уникальны только внутри родителя, и с 27.08.2026
 * на стенде три департамента — «Второе сквозное управление» есть в каждом.
 * Отбор группы по имени находил ТРИ элемента и падал строгим режимом. Борд
 * (Plane №235) печатает путь и кладёт «имя · путь» в `aria-label`; проба
 * адресует строку так же, как её читает человек.
 */

/**
 * Проверка блока «Не сдали»: счётчик и ПОИМЁННЫЙ состав (Plane №328).
 *
 * Блок сворачивается в департаменты со счётчиками, когда отстающих больше
 * восьми, — поимённый вид тогда за кнопкой. Проба разворачивает его, если
 * кнопка есть: она стережёт СОСТАВ, а не то, какой вид показан по умолчанию.
 */
async function expectLaggards(
  summary: Locator,
  expected: string[],
): Promise<void> {
  const laggards = summary.getByRole('group', { name: 'Не сдали' })
  if (expected.length === 0) {
    await expect(laggards).toHaveCount(0)
    return
  }
  await expect(laggards.locator('p').first()).toHaveText(`Не сдали: ${expected.length}`)
  const expand = laggards.getByRole('button', { name: /Показать все/ })
  if ((await expand.count()) > 0) await expand.click()
  // Строки — вложенные `li` групп; заголовки департаментов ими не являются.
  const items = await laggards.locator('ul ul li').allInnerTexts()
  expect(new Set(items.map((text) => text.replace(/\s+/g, ' ').trim()))).toEqual(
    new Set(expected),
  )
}

/**
 * Подпись СТРОКИ списка «Не сдали» — `имя · остаток пути` (Plane №328).
 *
 * 🔴 ПИН ПРАВЛЕН ОСОЗНАННО. До №328 блок был абзацем-перечислением через
 * запятую, и подпись здесь строилась как `имя (весь путь)`: скобки отделяли
 * путь, потому что «·» читался бы как ещё один элемент перечисления. Абзаца
 * больше нет — есть список, сгруппированный по департаментам, и департамент
 * стоит ЗАГОЛОВКОМ группы, а не повторяется в каждой строке. Поэтому в строке
 * остаётся путь НИЖЕ департамента (`ancestors.slice(1)`), а разделителем
 * снова служит «·»: внутри отдельной строки он ни с чем не спорит.
 */
async function divisionRowLabels(token: string): Promise<Map<string, string>> {
  const rows = await get<{ results: { id: string; name: string; ancestors?: string[] }[] }>(
    token, '/api/ops/daily/divisions/')
  const labels = new Map<string, string>()
  for (const row of rows.results) {
    const rest = (row.ancestors ?? []).slice(1)
    labels.set(String(row.id), rest.length > 0 ? `${row.name} · ${rest.join(' › ')}` : row.name)
  }
  return labels
}

/**
 * ОЧЕРЕДЬ управлений — порядок строк того же списка подразделений (обход
 * дерева, Plane №296). Пин перечисления «Не сдали» правится ОСОЗНАННО:
 * прежде проба строила его в порядке РАСХОДА (сортировка по имени), а экран
 * с №296 печатает и список ниже, и перечисление отставших очередью дерева —
 * департамент за департаментом. Пин закреплял порядок, который заказчик
 * попросил изменить.
 */
async function divisionQueue(token: string): Promise<string[]> {
  const rows = await get<{ results: { id: string }[] }>(
    token, '/api/ops/daily/divisions/')
  return rows.results.map((row) => String(row.id))
}

async function divisionLabels(token: string): Promise<Map<string, string>> {
  const rows = await get<{ results: { id: string; name: string; ancestors?: string[] }[] }>(
    token, '/api/ops/daily/divisions/')
  const labels = new Map<string, string>()
  for (const row of rows.results) {
    const path = row.ancestors ?? []
    labels.set(String(row.id), path.length > 0 ? `${row.name} · ${path.join(' › ')}` : row.name)
  }
  return labels
}


// Тот же алгоритм, что `formatIsoDate` в `shared/lib/date.ts` («ГГГГ-ММ-ДД» →
// «ДД.ММ.ГГГГ»), но БЕЗ `toLocaleDateString`: движок теста (Node) и движок
// страницы (Chromium) не обязаны иметь идентичные ICU-данные, а точный текст
// (Minor-находка ревью: не подстрочный `toContainText`) требует байт-в-байт
// совпадения.
function formatIsoDateRu(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

function fakeSubmission(divisionId: string, businessDate: string) {
  return {
    id: 999999,
    division_id: divisionId,
    business_date: businessDate,
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: STAND_USERNAME,
    submitted_at: new Date().toISOString(),
    late: false,
  }
}

/**
 * Перехват сдачи ОДНОГО целевого управления:
 * - POST → тело складывается в `captured`, ответ — правдоподобный фейк.
 * - GET БЕЗ `division_id`, С `business_date=<дата>` (списочный запрос
 *   борда — тот, что борд перечитывает по сигналу инвалидации панели) — ДО
 *   успешной сдачи проходит НАЖИВУЮ (честный список без цели), ПОСЛЕ —
 *   отвечает списком с добавленной записью для целевого управления.
 * - Любой другой GET (история версий конкретного управления — свой
 *   внутренний запрос панели, БЕЗ `business_date`, с `division_id`; другие
 *   управления) — НАЖИВУЮ всегда.
 */
async function interceptSubmit(
  page: Page,
  captured: { body: DaySubmissionBody | null },
  targetDivisionId: string,
  businessDate: string,
): Promise<void> {
  let submitted = false
  await page.route(
    (url) => url.pathname.includes('/api/ops/daily/daily-submissions/'),
    async (route) => {
      const request = route.request()
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as DaySubmissionBody
        captured.body = body
        submitted = true
        await route.fulfill({ status: 201, json: fakeSubmission(body.division_id, body.business_date) })
        return
      }
      const requestUrl = new URL(request.url())
      const isBoardListQuery =
        requestUrl.searchParams.get('business_date') === businessDate &&
        requestUrl.searchParams.get('division_id') === null
      if (submitted && isBoardListQuery) {
        await route.fulfill({
          status: 200,
          json: {
            count: 1,
            next: null,
            previous: null,
            results: [fakeSubmission(targetDivisionId, businessDate)],
          },
        })
        return
      }
      await route.continue()
    },
  )
}


/** Конверт отказа бэкенда ОМ — 9-полевой не бывает, но `error_code` НЕСУЩИЙ:
 * `readEnvelope` (`lib/ops-errors.ts`) без него читает тело как «конверта
 * нет», и 409 деградировал бы в безымянный отказ вместо
 * `DAY_ALREADY_SUBMITTED`. */
function conflictEnvelope(businessDate: string) {
  return {
    error_code: 'DAY_ALREADY_SUBMITTED',
    message: 'День уже сдан.',
    details: {},
    request_id: null,
    timestamp: `${businessDate}T12:00:00+05:00`,
  }
}

/**
 * Перехват ГОНКИ двух операторов: POST сдачи отвечает 409
 * `DAY_ALREADY_SUBMITTED` («пока ты жал кнопку, день сдал кто-то другой»), а
 * списочный GET борда ПОСЛЕ этого отвечает списком, в котором целевое
 * управление УЖЕ сдано — ровно то, что лежало бы в БД после чужой сдачи.
 *
 * До 409 списочный GET идёт НАЖИВУЮ: иначе проба не отличила бы «борд
 * перечитал состояние» от «борд с самого начала видел сданный день».
 */
async function interceptSubmitConflict(
  page: Page,
  targetDivisionId: string,
  businessDate: string,
): Promise<void> {
  let conflicted = false
  await page.route(
    (url) => url.pathname.includes('/api/ops/daily/daily-submissions/'),
    async (route) => {
      const request = route.request()
      if (request.method() === 'POST') {
        conflicted = true
        await route.fulfill({ status: 409, json: conflictEnvelope(businessDate) })
        return
      }
      const requestUrl = new URL(request.url())
      const isBoardListQuery =
        requestUrl.searchParams.get('business_date') === businessDate &&
        requestUrl.searchParams.get('division_id') === null
      if (conflicted && isBoardListQuery) {
        await route.fulfill({
          status: 200,
          json: {
            count: 1,
            next: null,
            previous: null,
            results: [fakeSubmission(targetDivisionId, businessDate)],
          },
        })
        return
      }
      await route.continue()
    },
  )
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'сдача дня' : 'сдача дня (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('бейдж/кнопка сдачи — внутри группы своего управления, ленивая панель, сводка синхронна с сдачей', async ({
    page,
  }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    expect(
      report.rows.length,
      'в расходе нет управлений — пробе нечем проверить сдачу',
    ).toBeGreaterThanOrEqual(1)

    // Гвард вакуумности: цель пробы — управление, которое СЕЙЧАС не сдано на
    // деловую дату (иначе шапка несла бы бейдж «Сдан», а не кнопку — клик
    // проверять было бы нечем, и сводке было бы некуда расти).
    const existing = await get<{ results: DaySubmissionRow[] }>(
      token,
      `/api/ops/daily/daily-submissions/?business_date=${report.business_date}&limit=200`,
    )
    const submittedIdsBefore = new Set(
      existing.results.filter((row) => row.is_current).map((row) => row.division_id),
    )
    const target = report.rows.find((row) => !submittedIdsBefore.has(String(row.division_id)))
    expect(target, 'все управления уже сданы на сегодня — пробе нечем проверить кнопку').toBeDefined()
    const targetDivisionId = String(target!.division_id)
    // Пары «id → имя», а не просто имена: одноимённых управлений на стенде
    // трое, и вычитать сданное ПО ИМЕНИ (как было) значило вычесть все три
    // строки разом (Plane №250).
    const notSubmittedBefore = report.rows
      .filter((row) => !submittedIdsBefore.has(String(row.division_id)))
      .map((row) => ({ id: String(row.division_id), name: row.name }))
    const rowLabels = await divisionRowLabels(token)
    // Порядок — очередь дерева (Plane №296), а НЕ порядок расхода: экран
    // печатает отставших тем же порядком, каким рисует список ниже.
    // Управление, которого в списке подразделений нет, уезжает в хвост — как
    // и на экране.
    const queue = await divisionQueue(token)
    const placeOf = (id: string): number => {
      const index = queue.indexOf(id)
      return index === -1 ? Number.MAX_SAFE_INTEGER : index
    }
    const notSubmittedNamesBefore = [...notSubmittedBefore]
      .sort((left, right) => placeOf(left.id) - placeOf(right.id))
      .map((row) => rowLabels.get(row.id) ?? row.name)

    const captured: { body: DaySubmissionBody | null } = { body: null }
    await interceptSubmit(page, captured, targetDivisionId, report.business_date)

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })

    // Сводка сверху — ТОЧНЫЙ текст (не подстрочный toContainText — Minor-
    // находка ревью), N/M/дата из живых ответов, не хардкод.
    const summary = board.getByRole('group', { name: 'Сводка сдачи дня' })
    const summaryHeadline = summary.locator('p').first()
    await expect(summaryHeadline).toHaveText(
      `Сдано ${submittedIdsBefore.size} из ${report.rows.length} управлений на ${formatIsoDateRu(report.business_date)}`,
    )
    // Блок «Не сдали» — СПИСОК, а не абзац (Plane №328): проверяется счётчик
    // и поимённый состав, а не одна склеенная строка. Порядок здесь не
    // закрепляется намеренно: строки разложены по департаментам, и очередь
    // дерева стережёт список управлений НИЖЕ, а не этот блок.
    await expectLaggards(summary, notSubmittedNamesBefore)

    // Группа ИМЕННО этого управления — бейдж СВЁРНУТОЙ шапки: «День не
    // сдан», без запроса и без интерактивности (панель ещё не смонтирована —
    // требование A.3 держится ленивостью, не наоборот).
    const label =
      (await divisionLabels(token)).get(String(target!.division_id)) ?? target!.name
    const group = board.getByRole('group', { name: label, exact: true })
    await expect(group.getByText('День не сдан', { exact: true })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Сдать день' })).toHaveCount(0)

    // Раскрытие строки — ТОЛЬКО теперь монтируется интерактивная панель.
    await group.getByRole('button').first().click()
    const submitButton = group.getByRole('button', { name: 'Сдать день' })
    await expect(submitButton).toBeVisible()
    await submitButton.click()
    await group.getByRole('button', { name: 'Подтвердить сдачу' }).click()

    await expect.poll(() => captured.body !== null, { timeout: 10_000 }).toBe(true)
    // Деловая дата — ИЗ ОТВЕТА расхода, division_id — ИМЕННО этой группы (не
    // соседней).
    expect(captured.body?.business_date).toBe(report.business_date)
    expect(captured.body?.division_id).toBe(targetDivisionId)

    // UI дошёл до конца по подменённому ответу — бейдж «День сдан» появился
    // ИМЕННО в группе этого управления (собственное состояние панели, без
    // ожидания рефетча).
    await expect(group.getByText(/День сдан/)).toBeVisible()

    // Сводка ОБЯЗАНА смениться: N выросло ровно на единицу, целевое
    // управление ушло из списка несдавших — точный текст, не хардкод.
    await expect(summaryHeadline).toHaveText(
      `Сдано ${submittedIdsBefore.size + 1} из ${report.rows.length} управлений на ${formatIsoDateRu(report.business_date)}`,
    )
    // ТОТ ЖЕ порядок очереди, что и до сдачи (Plane №296): сдача убирает из
    // перечисления одну строку, а не переставляет остальные.
    const notSubmittedNamesAfter = [...notSubmittedBefore]
      .filter((row) => row.id !== targetDivisionId)
      .sort((left, right) => placeOf(left.id) - placeOf(right.id))
      .map((row) => rowLabels.get(row.id) ?? row.name)
    await expectLaggards(summary, notSubmittedNamesAfter)

    // Схлопнули строку обратно — свёрнутый бейдж ТОЖЕ синхронен (питается тем
    // же обновлённым списочным ответом борда, без своего запроса).
    await group.getByRole('button').first().click()
    await expect(group.getByText('Сдан · v1', { exact: true })).toBeVisible()
  })

  test('409 «день уже сдан» (гонка операторов) — борд перечитывает состояние, кнопка сдачи гаснет', async ({
    page,
  }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')

    // Тот же гвард вакуумности, что у пробы выше: цель — управление, которое
    // СЕЙЧАС не сдано. Иначе кнопки «Сдать день» не было бы вовсе, 409 неоткуда
    // было бы получить, и «состояние перечиталось» проверялось бы на том, что и
    // так стояло на экране.
    const existing = await get<{ results: DaySubmissionRow[] }>(
      token,
      `/api/ops/daily/daily-submissions/?business_date=${report.business_date}&limit=200`,
    )
    const submittedIdsBefore = new Set(
      existing.results.filter((row) => row.is_current).map((row) => row.division_id),
    )
    const target = report.rows.find((row) => !submittedIdsBefore.has(String(row.division_id)))
    expect(target, 'все управления уже сданы на сегодня — пробе нечем поймать 409').toBeDefined()
    const targetDivisionId = String(target!.division_id)

    await interceptSubmitConflict(page, targetDivisionId, report.business_date)

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })

    const summary = board.getByRole('group', { name: 'Сводка сдачи дня' })
    const summaryHeadline = summary.locator('p').first()
    await expect(summaryHeadline).toHaveText(
      `Сдано ${submittedIdsBefore.size} из ${report.rows.length} управлений на ${formatIsoDateRu(report.business_date)}`,
    )

    const label =
      (await divisionLabels(token)).get(String(target!.division_id)) ?? target!.name
    const group = board.getByRole('group', { name: label, exact: true })
    await group.getByRole('button').first().click()
    await group.getByRole('button', { name: 'Сдать день' }).click()
    await group.getByRole('button', { name: 'Подтвердить сдачу' }).click()

    // Отказ назван словами — точным текстом словаря `describeSubmitFailure`.
    await expect(
      group.getByText('День уже сдан. Исправить его можно кнопкой «Исправить сдачу».', {
        exact: true,
      }),
    ).toBeVisible()

    // ГЛАВНОЕ: борд ПЕРЕЧИТАЛ состояние. До правки 22.08 панель на 409
    // инвалидировала ключ ["ops-daily","day-submission",…], у которого НЕТ ни
    // одного читателя (владение списком уехало в борд задачей 4) — запроса под
    // этим ключом в кэше не существует, `invalidateQueries` не находит его и не
    // рассылает события вовсе, борд ничего не перечитывал, и рядом с текстом
    // «день уже сдан» продолжала стоять живая кнопка «Сдать день».
    await expect(summaryHeadline).toHaveText(
      `Сдано ${submittedIdsBefore.size + 1} из ${report.rows.length} управлений на ${formatIsoDateRu(report.business_date)}`,
    )
    await expect(group.getByRole('button', { name: 'Сдать день' })).toHaveCount(0)
    await expect(group.getByText('День не сдан', { exact: true })).toHaveCount(0)

    // Свёрнутая шапка тоже говорит правду — тем же перечитанным ответом.
    await group.getByRole('button').first().click()
    await expect(group.getByText('Сдан · v1', { exact: true })).toBeVisible()
  })
})
