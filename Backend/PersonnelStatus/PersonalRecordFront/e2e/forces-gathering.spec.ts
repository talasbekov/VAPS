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
import { prepareDemandEvent } from './prepare-events'
import { assertStep } from './fixture-step'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
// 🔴 `?view=forces` ЯВНО (Plane №273): вид по умолчанию сменился на расход
// организации — решение заказчика о порядке вкладок. Без параметра разрез
// сбора сил не отрисовался бы вовсе.
const SCREEN = '/employees?view=forces'

/**
 * 🔴 ПИН ИЗМЕНЁН ОСОЗНАННО (Plane №486, решение заказчика 04.09.2026).
 * Обоих «Привлечён на мероприятие» больше нет: они слиты в единственный
 * `IN_EVENT`, а различие «наряд / боевая группа» переехало в
 * `participations[].kind_code`. Старые два кода оставлены здесь ЧИТАТЕЛЯМИ —
 * ради строк, не прошедших миграцию на чужом стенде: считать их надо
 * по-прежнему, иначе проба зеленела бы по пустоте.
 */
const IN_EVENT = 'IN_EVENT'
const EVENT_ASSIGNMENT = 'EVENT_ASSIGNMENT'
/** Второй вид участия: специфическая группа (Plane №274, Ш-2/Ш-4). */
const EVENT_ASSIGNMENT_GROUP = 'EVENT_ASSIGNMENT_GROUP'
/** Вид участия боевой группой — теперь он и есть признак «группы». */
const SCREENING_GROUP_KIND = 'SCREENING_GROUP'
const IN_SERVICE_COLUMN = 'IN_SERVICE'

interface StrengthReport {
  business_date: string
  rows: { division_id: number; name: string; list_total: number; columns: Record<string, number> }[]
  totals: {
    staff_total: number
    list_total: number
    columns: Record<string, number>
    event: { total: number; group: number; squad: number }
  }
}

