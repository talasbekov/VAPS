/**
 * «Сбор сил на ОМ» (`/employees`) — ЖИВОЙ стенд. С 21.08 экран СЛИТ с
 * реестром личного состава: реестр — первая вкладка, разрез сбора — соседние.
 *
 * Экран сводит три источника, и проба стережёт ровно стыки между ними:
 *
 * 1. знаменатели (штат, список, «в строю») взяты у РАСХОДА — владельца этих
 *    чисел; своего счёта личного состава экран не заводит;
 * 2. «Участие в ОМ» посчитано ПОИМЁННО по статусам, потому что расход этого
 *    не даёт: справочник кладёт `EVENT_ASSIGNMENT` в колонку `IN_SERVICE`;
 * 3. «Осталось в строю» = колонка расхода МИНУС привлечённые — без вычитания
 *    одни и те же люди считались бы дважды;
 * 4. статусы берутся НА ДЕЛОВУЮ ДАТУ: без неё ручка отдаёт все дни подряд, и
 *    завершённое дежружство недельной давности выбивало живого человека из
 *    строя (так и было — поймано живой сверкой 12 против 10).
 *
 * 🔴 Service worker MSW блокируется: иначе `page.route` не перехватывает
 * запросы приложения, и подмены ниже молча не применились бы.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/employees'

const EVENT_ASSIGNMENT = 'EVENT_ASSIGNMENT'
const IN_SERVICE_COLUMN = 'IN_SERVICE'

interface StrengthReport {
  business_date: string
  rows: { division_id: number; name: string; list_total: number; columns: Record<string, number> }[]
  totals: { staff_total: number; list_total: number; columns: Record<string, number> }
}

interface StatusRow {
  id: number
  employee_id: number
  status_type_code: string
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

/** Запись через API теми же ручками, что и человек с экрана. Соседка `get`:
 * пробам этого файла нужны обе, а локальные `call` внутри фикстур свои. */
async function send<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await res.json().catch(() => ({}))) as T
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

function metric(page: Page, label: string) {
  return page
    .getByRole('group', { name: 'Личный состав на сбор' })
    .locator('[data-slot="stat-card"]')
    .filter({ hasText: label })
    .first()
}


/** ОМ, доведённое до «Потребности»: расчёт постов ушёл штабу числом.
 *
 * Строится ПОД пробу, а не ищется на стенде: лента входящих показывает те ОМ,
 * что кто-то уже мог разложить, и проба «сохранилось» на чужой строке ничего
 * бы не доказала.
 */
async function prepareDemandEvent(
  token: string,
  businessDate = '2026-08-26',
): Promise<{ code: string; total: number }> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба раскладки сил (e2e)',
    objectId: object.id,
    businessDate,
    kind: 'INTERNAL',
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба раскладки.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = await call('GET', `${base}/`)
  const posts = afterImport.reconSectorPosts.map(
    (post: Record<string, unknown>, index: number) =>
      index === 0 ? { ...post, need: 4 } : post,
  )
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item: Record<string, unknown>) => ({
      ...item,
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: posts,
  })
  const demand = await call('POST', `${base}/recon/complete/`)
  return { code: demand.code, total: demand.forceDemandTotal }
}