interface StatusRow {
  id: number
  employee_id: number
  status_type_code: string
  /** Виды участия строки (Plane №486): «наряд» или «боевая группа». */
  participations?: { event_id: number; kind_code: string }[]
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

/**
 * Привлечённых на дату — ОБА кода участия (Plane №274, Ш-5).
 *
 * 🔴 ПИН ИЗМЕНЁН ОСОЗНАННО. Раньше здесь стоял один `EVENT_ASSIGNMENT`, и это
 * повторяло ошибку экрана, а не проверяло его: разрез «Сбор сил» тоже знал
 * один код, поэтому проба и экран были согласованно неправы. Человек,
 * привлечённый специфической группой, у обоих оказывался «в строю» — то есть
 * свободным для нового привлечения. Считать надо оба кода; сама проба того,
 * что групповое участие доезжает до вкладки, живёт ниже отдельно и САМА
 * сажает такого человека, а не надеется найти его на стенде.
 */
async function assignedCount(
  token: string,
  businessDate: string,
  reportDivisionIds: Set<string>,
): Promise<number> {
  // 🔴 СЧИТАЕМ В ОБЛАСТИ РАСХОДА, а не по всем статусам стенда: расход
  // строится из штатных слотов подразделений, и участие сотрудника, чьё
  // подразделение в расходе не стоит (на стенде — служебная запись без
  // штатного слота), плитка не считает и считать не должна. Раньше помощник
  // складывал все статусы подряд и расходился с плиткой на единицу.
  let total = 0
  for (const code of [IN_EVENT, EVENT_ASSIGNMENT, EVENT_ASSIGNMENT_GROUP]) {
    const page = await get<{ results: StatusRow[] }>(
      token,
      `/api/operations/statuses/?business_date=${businessDate}&status_type_code=${code}&limit=500`,
    )
    for (const row of page.results) {
      const employee = await get<{ division: number | null }>(token, `/api/core/employees/${row.employee_id}/`)
      if (employee.division !== null && reportDivisionIds.has(String(employee.division))) total += 1
    }
  }
  return total
}
function reportDivisions(report: StrengthReport): Set<string> {
  return new Set(report.rows.map((row) => String(row.division_id)))
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
    await assertStep(res, method, path)
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

/**
 * Открыть КАРТОЧКУ СБОРА и вернуть секцию «Разбивка по департаментам»
 * (`[СБС-12]`, Plane №944).
 *
 * Редактор раскладки живёт СТРОКАМИ ТОЙ ЖЕ ТАБЛИЦЫ, что и отправленные
 * запросы (черновые строки с полем «Запрошено», строка кнопок
 * `[data-slot="split-editor"]`): отдельной панели «Правка раскладки» больше
 * нет. Ходим ПО АДРЕСУ (`?tab=collections&collection=<id>`, №779), а не
 * кликами: что вкладка и строка открываются нажатием, стережёт
 * `force-collections.spec.ts`.
 *
 * Доказательство, что карточка ОТКРЫЛАСЬ, а не показывает скелет или отказ, —
 * строка кнопок редактора: у ветки ошибки её нет.
 */
async function openSplitEditor(page: Page, eventId: string) {
  await page.goto(
    `${APP}${SCREEN}&tab=collections&collection=${encodeURIComponent(eventId)}`,
  )
  const section = page.locator('section[aria-labelledby="collection-split-heading"]')
  await expect(
    section.locator('[data-slot="split-editor"]'),
    'карточка сбора не открылась — редактора раскладки на экране нет',
  ).toBeVisible({ timeout: 25_000 })
  return section
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'сбор сил на ОМ' : 'сбор сил на ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('знаменатели взяты у расхода, привлечённые посчитаны по статусам', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    // Плитка и вкладка «Участие в ОМ» — это `totals.event.total` РАСХОДА: у
    // человека с двумя действующими статусами (болен И привлечён) расход
    // отдаёт одну колонку, и голый счёт статусов участия расходился с ним на
    // единицу. Сторож ниже держит, что статусов участия не МЕНЬШЕ, чем
    // насчитал расход, — иначе плитка выдумывала бы людей.
    const assigned = report.totals.event.total
    expect(
      await assignedCount(token, report.business_date, reportDivisions(report)),
      'статусов участия меньше, чем насчитал расход',
    ).toBeGreaterThanOrEqual(assigned)
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
    // 🔴 ЖДЁМ ЧИСЛО, А НЕ ВИДИМОСТЬ (Plane №582). Плитка появляется в разметке
    // С НУЛЁМ — значение считается из ещё не пришедшего расхода — и становится
    // `visible` РАНЬШЕ данных. Ассерт с умолчанием читал ноль и краснел; на
    // прогретом стенде данные успевали, на холодном нет, отсюда «краснеет
    // через раз». Замерено 04.09.2026: «ожидалось По штату 442, плитка
    // показывала 0», повтор той же пробы — passed за 2,3 с, а API в тот же
    // момент отдавал 442. Сервер был прав, проба спросила экран слишком рано.
    //
    // Своё ожидание у КАЖДОЙ плитки, а не одно на первую: они наполняются из
    // одного запроса, но проверка «первая дождалась — значит все» держится на
    // порядке отрисовки, а он не обещан ничем.
    const shown = (name: string, value: number) =>
      expect(metric(page, name)).toContainText(String(value), { timeout: 25_000 })

    await shown('По штату', report.totals.staff_total)
    await shown('По списку', report.totals.list_total)
    await shown('В строю', inServiceColumn)
    await shown('Участие в ОМ', assigned)
    // Ключевая арифметика экрана: остаток — это колонка МИНУС привлечённые.
    await shown('Осталось в строю', inServiceColumn - assigned)
  })

  test('люди разложены по управлениям, вкладки не пересекаются', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    // Плитка и вкладка «Участие в ОМ» — это `totals.event.total` РАСХОДА: у
    // человека с двумя действующими статусами (болен И привлечён) расход
    // отдаёт одну колонку, и голый счёт статусов участия расходился с ним на
    // единицу. Сторож ниже держит, что статусов участия не МЕНЬШЕ, чем
    // насчитал расход, — иначе плитка выдумывала бы людей.
    const assigned = report.totals.event.total
    expect(
      await assignedCount(token, report.business_date, reportDivisions(report)),
      'статусов участия меньше, чем насчитал расход',
    ).toBeGreaterThanOrEqual(assigned)
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

  test('привлечённый ГРУППОЙ считается выделенным, а не оставшимся в строю', async ({
    page,
  }) => {
    /**
     * Plane №274, Ш-5. Участий в ОМ два — физический наряд и специфическая
     * группа, — а разрез знал только первый. Человек с
     * `EVENT_ASSIGNMENT_GROUP` не попадал в «Участие в ОМ» и попадал в «В
     * строю»: экран показывал его свободным, и его можно было привлечь
     * второй раз.
     *
     * Проба САМА сажает такого человека, а не ищет его на стенде: пока
     * групповых статусов там нет, любая проверка «найди и посмотри» зелена
     * по пустоте. Это ровно тот случай, из-за которого Ш-3 переписывал
     * вакуумную пробу.
     *
     * Убрать за собой нельзя — статус расхода это факт, ручки удаления у него
     * нет (разбор — в шапке `status-set-dialog.spec.ts`). Поэтому берётся
     * человек БЕЗ статуса на дату, и накопление ограничено одной строкой за
     * прогон.
     */
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    // 🔴 ИЩЕМ ПО ВСЕМ УПРАВЛЕНИЯМ, а не по первому непустому. Убрать за собой
    // проба не может (статус расхода — факт, ручки удаления у него нет), и за
    // прогон уходит один свободный человек. В одном управлении их дюжина —
    // пул кончился за сутки, и проба честно упала «сажать некого». По всей
    // организации их сотни; когда кончатся и они, сообщение скажет прямо, что
    // кончился стенд, а не сломался код.
    const divisions = report.rows.filter((row) => row.list_total > 0)
    expect(divisions.length, 'в расходе нет ни одного непустого управления').toBeGreaterThan(0)

    // 🔴 ГРУППОВОЕ УЧАСТИЕ ВРУЧНУЮ БОЛЬШЕ НЕ СТАВИТСЯ (Plane №427,
    // `[СТС-…]`): статусы участия заводит только система из запроса на сбор
    // сил, а системный путь знает лишь «наряд». Поэтому проба берёт
    // СУЩЕСТВУЮЩИЙ групповой статус на дату (его заводит сид стенда) и
    // отдельно стережёт сам отказ на ручную постановку — это и есть правило.
    const inScope = reportDivisions(report)
    const groupRows = await get<{ results: StatusRow[] }>(
      token,
      `/api/operations/statuses/?business_date=${report.business_date}` +
        `&status_type_code=${IN_EVENT}&limit=500`,
    )
    let free: { id: number } | undefined
    for (const row of groupRows.results) {
      // 🔴 ГРУППУ ТЕПЕРЬ ОПОЗНАЁТ ВИД УЧАСТИЯ, А НЕ КОД СТАТУСА (Plane №486):
      // после слияния код у наряда и у группы один, и брать первую попавшуюся
      // строку значило бы проверять наряд под именем группы.
      const isGroup = (row.participations ?? []).some(
        (item) => item.kind_code === SCREENING_GROUP_KIND,
      )
      if (!isGroup) continue
      const employee = await get<{ division: number | null }>(token, `/api/core/employees/${row.employee_id}/`)
      if (employee.division !== null && inScope.has(String(employee.division))) {
        free = { id: Number(row.employee_id) }
        break
      }
    }
    if (free === undefined) {
      throw new Error(
        'на стенде нет фикстуры: участие вида «боевая группа» (SCREENING_GROUP) на деловую дату у сотрудника из расхода. ' +
          'Вручную оно не ставится (Plane №427) — заводится сидом: manage.py seed_smoke_fixtures',
      )
    }

    const anyone = divisions[0]!
    // Пустая страница сотрудников даёт голый TypeError вместо разбираемого
    // отказа (Plane №725): `!` глушит проверку, а не делает её. Отказ обязан
    // называть, ЧЕГО не хватает на стенде.
    const candidates = await get<{ results: { id: number | string }[] }>(
      token,
      `/api/ops/daily/employees/?division_id=${anyone.division_id}&page_size=1`,
    )
    expect(
      candidates.results.length,
      `в управлении ${anyone.division_id} нет ни одного сотрудника — фикстуры стенда не хватает`,
    ).toBeGreaterThan(0)
    const someone = candidates.results[0]!
    const nextDay = new Date(`${report.business_date}T00:00:00Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const refused = await fetch(`${API}/api/operations/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee_id: Number(someone.id),
        // Слитый код (Plane №486): отказ стережётся именно на нём — старый
        // тип погашен и отбился бы раньше, другой ошибкой, и проба перестала
        // бы отвечать на свой вопрос.
        status_type_code: IN_EVENT,
        date_start: report.business_date,
        date_end: nextDay.toISOString().slice(0, 10),
      }),
    })
    // 🔴 ЗАПРЕТ СМЕНИЛСЯ ТРЕБОВАНИЕМ (Plane №737, решение заказчика). Ручная
    // постановка участия РАЗРЕШЕНА начальнику управления, но мероприятие
    // назвать обязан: тело без `participations` — по-прежнему 422, только
    // другим кодом. Пин поднят осознанно, а не подогнан: старый код снят
    // вместе со своим raise-сайтом.
    expect(refused.status, 'участие без мероприятия должно отбиваться (Plane №737)').toBe(422)
    expect((await refused.json()).error_code).toBe('PARTICIPATION_EVENT_REQUIRED')

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const assignedTab = page.getByRole('tab', { name: /Участие в ОМ/ })
    await expect(assignedTab).toBeVisible({ timeout: 25_000 })
    await assignedTab.click()
    await expect(assignedTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.locator(`table tbody tr[data-employee-id="${free!.id}"]`),
      'привлечённый группой обязан стоять в «Участии в ОМ»',
    ).toHaveCount(1)