/** ОМ на «Расстановке», прошедшее цепочку сбора сил: в составе один человек. */
async function prepareEventOnPlacement(
  token: string,
): Promise<{
  id: string
  roster: string[]
  employeeId: string
  postId: string
}> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json().catch(() => ({}))
  }
  const { code, total } = await prepareDemandEvent(token, '2027-06-01')
  const found = await call('GET', `/api/ops/security-events/?search=${encodeURIComponent(code)}`)
  const id = found.results[0].id as string
  const base = `/api/ops/security-events/${id}`

  const divisions = await call('GET', '/api/core/divisions/?page_size=200')
  const department = divisions.results.find((row: any) => row.type_code === 'department')
  const directorate = divisions.results.find((row: any) => row.type_code === 'directorate')
  const roster = await call('GET', `/api/ops/personnel/?division_id=${directorate.id}&page_size=1`)
  const person = roster.results[0]

  const split = await call('POST', `${base}/forces/allocation/`, {
    rows: [{ departmentId: String(department.id), need: 1 }],
  })
  const allocationId = split.forceAllocation[0].id as string
  await call('POST', `${base}/forces/allocation/${encodeURIComponent(allocationId)}/notify/`)
  await call('POST', `${base}/forces/allocation/${encodeURIComponent(allocationId)}/members/`, {
    employeeId: person.id,
  })
  await call('POST', `${base}/forces/allocation/${encodeURIComponent(allocationId)}/submit/`)
  await call('POST', `${base}/forces/allocation/${encodeURIComponent(allocationId)}/accept/`)

  // Стадию никто больше не двигает руками (Plane №110): «Потребность» и
  // «Запрос сил» прошёл сервер на завершении рекогносцировки, и весь сбор
  // выше шёл, пока ОМ уже стояло на «Расстановке». Ручные `demand/approve/`
  // и `forces/complete/` здесь стояли до задачи — теперь они отбились бы
  // «не на этом этапе».
  const placement = await call('GET', `${base}/`)
  if (placement.stage !== 'PLACEMENT') {
    throw new Error(`фикстура не дошла до расстановки: ${JSON.stringify(placement)}`)
  }
  expect(total).toBeGreaterThan(0)
  return {
    id,
    roster: placement.forceRoster.map((member: any) => member.name),
    employeeId: String(person.id),
    postId: placement.reconSectorPosts[0].id as string,
  }
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'сбор сил на ОМ' : 'сбор сил на ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('знаменатели взяты у расхода, привлечённые посчитаны по статусам', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const statuses = await get<{ results: StatusRow[] }>(
      token,
      `/api/operations/statuses/?business_date=${report.business_date}&status_type_code=${EVENT_ASSIGNMENT}&page_size=500`,
    )
    const assigned = statuses.results.length
    const inServiceColumn = report.totals.columns[IN_SERVICE_COLUMN] ?? 0

    expect(report.totals.list_total, 'расход пуст — проба вакуумна').toBeGreaterThan(0)
    expect(assigned, 'на стенде никого не выставили на ОМ — разделение колонки не проверяется').toBeGreaterThan(0)
    // Фикстура обязана РАЗВОДИТЬ штат и список: пока они равны, плитка,
    // взявшая не то поле, показывала бы то же число.
    expect(
      report.totals.staff_total,
      'штат равен списку — плитки «По штату» и «По списку» неотличимы',
    ).not.toBe(report.totals.list_total)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await expect(metric(page, 'По штату')).toBeVisible({ timeout: 25_000 })

    await expect(metric(page, 'По штату')).toContainText(String(report.totals.staff_total))
    await expect(metric(page, 'По списку')).toContainText(String(report.totals.list_total))
    await expect(metric(page, 'В строю')).toContainText(String(inServiceColumn))
    await expect(metric(page, 'Участие в ОМ')).toContainText(String(assigned))
    // Ключевая арифметика экрана: остаток — это колонка МИНУС привлечённые.
    await expect(metric(page, 'Осталось в строю')).toContainText(
      String(inServiceColumn - assigned),
    )
  })

  test('люди разложены по управлениям, вкладки не пересекаются', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const statuses = await get<{ results: StatusRow[] }>(
      token,
      `/api/operations/statuses/?business_date=${report.business_date}&status_type_code=${EVENT_ASSIGNMENT}&page_size=500`,
    )
    const assigned = statuses.results.length
    expect(assigned, 'на стенде нет привлечённых — вкладка пуста, проба вакуумна').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)

    // Слитый экран открывается реестром; разрез сбора — за вкладкой с ТЕМ ЖЕ
    // списком, суженным по статусу. Счётчик вкладки — люди из ручки статусов,
    // найденные в реестре: под admin без фильтров сужать список нечему.
    const assignedTab = page.getByRole('tab', { name: /Участие в ОМ/ })
    await expect(assignedTab).toBeVisible({ timeout: 25_000 })
    await expect(assignedTab).toContainText(`(${assigned})`)
    await assignedTab.click()
    await expect(assignedTab).toHaveAttribute('aria-selected', 'true')

    // Люди во вкладке — те же, что вернула ручка статусов, по числу строк:
    // вкладки сбора переиспользуют таблицу реестра, своей разметки нет.
    const panel = page.getByRole('tabpanel')
    const rows = panel.locator('tbody tr')
    await expect(rows).toHaveCount(assigned)

    // Список разложен ПО УПРАВЛЕНИЯМ: хотя бы одно подразделение расхода
    // обязано быть названо на экране.
    const divisionNames = report.rows.map((row) => row.name)
    const shown = await panel.innerText()
    expect(
      divisionNames.some((name) => shown.includes(name)),
      `ни одно подразделение расхода не названо в списке: ${divisionNames.join(', ')}`,
    ).toBe(true)

    // Вторая вкладка — ОСТАЛЬНЫЕ: привлечённый не может стоять в обеих, иначе
    // «осталось» и «отдано» описывали бы одних людей. ФИО берём из aria-label
    // кнопки действий — единственного места в строке, где оно стоит целиком.
    const assignedNames = await panel
      .locator('button[aria-label^="Действия: "]')
      .evaluateAll((buttons) =>
        buttons.map((button) => (button.getAttribute('aria-label') ?? '').replace('Действия: ', '')),
      )
    expect(assignedNames.length, 'ФИО из вкладки не прочитаны — сравнивать нечего').toBe(assigned)
    // 🔴 СВЕРКА ПО ИДЕНТИФИКАТОРУ, а не по ФИО (Plane №251). На стенде в 440
    // человек полные тёзки неизбежны, и сравнение по тексту объявляло «один
    // человек в обеих вкладках» там, где это два разных человека. ФИО
    // остаётся только в сообщении об ошибке — чтобы читать его глазами.
    const assignedIds = await page
      .locator('table tbody tr[data-employee-id]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-employee-id') ?? ''))
    expect(assignedIds.length, 'идентификаторы строк не прочитаны').toBe(assigned)
    const inServiceTab = page.getByRole('tab', { name: /В строю/ })
    await inServiceTab.click()
    // 🔴 Ждать ОБЯЗАТЕЛЬНО: без этого innerText читается с ещё не сменившейся
    // панели, и проба сравнивает список привлечённых сам с собой — она падала
    // именно так, показывая «человек в обеих вкладках» там, где его не было.
    // Адрес вкладку больше не хранит (в URL живёт только отбор) — достаточно
    // aria-selected: Radix меняет его и содержимое панели одним коммитом.
    await expect(inServiceTab).toHaveAttribute('aria-selected', 'true')
    const inServiceIds = new Set(
      await page
        .locator('table tbody tr[data-employee-id]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-employee-id') ?? '')),
    )
    for (const [index, id] of assignedIds.entries()) {
      expect(
        inServiceIds.has(id),
        `${assignedNames[index] ?? id} стоит и в «Участии в ОМ», и в «В строю» — ` +
          'один человек посчитан дважды',
      ).toBe(false)
    }
  })

  test('статусы спрашиваются на деловую дату, а не за все дни', async ({ page }) => {
    // 🔴 Регресс, пойманный живой сверкой: без business_date ручка отдаёт все
    // строки подряд, и ЗАВЕРШЁННЫЙ статус прошлой недели перетирал живое
    // состояние. Проба ловит это со стороны сети — запрос обязан нести дату.
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')

    await signIn(page)
    const asked: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/api/operations/statuses/')) asked.push(url.search)
    })
    await page.goto(`${APP}${SCREEN}`)
    await expect(metric(page, 'По штату')).toBeVisible({ timeout: 25_000 })
    await expect
      .poll(() => asked.length, { timeout: 15_000 })
      .toBeGreaterThan(0)
    expect(
      asked.every((search) => search.includes(`business_date=${report.business_date}`)),
      `запрос статусов ушёл без деловой даты: ${asked.join(' | ')}`,
    ).toBe(true)
  })

  test('недобор по заявке назван поимённо, а не только суммой', async ({ page }) => {
    await signIn(page)
    // Такой ответ бэк вернуть МОЖЕТ: ровно эта форма приходит у мероприятия,
    // по которому идёт сбор, — департамент отдал меньше запрошенного.
    // Подменённое мероприятие запоминаем ПОИМЁННО. С Plane №110 лента ведёт
    // окно сбора из трёх стадий, и на экране её строк десятки: «не отдано 5»
    // законно встречается у многих ОМ, а строгий режим Playwright не терпит
    // нескольких совпадений. Ищем недобор ВНУТРИ карточки того мероприятия,
    // которому мы его и подставили, — иначе проба зеленела бы на чужой строке.
    let patchedTitle = ''
    await page.route(
      (url) => url.pathname.includes('/api/ops/security-events/') && !url.pathname.match(/security-events\/[^/]+\//),
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          results?: {
            title?: string
            reconForceRequestedAt?: string | null
            forceRequests?: { requestedCount: number; allocatedCount: number }[]
          }[]
        }
        // Берём первое мероприятие, которое ЛЕНТА ПОКАЖЕТ: с заявками и с
        // проставленным моментом отправки штабу. Просто «первое с заявками»
        // мало — черновик старшего наряда лента не показывает, и подмена
        // уходила бы в карточку, которой на экране нет.
        // 🔴 И СТАДИЯ ТОЖЕ. Лента показывает окно сбора — DEMAND, FORCES,
        // PLACEMENT (`COLLECTION_STAGES` на экране): закрытое мероприятие с
        // заявками в неё не попадает, и подмена уходила в карточку, которой
        // на экране нет. Так проба и упала на полном прогоне 28.08.2026,
        // когда первым в ответе оказался закрытый ОМ (Plane №251).
        const visibleStages = ['DEMAND', 'FORCES', 'PLACEMENT']
        const first = body.results?.find(
          (row) =>
            row.forceRequests?.length &&
            row.reconForceRequestedAt !== null &&
            visibleStages.includes(String((row as { stage?: string }).stage)),
        )
        if (first?.forceRequests?.length) {
          first.forceRequests[0].requestedCount = 9
          first.forceRequests[0].allocatedCount = 4
          patchedTitle = first.title ?? ''
        }
        await route.fulfill({ json: body })
      },
    )
    await page.goto(`${APP}${SCREEN}`)
    const block = page.getByText('Запрос сил по мероприятиям')
    await expect(block).toBeVisible({ timeout: 25_000 })
    // ЖДЁМ ответ, а не читаем сразу: заголовок ленты рисуется ещё на загрузке,
    // и синхронная проверка успевала раньше запроса — проба падала за 700 мс
    // «реестр вернул пустой список», имея в виду «ответ ещё не пришёл».
    await expect
      .poll(() => patchedTitle, {
        timeout: 25_000,
        message: 'подмену некуда было применить — реестр не вернул ОМ с заявками',
      })
      .not.toBe('')
    // Строка департамента обязана назвать СВОЙ недобор: сумма отвечает
    // «сколько не хватает», строка — «с кого недобрали».
    const patchedCard = page
      .locator('div.rounded-lg.border')
      .filter({ hasText: patchedTitle })
      .first()
    await expect(patchedCard.getByText('не отдано 5')).toBeVisible()
  })


  test('раскладка по департаментам сохраняется, перебор отбивается', async ({ page }) => {
    const token = await apiToken()
    const { code, total } = await prepareDemandEvent(token)
    // Сторож фикстуры: делить нечего, если расчёт постов просит одного —
    // тогда и «остаток», и «перебор» проверялись бы вакуумно.
    expect(total, 'у пробного ОМ потребность меньше двух — делить нечего').toBeGreaterThan(1)
    const departments = await get<{ results: { id: number; name: string; type_code: string }[] }>(
      token,
      '/api/core/divisions/?page_size=200',
    )
    const department = departments.results.find((row) => row.type_code === 'department')
    expect(department, 'в справочнике стенда нет департамента — выбирать нечего').toBeTruthy()

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const card = page
      .locator('div.rounded-lg.border')
      .filter({ hasText: code })
      .first()
    await expect(card, 'пробного запроса нет в ленте штаба').toBeVisible({ timeout: 25_000 })
    await expect(card.locator('[data-slot="forces-split"]')).toBeVisible()

    // Перебор: сервер отбивает своим текстом, и он же виден на экране.
    await card.getByRole('button', { name: 'Департамент', exact: true }).click()
    await card.getByLabel('Департамент, строка 1', { exact: true }).selectOption(String(department!.id))
    await card.getByLabel('Сколько человек, строка 1', { exact: true }).fill(String(total + 1))
    await card.getByRole('button', { name: 'Сохранить раскладку' }).click()
    await expect(card.getByRole('alert')).toContainText(`при потребности ${total}`)

    // Разложенное сохраняется НА СЕРВЕРЕ: после перезагрузки строка на месте.
    await card.getByLabel('Сколько человек, строка 1', { exact: true }).fill(String(total - 1))
    await card.getByRole('button', { name: 'Сохранить раскладку' }).click()
    await expect(card.getByText('Раскладка сохранена')).toBeVisible()
    await page.reload()
    const saved = page.locator('div.rounded-lg.border').filter({ hasText: code }).first()
    await expect(saved.locator('[data-slot="forces-split-total"]')).toContainText(
      `разложено ${total - 1} из ${total}`,
      { timeout: 25_000 },
    )
    await expect(saved.getByLabel('Департамент, строка 1', { exact: true })).toHaveValue(String(department!.id))
  })

  test('оповещение управлений видно у заявки и повтор не переписывает момент', async ({
    page,
  }) => {
    const token = await apiToken()
    const { code, total } = await prepareDemandEvent(token)
    const departments = await get<{ results: { id: number; name: string; type_code: string }[] }>(
      token,
      '/api/core/divisions/?page_size=200',
    )
    const department = departments.results.find((row) => row.type_code === 'department')
    expect(department, 'в справочнике стенда нет департамента').toBeTruthy()
    // Сторож фикстуры: без управлений внутри департамента сервер отвечает
    // отказом, и проба проверяла бы не оповещение, а его отсутствие.
    const directorates = departments.results.filter(
      (row) => row.type_code === 'directorate',
    )
    expect(directorates.length, 'у стенда нет управлений — оповещать некого').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const card = page.locator('div.rounded-lg.border').filter({ hasText: code }).first()
    await expect(card).toBeVisible({ timeout: 25_000 })

    await card.getByRole('button', { name: 'Департамент', exact: true }).click()
    await card.getByLabel('Департамент, строка 1', { exact: true }).selectOption(String(department!.id))
    await card.getByLabel('Сколько человек, строка 1', { exact: true }).fill(String(total))
    await card.getByRole('button', { name: 'Сохранить раскладку' }).click()
    await expect(card.getByText('Раскладка сохранена')).toBeVisible()

    const state = card.locator('[data-slot="allocation-state"]')
    await expect(state).toContainText('В департамент не отправлено')
    await state.getByRole('button', { name: 'Оповестить управления' }).click()
    await expect(state).toContainText('Управления оповещены', { timeout: 20_000 })
    const first = (await state.locator('li').first().textContent()) ?? ''
    expect(first, 'у оповещённого управления нет момента').toContain('оповещено')

    // Повтор добирает неоповещённых и НЕ переписывает момент уже оповещённым.
    await state.getByRole('button', { name: 'Оповестить ещё раз' }).click()
    await expect(state.locator('li').first()).toHaveText(first, { timeout: 20_000 })

    // Оповещённый департамент из раскладки больше не снимается — замок
    // ставит сервер, и кнопка снятия у строки погашена.
    await expect(card.getByRole('button', { name: 'Убрать департамент, строка 1', exact: true })).toBeDisabled()
  })

  test('цепочка сбора сил доходит до состава мероприятия', async ({
    page,
  }) => {
    const token = await apiToken()
    // Мероприятие БУДУЩЕЙ датой: статус привлечения тогда ещё не начался, и
    // проба может проверить снятие. На сегодняшнем ОМ снятие запрещено самим
    // доменом статусов — это правило, а не обходимая помеха.
    const { code } = await prepareDemandEvent(token, '2027-06-01')
    const departments = await get<{ results: { id: number; name: string; type_code: string }[] }>(
      token,
      '/api/core/divisions/?page_size=200',
    )
    const department = departments.results.find((row) => row.type_code === 'department')
    const directorate = departments.results.find((row) => row.type_code === 'directorate')
    expect(directorate, 'у стенда нет управления — выделять некому').toBeTruthy()
    const roster = await get<{ count: number }>(
      token,
      `/api/ops/personnel/?division_id=${directorate!.id}&page_size=1`,
    )
    expect(roster.count, 'в управлении стенда нет людей — выделять некого').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const card = page.locator('div.rounded-lg.border').filter({ hasText: code }).first()
    await expect(card).toBeVisible({ timeout: 25_000 })
    await card.getByRole('button', { name: 'Департамент', exact: true }).click()
    await card.getByLabel('Департамент, строка 1', { exact: true }).selectOption(String(department!.id))
    await card.getByRole('button', { name: 'Сохранить раскладку' }).click()
    await expect(card.getByText('Раскладка сохранена')).toBeVisible()
    const state = card.locator('[data-slot="allocation-state"]')
    await state.getByRole('button', { name: 'Оповестить управления' }).click()
    await expect(state).toContainText('Управления оповещены', { timeout: 20_000 })

    await state.getByRole('button', { name: 'Выделить людей' }).first().click()
    const picker = state.locator('[data-slot="personnel-picker"]')
    await expect(picker).toBeVisible()
    const candidate = picker.getByRole('button').filter({ hasNotText: 'Дальше' }).nth(1)
    const candidateName = ((await candidate.textContent()) ?? '').trim()
    await candidate.click()
    await expect(state).toContainText('Выделено 1 из', { timeout: 20_000 })

    // Человек получил СТАТУС, а не только строку в списке: расход считает по
    // статусу, и запись без него для остальной системы ничего не значит.
    const statuses = await get<{ results: { employee_id: number }[] }>(
      token,
      `/api/operations/statuses/?business_date=2027-06-01&status_type_code=${EVENT_ASSIGNMENT}&page_size=200`,
    )
    expect(statuses.results.length, 'статуса привлечения на дату ОМ нет').toBeGreaterThan(0)

    // Отправка списка штабу (СС-4): отправляется НЕДОБОР — решает штаб, а не
    // форма, — и отправленное можно отозвать, пока штаб не решил.
    await expect(state).toContainText('недобор')
    await state.getByRole('button', { name: 'Отправить список в штаб' }).click()
    await expect(state).toContainText('Список отправлен в штаб', { timeout: 20_000 })
    await expect(state).toContainText('ждёт решения штаба')
    await state.getByRole('button', { name: 'Отозвать список' }).click()
    await expect(state).toContainText('Управления оповещены', { timeout: 20_000 })

    // Решение штаба (СС-5): возврат требует причины и объявляет её словами,
    // приёмка отдаёт человека в СОСТАВ мероприятия.
    await state.getByRole('button', { name: 'Отправить список в штаб' }).click()
    await expect(state).toContainText('ждёт решения штаба', { timeout: 20_000 })
    await state.getByRole('button', { name: 'Вернуть департаменту' }).click()
    await expect(state.getByRole('alert')).toContainText('причина', {
      timeout: 20_000,
    })
    await state.getByLabel('Причина возврата списка').fill('Нужны люди с допуском')
    await state.getByRole('button', { name: 'Вернуть департаменту' }).click()
    await expect(state).toContainText('Возвращено штабом: Нужны люди с допуском', {
      timeout: 20_000,
    })

    await state.getByRole('button', { name: 'Отправить список в штаб' }).click()
    await state.getByRole('button', { name: 'Принять в мероприятие' }).click()
    await expect(state).toContainText('люди переданы мероприятию', {
      timeout: 20_000,
    })
    await expect(card.locator('[data-slot="forces-roster"]')).toContainText(
      'Состав мероприятия: 1 чел.',
    )

    expect(candidateName, 'подбор отдал пустую строку').not.toBe('')
  })

  test('расстановка предлагает СОСТАВ мероприятия, а не весь кадровый список', async ({
    page,
  }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    expect(prepared.roster.length, 'состав пуст — предлагать нечего').toBe(1)
    // Сторож: в кадрах людей БОЛЬШЕ, чем в составе, иначе «панель показывает
    // только состав» неотличимо от «показывает всех».
    const all = await get<{ count: number }>(token, '/api/ops/personnel/?page_size=1')
    expect(all.count, 'в кадрах не больше одного человека — проба вакуумна').toBeGreaterThan(1)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Расстановка', { timeout: 25_000 })
    await expect(main).toContainText(`Состав мероприятия: ${prepared.roster.length} чел.`)
    await expect(main).toContainText('Кандидаты — люди, принятые штабом')
    // Ни одного постороннего: имена в панели подбора — ровно состав.
    await expect(main).toContainText(prepared.roster[0])
  })

  test('назначенный на пост назван подразделением и статусом дня', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const assigned = await fetch(
      `${API}/api/ops/security-events/${prepared.id}/placement/assign/`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      },
    )
    expect(assigned.status, 'человек из состава не встал на пост').toBe(200)
    const row = ((await assigned.json()) as any).placementAssignments[0]
    // Сторож фикстуры СТРОГИЙ по типу: `not.toBe('')` и `not.toBeNull()`
    // проходят на `undefined`, то есть на ответе сервера, который этих полей
    // не отдаёт вовсе, — так проба и зеленела против стенда, поднятого до
    // правки сериализатора.
    expect(typeof row.divisionName, 'сервер не отдал divisionName').toBe('string')
    expect(row.divisionName, 'подразделение пустое — проверять нечего').not.toBe('')
    expect(typeof row.statusLabel, 'сервер не отдал statusLabel').toBe('string')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Расстановка', { timeout: 25_000 })
    // Подразделение спрашивается У ОТВЕТА, а не у управления фикстуры: человек
    // числится в ОТДЕЛЕ внутри управления, и совпадение имён было бы случайным.
    await expect(main).toContainText(row.divisionName as string)
    await expect(main).toContainText(row.statusLabel as string)
  })

  test('кандидат в подборе назван статусом дня, а занятый — занятым', async ({
    page,
  }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    // Сторож: состав отдаёт статус, иначе бейдж внизу проверял бы подпись
    // «в строю», которую клиент печатает и на пустом ответе.
    const card = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const member = card.forceRoster[0]
    expect(typeof member.statusLabel, 'состав не несёт статуса дня').toBe('string')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Расстановка', { timeout: 25_000 })
    await expect(main).toContainText(member.statusLabel as string)
    // Занятость подписывается только ПОСЛЕ назначения — иначе строка была бы
    // на экране всегда и ничего не значила.
    await expect(main).not.toContainText('уже назначен на пост этого мероприятия')

    await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
    })
    await page.reload()
    await expect(main).toContainText('уже назначен на пост этого мероприятия', {
      timeout: 25_000,
    })
  })

  test('дерево постов называет назначенного и считает сектор', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const tree = page.getByRole('main').getByText('Объекты и посты').locator('..').locator('..')
    await expect(tree).toContainText('Периметр', { timeout: 25_000 })
    // До назначения имени в дереве НЕТ — иначе ассерт ниже проходил бы всегда.
    await expect(tree).not.toContainText(name)
    // Счётчик СЕКТОРА, а не поста: у них разные знаменатели, и ассерт по
    // «0/» ловил бы любой из них — то есть не проверял бы ничего.
    const card = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const post = card.reconSectorPosts.find((row: any) => row.id === prepared.postId)
    const sectorNeed = card.reconSectorPosts
      .filter((row: any) => row.sector === post.sector)
      .reduce((sum: number, row: any) => sum + row.need, 0)
    expect(sectorNeed, 'сектор из одного поста — счётчики сектора и поста совпадут').toBeGreaterThan(
      post.need,
    )
    await expect(tree).toContainText(`0/${sectorNeed}`)

    await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
    })
    await page.reload()
    await expect(tree).toContainText(name, { timeout: 25_000 })
    await expect(tree).toContainText(`1/${sectorNeed}`)
  })

  test('старший сектора назначается кнопкой и виден в дереве', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]
    await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
    })

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    // До нажатия сектор старшего НЕ имеет — иначе ассерт ниже вечнозелёный.
    await expect(main).toContainText('Старший: не назначен')

    await main.getByRole('button', { name: 'Старший сектора' }).click()

    await expect(main).toContainText(`Старший: ${name}`, { timeout: 15_000 })
    await expect(main.getByRole('button', { name: 'Снять старшего' })).toBeVisible()

    await main.getByRole('button', { name: 'Снять старшего' }).click()
    await expect(main).toContainText('Старший: не назначен', { timeout: 15_000 })
  })

  test('бейдж рейтинга открывает краткую информацию о рейтинге', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]
    await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
    })
    // Проба стережёт ПОВЕДЕНИЕ модалки: бейдж нажали — открылась карточка про
    // ТОГО человека, с его агрегатом и блоком оценок.
    //
    // Откуда берётся агрегат — зависит от того, есть ли он у человека НА САМОМ
    // ДЕЛЕ. Раньше проба безусловно подставляла 8.4 перехватом и сторожила
    // подмену ассертом «настоящего рейтинга у него нет». Сторож сработал
    // 26.08.2026 и был ПРАВ: после РЙ-1 и РЙ-3 сеяные участники рейтинга
    // связаны с кадровыми записями 1…8 — теми, которых проба берёт первой
    // строкой управления, — и у выбранного появился настоящий агрегат.
    // Подмена с этого момента прятала бы живое значение, то есть проба
    // сверяла бы подмену с подменой.
    //
    // Поэтому: есть настоящий агрегат — идём на нём, перехвата НЕТ, модалка
    // проверяется на живых данных; нет — подставляем, как раньше (SW в этой
    // спеке заблокирован, иначе перехват молча промахнулся бы).
    const real = await get<any>(token, '/api/ops/operational-ratings/')
    const mine = (real.results ?? []).find(
      (r: any) => String(r.personnelId ?? '') === prepared.employeeId,
    )
    const realRating: number | null = mine?.aggregateRating ?? null
    const expectedRating = realRating === null ? 8.4 : realRating
    if (realRating === null) {
      await page.route(
      (url) => url.pathname === '/api/ops/operational-ratings/',
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                employeeId: `employee-${prepared.employeeId}`,
                personnelId: prepared.employeeId,
                safeLabel: name,
                aggregateRating: 8.4,
                evaluationsCount: 5,
                periodStartsAt: '2026-05-01',
                periodEndsAt: '2026-08-01',
                calculationPolicyVersion: 'OPERATIONAL-RATING-2026.07.1',
                calculatedAt: '2026-08-01T00:00:00+00:00',
                dataState: 'READY',
              },
            ],
            unavailableViews: [],
          }),
        }),
      )
    }

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    // Модалки НЕТ, пока бейдж не нажат.
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await main
      .getByRole('button', { name: `Открыть краткую информацию о рейтинге: ${name}` })
      .first()
      .click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Краткая информация о рейтинге')
    await expect(dialog).toContainText('изменение недоступно на этапе')
    // Модалка про ТОГО человека, чей бейдж нажали.
    await expect(dialog).toContainText(name)
    // Ассертится то, что модалка показывает ВСЕГДА: агрегат (настоящий либо
    // подставленный — см. выше) и заголовок блока оценок. «Методика» живёт в
    // блоке фактов, который исчезает при ошибке ручки подробностей, — ассерт
    // по ней был бы нестабильным.
    await expect(dialog).toContainText(String(expectedRating))
    await expect(dialog).toContainText('Последние 3 оценки')

    await dialog.getByRole('button', { name: 'Закрыть' }).first().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('предупреждение этапа и объяснение автоподбора', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    // Посты пусты — предупреждение называет ЧИСЛО незаполненных.
    const card = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const unfilled = card.reconSectorPosts.length
    expect(unfilled, 'постов нет — предупреждать не о чем').toBeGreaterThan(0)
    await expect(main).toContainText(`не укомплектовано постов: ${unfilled}`)
    // Объяснения автоподбора ДО нажатия нет — иначе ассерт ниже вечнозелёный.
    await expect(main).not.toContainText('Рекомендация автоподбора')

    await main.getByRole('button', { name: 'Сформировать автоматически' }).click()

    await expect(main).toContainText('Рекомендация автоподбора', { timeout: 20_000 })
    await expect(main).toContainText('совпадение')
    // Предупреждение НЕ исчезло: в составе один человек, а первый пост
    // просит четверых — ровно то, ради чего плашка и нужна. Число то же,
    // и это факт о данных, а не о вёрстке.
    await expect(main).toContainText(`не укомплектовано постов: ${unfilled}`)
  })

  test('смена, заданная на посту, видна на расстановке', async ({ page }) => {
    // История пробы: она сторожила смену из строки ПОТРЕБНОСТИ и была снята
    // вместе с боксом потребности (Plane №110) — заводить смену стало негде.
    // Возвращена по Plane №123, но целится теперь в ПОСТ: смена — свойство
    // поста, как в эталоне («Сектор A · смена 07:00–15:00»).
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const card = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const post = card.reconSectorPosts.find((row: any) => row.id === prepared.postId)

    // Задаём смену там же, где её задаёт человек, — правкой расчёта постов.
    const shift = '07:00–15:00'
    await send(token, 'PATCH', `/api/ops/security-events/${prepared.id}/recon/`, {
      checklist: card.reconChecklist,
      sectorPosts: card.reconSectorPosts.map((row: any) =>
        row.id === prepared.postId ? { ...row, shift } : row,
      ),
    })

    // Сторож: смена пришла ИМЕННО с поста, а не из строки потребности —
    // иначе проба не отличала бы новый источник от старого.
    const saved = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const savedPost = saved.reconSectorPosts.find(
      (row: any) => row.id === prepared.postId,
    )
    expect(savedPost.shift, 'смена не сохранилась на посту').toBe(shift)
    expect(
      (saved.demandRows ?? []).every((row: any) => (row.shift ?? '') === ''),
      'смена нашлась в строке потребности — проба не отличит источники',
    ).toBe(true)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    await expect(main).toContainText(`${post.sector} · ${shift}`)
  })


  test('действия цепочки выключены без своего права и названы словами', async ({
    page,
  }) => {
    // Права подменяются ОТВЕТОМ ручки: заводить на стенде роль без прав ради
    // пробы значило бы менять данные стенда ради проверки интерфейса. Набор —
    // «человек ведёт мероприятия, но звеньев сбора у него нет» (Plane №74).
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      async (route) =>
        route.fulfill({
          json: {
            permissions: ['event.view', 'event.manage', 'status.view', 'personnel.view'],
          },
        }),
    )
    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const block = page.getByRole('main').getByText('Запрос сил по мероприятиям')
    await expect(block).toBeVisible({ timeout: 25_000 })

    // Кнопка ВЫКЛЮЧЕНА, а не спрятана: спрятанная не отвечает на вопрос
    // «почему я этого не вижу», и человек идёт спрашивать.
    const save = page.getByRole('button', { name: 'Сохранить раскладку' }).first()
    await expect(save).toBeVisible()
    await expect(save).toBeDisabled()

    // Причина названа ролью, а не «нет прав»: общее «недостаточно прав» не
    // говорит человеку, чьё это действие и к кому идти.
    await expect(
      page.getByText('Делит потребность и решает по спискам штаб').first(),
    ).toBeVisible()
  })

  test('со своим правом действие цепочки доступно', async ({ page }) => {
    // Контрольная проба: без неё «выключено» выше не отличалось бы от
    // «выключено всегда», и гейт мог бы просто не работать.
    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const save = page.getByRole('button', { name: 'Сохранить раскладку' }).first()
    await expect(save).toBeVisible({ timeout: 25_000 })
    await expect(save).toBeEnabled()
    await expect(
      page.getByText('Делит потребность и решает по спискам штаб'),
    ).toHaveCount(0)
  })

  test('реестр личного состава остался достижим', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    // Слияние 21.08: реестр больше не отдельный маршрут — он ПЕРВАЯ вкладка
    // самого экрана, и открывается именно он, а не разрез сбора.
    await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ' })).toBeVisible({
      timeout: 25_000,
    })
    const tableTab = page.getByRole('tab', { name: 'Список сотрудников' })
    await expect(tableTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel').locator('tbody tr').first()).toBeVisible({
      timeout: 25_000,
    })
    // Старый адрес мёртв по-настоящему: живой значил бы, что реестр раздвоён.
    const response = await page.goto(`${APP}/employees/registry/`)
    expect(response?.status()).toBe(404)
  })
})