    const inServiceTab = page.getByRole('tab', { name: /В строю/ })
    await inServiceTab.click()
    await expect(inServiceTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.locator(`table tbody tr[data-employee-id="${free!.id}"]`),
      'он же не может числиться свободным — иначе его привлекут дважды',
    ).toHaveCount(0)
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

  /**
   * 🔴 ПРОБА «НЕДОБОР ПО ЗАЯВКЕ НАЗВАН ПОИМЁННО» СНЯТА ВМЕСТЕ С ТЕМ, ЧТО ОНА
   * СТЕРЕГЛА (Plane №928, решение заказчика).
   *
   * Она подменяла ответ реестра ОМ и искала в ленте штаба строку
   * «По расчёту рекогносцировки · 0 из 5 · не отдано 5». Эти строки рисовались
   * из `event.forceRequests` и жили ТОЛЬКО в снятом блоке «Запрос сил по
   * мероприятиям» — вместе с ним они и ушли с экрана.
   *
   * Инвариант, ради которого проба заводилась («сумма отвечает „сколько не
   * хватает“, строка — „с кого недобрали“»), НЕ осиротел: в карточке сбора его
   * держит `force-collections.spec.ts` — там колонки `[СБС-12]` проверяются у
   * КАЖДОЙ строки департамента (`Запрошено · Выделяют · Прислано`), а сумма —
   * отдельным ассертом по `[data-slot="collection-totals"]`.
   *
   * Переписывать пробу под новый экран значило бы завести второй сторож того
   * же инварианта; оставлять её на старом — сторожить разметку, которой нет.
   */


  test('раскладка: черновик правится, отправка запирает цифру, сумма сверх потребности не отбивается', async ({ page }) => {
    /**
     * `[СБС-12]` (Plane №944): «Запрошено [ввод]» в строке таблицы; «Блокировки
     * на сумму нет» — перебор называется словами, а не отбивается; после
     * «Отправить запросы» цифры заперты, недобор довыделяется НОВОЙ строкой,
     * и довыделение в редактор черновика не попадает (№675).
     */
    const token = await apiToken()
    const { id, total } = await prepareDemandEvent(token)
    expect(total, 'у пробного ОМ потребность меньше двух — делить нечего').toBeGreaterThan(1)
    const departments = await get<{ results: { id: number; name: string; type_code: string }[] }>(
      token,
      '/api/core/divisions/?page_size=200',
    )
    const department = departments.results.find((row) => row.type_code === 'department')
    expect(department, 'в справочнике стенда нет департамента — выбирать нечего').toBeTruthy()

    await signIn(page)
    const section = await openSplitEditor(page, id)

    await section.getByRole('button', { name: 'Департамент', exact: true }).click()
    await section.getByLabel('Департамент, строка 1', { exact: true }).selectOption(String(department!.id))
    await section.getByLabel('Сколько человек, строка 1', { exact: true }).fill(String(total + 1))
    // Сверх потребности — факт на экране, не ошибка.
    await expect(section.locator('[data-slot="forces-split-total"]')).toContainText(
      `сверх потребности 1`,
    )
    await section.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(section.getByText('Черновик сохранён')).toBeVisible({ timeout: 20_000 })

    // Черновик живёт НА СЕРВЕРЕ и правится: после перезагрузки поле на месте
    // с той же цифрой — значит, департаменту он ещё не ушёл.
    await page.reload()
    const saved = await openSplitEditor(page, id)
    await expect(saved.getByLabel('Сколько человек, строка 1', { exact: true })).toHaveValue(
      String(total + 1),
      { timeout: 25_000 },
    )
    await saved.getByLabel('Сколько человек, строка 1', { exact: true }).fill(String(total - 1))
    await saved.getByRole('button', { name: 'Отправить запросы' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(`Запрошено ${total - 1} при потребности ${total}`)
    await dialog.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(saved.getByText('Запросы отправлены департаментам')).toBeVisible({ timeout: 20_000 })

    // Отправленная строка — ТОЛЬКО ДЛЯ ЧТЕНИЯ: поля ввода у неё нет.
    await expect(saved.getByLabel('Сколько человек, строка 1', { exact: true })).toHaveCount(0)
    await expect(saved.locator('[data-slot="department-status"]').first()).toContainText(
      'Запрос отправлен',
    )

    // Довыделение (`[СБС-12]`) — новая строка; в редактор черновика она не
    // попадает (Plane №675).
    const state = await get<{ forceAllocation: { id: string }[] }>(
      token,
      `/api/ops/security-events/${id}/`,
    )
    const allocationId = state.forceAllocation[0]!.id
    await send(token, 'POST', `/api/ops/security-events/${id}/forces/allocation/${allocationId}/notify/`)
    const topped = await send<{ forceAllocation: { id: string; topUpOf?: string | null }[] }>(
      token,
      'POST',
      `/api/ops/security-events/${id}/forces/allocation/${allocationId}/top-up/`,
      { count: 1 },
    )
    expect(
      topped.forceAllocation.filter((row) => row.topUpOf).length,
      'довыделенная строка не завелась — проверять нечего',
    ).toBe(1)

    await page.reload()
    const afterTopUp = await openSplitEditor(page, id)
    await expect(afterTopUp.locator('[data-slot="department-row"]')).toHaveCount(2, { timeout: 25_000 })
    await expect(afterTopUp.getByText('довыделение', { exact: false })).toBeVisible()
    await expect(
      afterTopUp.getByLabel('Департамент, строка 1', { exact: true }),
      'довыделенная строка попала в редактор черновика',
    ).toHaveCount(0)
  })

  // Проба «оповещение управлений видно у заявки» СНЯТА (Plane №944): по
  // спецификации `[СБС-22]` управления оповещает ОТВЕТСТВЕННЫЙ ДЕПАРТАМЕНТА со
  // своей карточки, и на экране штаба этой кнопки больше нет. Правило №557
  // («момент только у управления с квотой») стережёт
  // `department-requests.spec.ts` и `test_ops_forces_gathering.py`.

  test('неполная строка раскладки не даёт открыть диалог отправки', async ({ page }) => {
    /**
     * Ревью №825 по №944 (08.09.2026): строка «+ Департамент» без выбранного
     * департамента попадала в диалог «Отправить запросы?» как «— департамент
     * не выбран —» с активной «Отправить»; сервер отвечал ошибкой формы по
     * позиции, а она рисовалась ПОД таблицей — за диалогом. Человек видел
     * диалог без реакции. Теперь кнопка «Отправить запросы» гаснет, пока у
     * строки нет департамента или число меньше единицы, и называет причину.
     *
     * КРАСНАЯ ПРОБА: убери `incompleteRow` из `disabled` — кнопка активна.
     */
    const token = await apiToken()
    const { id } = await prepareDemandEvent(token, '2027-06-01')
    await signIn(page)
    const section = await openSplitEditor(page, id)
    await section.getByRole('button', { name: 'Департамент', exact: true }).click()

    const send = section.getByRole('button', { name: 'Отправить запросы' })
    await expect(send, 'строка без департамента, а «Отправить запросы» активна').toBeDisabled()
    await expect(send).toHaveAttribute('title', /департамент/)
    await page.screenshot({ path: 'smoke-results/split-incomplete-row.png', fullPage: true })

    await section.getByLabel('Департамент, строка 1', { exact: true }).selectOption({ index: 1 })
    await section.getByLabel('Сколько человек, строка 1', { exact: true }).fill('0')
    await expect(send, 'число меньше единицы, а кнопка активна').toBeDisabled()
    await section.getByLabel('Сколько человек, строка 1', { exact: true }).fill('1')
    await expect(send).toBeEnabled()
  })

  test('цепочка сбора сил доходит до состава мероприятия', async ({
    page,
  }) => {
    /**
     * `[СБС-01]`/`[СБС-13]` (Plane №944): штаб отправляет запросы с экрана,
     * департамент отвечает и присылает список (здесь — ручками API, его экран
     * стережёт `department-requests.spec.ts`), и присланные люди появляются в
     * блоке «Собранные сотрудники → объекты» БЕЗ отдельного «Принять в
     * мероприятие». Возврат списка с причиной — с экрана штаба — забирает
     * людей из состава.
     */
    const token = await apiToken()
    // Мероприятие БУДУЩЕЙ датой: статус привлечения тогда ещё не начался.
    const { id } = await prepareDemandEvent(token, '2027-06-01')
    const departments = await get<{ results: { id: number; name: string; type_code: string; parent: number | null }[] }>(
      token,
      '/api/core/divisions/?page_size=200',
    )
    const department = departments.results.find((row) => row.type_code === 'department')
    const directorate = departments.results.find(
      (row) => row.type_code === 'directorate' && row.parent === department!.id,
    )
    expect(directorate, 'у департамента стенда нет управления — выделять некому').toBeTruthy()
    const people = await get<{ count: number; results: { id: string; full_name: string }[] }>(
      token,
      `/api/ops/personnel/?division_id=${directorate!.id}&page_size=8`,
    )
    expect(people.count, 'в управлении стенда нет людей — выделять некого').toBeGreaterThan(0)

    await signIn(page)
    const section = await openSplitEditor(page, id)
    await section.getByRole('button', { name: 'Департамент', exact: true }).click()
    await section.getByLabel('Департамент, строка 1', { exact: true }).selectOption(String(department!.id))
    await section.getByRole('button', { name: 'Отправить запросы' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(section.getByText('Запросы отправлены департаментам')).toBeVisible({ timeout: 20_000 })

    // Департамент (по API): оповестить управления, выделить одного, отправить.
    const state = await get<{ forceAllocation: { id: string }[] }>(token, `/api/ops/security-events/${id}/`)
    const allocationId = state.forceAllocation[0]!.id
    await send(token, 'POST', `/api/ops/security-events/${id}/forces/allocation/${allocationId}/notify/`)
    let candidate: { id: string; full_name: string } | null = null
    for (const person of people.results) {
      const added = await send<{ error_code?: string }>(
        token,
        'POST',
        `/api/ops/security-events/${id}/forces/allocation/${allocationId}/members/`,
        { employeeId: person.id },
      )
      if (added.error_code === undefined) {
        candidate = person
        break
      }
    }
    expect(candidate, 'не нашлось ни одного свободного на дату ОМ').not.toBeNull()

    // Человек получил СТАТУС, а не только строку в списке.
    const statuses = await get<{ results: { employee_id: number }[] }>(
      token,
      `/api/operations/statuses/?business_date=2027-06-01&status_type_code=${IN_EVENT}&limit=200`,
    )
    expect(statuses.results.length, 'статуса привлечения на дату ОМ нет').toBeGreaterThan(0)

    const submitted = await send<{ error_code?: string; forceRoster: { employeeId: string }[] }>(
      token,
      'POST',
      `/api/ops/security-events/${id}/forces/allocation/${allocationId}/submit/`,
    )
    expect(submitted.error_code, 'отправка списка не прошла').toBeUndefined()
    expect(submitted.forceRoster.map((m) => m.employeeId), 'присланный не попал в состав').toEqual([
      String(candidate!.id),
    ])

    // Блок 3 появился с первым присланным списком — без «Принять».
    await page.reload()
    const card = await openSplitEditor(page, id)
    const block = page.locator('section[aria-labelledby="roster-objects-heading"]')
    await expect(block).toBeVisible({ timeout: 25_000 })
    await expect(block).toContainText('Прислано 1 из')
    await expect(card.locator('[data-slot="department-status"]').first()).toContainText('Список прислан')

    // Возврат с причиной — с экрана штаба; люди уходят из состава.
    await card.getByRole('button', { name: 'Вернуть департаменту' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Вернуть', exact: true })).toBeDisabled()
    await dialog.getByLabel('Причина возврата').fill('Нужны люди с допуском')
    await dialog.getByRole('button', { name: 'Вернуть', exact: true }).click()
    await expect(card.getByText('Возвращено: Нужны люди с допуском')).toBeVisible({ timeout: 20_000 })
    await expect(block).toHaveCount(0)

    // Повторная отправка возвращает людей в состав.
    const again = await send<{ error_code?: string; forceRoster: { employeeId: string }[] }>(
      token,
      'POST',
      `/api/ops/security-events/${id}/forces/allocation/${allocationId}/submit/`,
    )
    expect(again.error_code).toBeUndefined()
    expect(again.forceRoster).toHaveLength(1)
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

    // Шаг-переход: отбитое назначение оставило бы человека НЕ на посту, и всё
    // ниже проверяло бы не то, что написано (Plane №812).
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )
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
    // 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №410): подпись дерева теперь называет
    // объект посещения («Посты объекта «…»»), и ловить его по строке
    // «Объекты и посты» стало нельзя. У области появилось ИМЯ — по нему и
    // ищем: оно не зависит от того, чей расчёт сейчас показан.
    const tree = page.getByRole('complementary', { name: 'Дерево постов' })
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

    // Шаг-переход: отбитое назначение оставило бы человека НЕ на посту, и всё
    // ниже проверяло бы не то, что написано (Plane №812).
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )
    await page.reload()
    await expect(tree).toContainText(name, { timeout: 25_000 })
    await expect(tree).toContainText(`1/${sectorNeed}`)
  })

  test('старший поста назначается кнопкой и виден в дереве вместе со своим постом', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]
    // Шаг-переход: отбитое назначение оставило бы человека НЕ на посту, и всё
    // ниже проверяло бы не то, что написано (Plane №812).
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    // 🔴 ПИН ПОДПИСИ ПОДНЯТ ОСОЗНАННО (Plane №705). Здесь стояло «Старший:» —
    // единственное число, доставшееся от старших СЕКТОРА. Старший теперь на
    // ПОСТ (`[РАС-03]`, Plane №445), и у сектора с двумя постами их двое:
    // подпись назвала бы обоих одним старшим сектора, а чьи это посты —
    // умолчала бы. Проба сверяет не только новую подпись, но и то, что рядом
    // с именем назван ПОСТ: без этого правка свелась бы к переименованию.
    await expect(main).toContainText('Старший поста: не назначен')

    // Чип «Старший поста» (`[РАС-03]`, Plane №445): состояние — aria-pressed.
    await main.getByRole('button', { name: /^Старший поста: / }).first().click()

    await expect(main).toContainText(`Старший поста: ${name} (`, { timeout: 15_000 })
    await expect(main.getByRole('button', { name: /^Старший поста: / }).first()).toHaveAttribute('aria-pressed', 'true')
    // Бейдж строки зовётся ТАК ЖЕ, как переключатель: «Старший сектора» на нём
    // обещал должность, которой после перехода на посты не существует.
    await expect(main).toContainText('Старший поста')
    await expect(main).not.toContainText('Старший сектора')

    await main.getByRole('button', { name: /^Старший поста: / }).first().click()
    await expect(main).toContainText('Старший поста: не назначен', { timeout: 15_000 })
  })

  test('бейдж рейтинга открывает краткую информацию о рейтинге', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]
    // Шаг-переход: отбитое назначение оставило бы человека НЕ на посту, и всё
    // ниже проверяло бы не то, что написано (Plane №812).
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )
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

    await main.getByRole('button', { name: 'Распределить автоматически' }).click()

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


  test('без права штаба редактор раскладки закрыт и причина названа словами', async ({
    page,
  }) => {
    /**
     * Права подменяются ОТВЕТОМ ручки: заводить на стенде роль без прав ради
     * пробы значило бы менять данные стенда ради проверки интерфейса. Набор —
     * «отвечает за департамент, но не штаб» (`forces.allocate` без
     * `forces.command`): экран открыт, вкладка «Сборы» закрыта СЛОВАМИ, чьё
     * это действие, а не «недостаточно прав» (Plane №74, Р-7; №944).
     */
    const token = await apiToken()
    const { id } = await prepareDemandEvent(token)
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      async (route) =>
        route.fulfill({
          json: {
            permissions: ['event.view', 'status.view', 'personnel.view', 'forces.allocate'],
          },
        }),
    )
    await signIn(page)
    await page.goto(`${APP}${SCREEN}&tab=collections&collection=${encodeURIComponent(id)}`)
    await expect(
      page.getByText('Делит потребность и решает по спискам штаб').first(),
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('button', { name: 'Отправить запросы' })).toHaveCount(0)
  })

  test('со своим правом редактор раскладки доступен', async ({ page }) => {
    // Контрольная проба: без неё «закрыто» выше не отличалось бы от «закрыто
    // всегда», и гейт мог бы просто не работать.
    const token = await apiToken()
    const { id } = await prepareDemandEvent(token)
    await signIn(page)
    const section = await openSplitEditor(page, id)
    await expect(section.getByRole('button', { name: 'Отправить запросы' })).toBeVisible({
      timeout: 25_000,
    })
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
