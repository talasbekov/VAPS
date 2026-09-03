/**
 * «Заявки департаменту» на `/employees?view=forces` (Plane №272, Ш-3).
 *
 * ОБРАТНЫЙ РАЗРЕЗ ЦЕПОЧКИ. Выше на том же экране живёт лента ШТАБА
 * («кому я раздал»), здесь — вид ДЕПАРТАМЕНТА («что просят у меня»). Это не
 * то же представление под фильтром: колонки, порядок и вопрос другие.
 *
 * Стережёт три вещи, каждая из которых уже была сломана и починена по
 * снимку экрана:
 *
 * 1. блок вообще отрисован и получил данные (а не молча пуст на 404 ручки);
 * 2. департамент НАЗВАН в строке — у одного мероприятия заявок столько,
 *    между сколькими департаментами штаб разделил потребность, и без имени
 *    две строки читаются как дубль (так и выглядело на первом снимке);
 * 3. перебор виден ЧИСЛОМ, а не только цветом полосы: «5 из 2» и «2 из 2»
 *    рисуют одинаково полную полосу, то есть «всё в порядке».
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface RequestRow {
  code: string
  departmentName: string
  need: number
  assigned: number
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

async function apiCall(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return res.json().catch(() => ({}))
}

/**
 * Заводит ОМ на «Расстановке» с ОДНИМ департаментом в раскладке — фикстура
 * для пробы №389 (СБС-21/22/23). Возвращает `eventId` и `allocationId`.
 *
 * 🔴 ОБХОДНОЙ ПУТЬ, НЕ ФИКС (найдено при ручной проверке №389, заводится
 * отдельной карточкой). `PATCH .../recon/` без ключа `sectorPosts` СТИРАЕТ
 * посты: `request.data.get("sectorPosts")` на сервере не отличает
 * «ключа нет» от `null`, хотя докстринг `update_recon` обещает обратное.
 * Обходится передачей ТЕКУЩИХ постов явно при отметке чек-листа.
 */
async function createDepartmentAllocationFixture(
  token: string,
): Promise<{ eventId: string; allocationId: string; departmentId: string }> {
  const objects = (await apiCall(token, 'GET', '/api/ops/security-events/bindable-objects/')) as {
    results: { id: string; publishedVersionCount: number }[]
  }
  const object = objects.results.find((item) => item.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

  const created = (await apiCall(token, 'POST', '/api/ops/security-events/', {
    title: `Проба заявки департаменту (e2e) ${Date.now()}`,
    objectId: object.id,
    businessDate: '2026-09-25',
    kind: 'INTERNAL',
  })) as { id: string }

  await apiCall(token, 'POST', `/api/ops/security-events/${created.id}/recon/import-from-passport/`)
  const withRecon = await apiCall(token, 'GET', `/api/ops/security-events/${created.id}/`)
  await apiCall(token, 'PATCH', `/api/ops/security-events/${created.id}/recon/`, {
    checklist: (withRecon.reconChecklist as { done: boolean }[]).map((item) => ({
      ...item,
      done: true,
    })),
    sectorPosts: withRecon.reconSectorPosts,
  })
  await apiCall(token, 'POST', `/api/ops/security-events/${created.id}/recon/complete/`)

  const departments = (await apiCall(token, 'GET', '/api/core/divisions/?page_size=200')) as {
    results: { id: number; name: string; type_code: string }[]
  }
  // «Первый департамент» — гарантированно укомплектован (используется другими
  // фикстурами стенда), в отличие от первого попавшегося: у того управления
  // могут стоять без единого сотрудника, и выделить будет некого.
  const department =
    departments.results.find((d) => d.name === 'Первый департамент') ??
    departments.results.find((d) => d.type_code === 'department')
  if (department === undefined) throw new Error('на стенде нет ни одного департамента')

  const withDemand = await apiCall(token, 'GET', `/api/ops/security-events/${created.id}/`)
  const need: number = withDemand.forceNeed
  const afterSplit = await apiCall(
    token,
    'POST',
    `/api/ops/security-events/${created.id}/forces/allocation/`,
    { rows: [{ departmentId: String(department.id), need }] },
  )
  const allocation = (afterSplit.forceAllocation as { id: string; departmentId: string }[])[0]
  return { eventId: created.id, allocationId: allocation.id, departmentId: allocation.departmentId }
}

async function dropEvent(token: string, eventId: string): Promise<void> {
  await fetch(`${API}/api/ops/security-events/${eventId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

test.describe('заявки департаменту', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('таблица собрана из ручки заявок и называет департамент каждой строки', async ({
    page,
  }) => {
    const token = await apiToken()
    const server = (await (
      await fetch(`${API}/api/ops/security-events/forces/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: RequestRow[] }
    expect(
      server.results.length,
      'на стенде нет ни одной заявки департаменту — таблице нечего показать',
    ).toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    // Заявки живут ВКЛАДКОЙ (эталон заказчика), а не блоком над экраном:
    // блок сверху делал свою таблицу первой на странице и ронял шесть проб
    // кадрового реестра, ищущих колонку по первой таблице.
    const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')

    const section = page.locator('section[aria-labelledby="department-requests-heading"]')
    await expect(section.getByRole('heading', { name: 'Заявки департаменту' })).toBeVisible({
      timeout: 30_000,
    })
    const rows = section.locator('tbody tr')
    await expect(rows, 'строк столько же, сколько отдала ручка').toHaveCount(
      server.results.length,
      { timeout: 20_000 },
    )

    // Департамент назван — иначе две заявки одного ОМ неотличимы.
    for (const row of server.results) {
      await expect(
        section.getByText(row.departmentName, { exact: false }).first(),
        `департамент «${row.departmentName}» не назван в таблице`,
      ).toBeVisible()
    }

    // Прогресс читается ЧИСЛОМ, а не только полосой.
    const first = server.results[0]
    await expect(
      section.getByText(`${first.assigned} из ${first.need}`, { exact: false }).first(),
      'прогресс не назван числом',
    ).toBeVisible()

    // Полоса объявлена вспомогательным технологиям, а не нарисована деревом.
    const bar = section.locator('[role="progressbar"]').first()
    await expect(bar).toHaveAttribute('aria-valuemax', String(first.need))
    await expect(bar).toHaveAttribute('aria-valuenow', String(first.assigned))
  })

  test('карточка заявки открывается на месте таблицы и несёт состав эталона', async ({
    page,
  }) => {
    /**
     * Plane №272, Ш-4. Карточка открывается НА МЕСТЕ таблицы («← Назад к
     * заявкам»), а не уводит на карточку мероприятия: та собрана для штаба и
     * показывает раскладку по ВСЕМ департаментам.
     *
     * Стережёт состав эталона: четыре плитки, распределение по управлениям с
     * полем квоты и список выделенных с подписью о том, откуда они берутся.
     */
    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()

    const open = page.getByRole('button', { name: /^Открыть заявку/ }).first()
    await expect(open).toBeVisible({ timeout: 20_000 })
    await open.click()

    await expect(
      page.getByRole('button', { name: 'Назад к заявкам' }),
      'карточка открылась на месте таблицы, а не увела на другой экран',
    ).toBeVisible({ timeout: 20_000 })

    // Четыре плитки эталона.
    for (const label of [
      'Квота департамента',
      'Разложено по управлениям',
      'Выделено',
      'Осталось',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }

    // Распределение по управлениям — с полем квоты у строки.
    await expect(page.getByRole('heading', { name: 'Распределение по управлениям' })).toBeVisible()
    const quotas = page.locator('input[id^="quota-"]')
    expect(await quotas.count(), 'нет ни одного поля квоты управления').toBeGreaterThan(0)

    // Ключевая строка эталона: она объясняет, откуда берутся люди.
    await expect(
      page.getByText(
        'выделенные сотрудники появляются здесь автоматически',
        { exact: false },
      ),
      'подпись о том, откуда берутся выделенные, не показана',
    ).toBeVisible()

    // Возврат работает: человек не заперт в карточке.
    await page.getByRole('button', { name: 'Назад к заявкам' }).click()
    await expect(
      page.getByRole('heading', { name: 'Заявки департаменту' }),
    ).toBeVisible()
  })

  test('без права департамента вкладки «Заявки» нет вовсе', async ({ page }) => {
    /**
     * Plane №272, Ш-5. Область («мой ли это департамент») считает сервер, а
     * КОД ПРАВА гейтит клиент: у кого его нет, тому вкладка не нужна вовсе —
     * ручка ответит 403, и безусловный запрос на каждом открытии экрана дал
     * бы красную строку в консоли каждому читателю.
     *
     * 🔴 НУЖЕН ТОТ, КОМУ ЭКРАН ОТКРЫТ, А ПРАВА ДЕПАРТАМЕНТА НЕТ. Первая
     * версия ходила под `observer` и была ВАКУУМНОЙ: ему закрыт весь экран,
     * вкладок ноль вообще, и «нет вкладки Заявки» выполнялось само собой.
     * Вторая ходила под `erda` — и после Ш-1 (Plane №352) сломалась по той же
     * причине: гейт страницы спрашивает права СБОРА СИЛ, а у роли «Оператор
     * подразделения» их нет ни одного, поэтому экран отвечает «Недостаточно
     * прав» целиком. Проба падала по таймауту, стережа не свой предмет
     * (Plane №375: кому вообще открыт этот экран — вопрос к заказчику, здесь
     * он не решается).
     *
     * Поэтому права подменяются ОТВЕТОМ РУЧКИ, как в `forces-gathering`:
     * набор держит экран открытым (`forces.select`) и НЕ содержит
     * `forces.allocate` — то самое право, которым гейтится вкладка. Проба
     * перестала зависеть от того, кому и что роздано на стенде, и снова
     * краснеет на своей мутации: покажи вкладку без проверки права — и ассерт
     * упадёт.
     *
     * Стережёт мутацию: показать вкладку без проверки права.
     */
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      async (route) =>
        route.fulfill({
          json: {
            permissions: [
              'event.view', 'status.view', 'personnel.view', 'forces.select',
            ],
            roles: [],
          },
        }),
    )
    const api = page.context().request
    const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
      csrfToken: string
    }
    await api.post(`${APP}/api/auth/callback/credentials/`, {
      form: {
        csrfToken: csrf.csrfToken,
        username: STAND_USERNAME,
        password: STAND_PASSWORD,
        json: 'true',
      },
    })

    await page.goto(`${APP}/employees?view=forces`)
    // Дожидаемся ЭКРАНА, а не таймаута: пока права грузятся, клиент
    // намеренно считает действие разрешённым (иначе интерфейс мигал бы), и
    // проверять надо после загрузки.
    // Экран этому человеку ОТКРЫТ — иначе проверка «нет вкладки» выполнялась
    // бы сама собой на пустом экране.
    await expect(page.getByRole('tab', { name: 'Список сотрудников' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('tab', { name: /В строю/ })).toBeVisible()
    await expect(
      page.getByRole('tab', { name: 'Заявки', exact: true }),
      'вкладка заявок показана тому, у кого нет права департамента',
    ).toHaveCount(0)
  })

  test('перебор назван числом, а не спрятан за полной полосой', async ({ page }) => {
    const token = await apiToken()
    const server = (await (
      await fetch(`${API}/api/ops/security-events/forces/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: RequestRow[] }
    const over = server.results.find((row) => row.need > 0 && row.assigned > row.need)
    test.skip(
      over === undefined,
      'на стенде нет заявки с перебором — проверять нечего (проба не мутирует стенд)',
    )

    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()
    const section = page.locator('section[aria-labelledby="department-requests-heading"]')
    await expect(section.getByRole('heading', { name: 'Заявки департаменту' })).toBeVisible({
      timeout: 30_000,
    })

    await expect(
      section.getByText(`перебор ${over!.assigned - over!.need}`, { exact: false }),
      'перебор не назван числом — полная полоса читается как «всё в порядке»',
    ).toBeVisible()
  })

  test('раскладка, оповещение и отправка штабу — целиком через ЭТОТ экран (Plane №389)', async ({
    page,
  }) => {
    /**
     * `[СБС-21]`/`[СБС-22]`/`[СБС-23]`. До этой правки на СВЕЖЕЙ заявке
     * (`directorates: []`) таблица не рендерила ни строки, ни поля ввода —
     * «Сохранить раскладку» показывалась ровно по тому же условию, что и
     * сама таблица, и оба были пусты одновременно. Кнопок «Оповестить
     * управления» и «Отправить список в штаб» на этом экране не было
     * вовсе — обе жили только на панели МЕРОПРИЯТИЯ у штаба
     * (`ForcesSplitPanel`), куда у ответственного за департамент нет
     * доступа (`event.view` не выдаётся этой роли намеренно).
     *
     * Проба ведёт ОДНУ заявку от пустого состояния до отправки, не выходя
     * с этого экрана. Работает под `admin` (как и соседние пробы файла) —
     * предмет пробы: что позволяет РУЧКА и что рисует ЭКРАН, а не то, кому
     * какая роль выдана на стенде.
     */
    const token = await apiToken()
    const fixture = await createDepartmentAllocationFixture(token)

    try {
      await signIn(page)
      await page.goto(`${APP}/employees?view=forces`)
      const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()

      // Заявок на стенде много — открываем СВОЮ по коду мероприятия, а не
      // первую попавшуюся.
      const event = await apiCall(token, 'GET', `/api/ops/security-events/${fixture.eventId}/`)
      await page
        .getByRole('button', { name: new RegExp(`^Открыть заявку ${event.code} `) })
        .click()

      // 🔴 ОБЛАСТЬ ВИДИМОСТИ — СВОЯ СЕКЦИЯ КАРТОЧКИ, А НЕ СТРАНИЦА ЦЕЛИКОМ.
      // Соседняя вкладка «Сборы» (штабной `ForceCollectionCard`) несёт
      // ТЕКСТУАЛЬНО ТЕ ЖЕ подписи («Отправить список в штаб», «Оповестить…»)
      // в своей собственной, другой цепочке — Radix Tabs держит содержимое
      // неактивной вкладки в DOM (не удаляет), и `.first()` без адреса
      // секции ловит ЧУЖУЮ кнопку молча (страница не падает, просто щёлкает
      // не туда). `split-heading`/`members-heading` — id, которые несёт
      // именно `DepartmentRequestCard`.
      const splitSection = page.locator('section[aria-labelledby="split-heading"]')
      const membersSection = page.locator('section[aria-labelledby="members-heading"]')
      const quotaInputs = splitSection.locator('input[id^="quota-"]')
      await expect(quotaInputs.first()).toBeVisible({ timeout: 20_000 })
      expect(
        await quotaInputs.count(),
        'таблица управлений пуста на свежей заявке — раскладывать некуда',
      ).toBeGreaterThan(0)

      const eventForNeed = await apiCall(token, 'GET', `/api/ops/security-events/${fixture.eventId}/`)
      const need: number = eventForNeed.forceNeed
      await quotaInputs.first().fill(String(need))
      await splitSection.getByRole('button', { name: 'Сохранить раскладку' }).click()
      await expect(splitSection.getByText(`Набрано ${need} из ${need}`, { exact: false })).toBeVisible({
        timeout: 15_000,
      })

      // Оповестить управления — кнопки на этом экране не было вовсе.
      await splitSection.getByRole('button', { name: 'Оповестить управления' }).click()
      await expect(splitSection.getByText('Запрошено', { exact: false }).first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(
        membersSection.getByRole('button', { name: 'Отправить список в штаб' }),
        'кнопка отправки не появилась после оповещения',
      ).toBeVisible()

      // Отправка без единого выделенного отклоняется СЕРВЕРОМ, и отказ
      // виден В ДИАЛОГЕ, а не молча.
      await membersSection.getByRole('button', { name: 'Отправить список в штаб' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
      await expect(
        page.getByText('Никто не выделен — отправлять нечего.', { exact: false }).first(),
      ).toBeVisible({ timeout: 15_000 })
      await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click()

      // Выделяем человека МИМО экрана (это работа начальника управления,
      // не этой карточки) и отправляем список успешно.
      const roster = (await apiCall(
        token,
        'GET',
        `/api/core/divisions/?page_size=200`,
      )) as { results: { id: number; parent: number | null; type_code: string }[] }
      const directorate = roster.results.find(
        (d) => d.type_code === 'directorate' && String(d.parent) === fixture.departmentId,
      )!
      const employees = (await apiCall(
        token,
        'GET',
        `/api/ops/daily/employees/?division_id=${directorate.id}&page_size=1`,
      )) as { results: { id: string }[] }
      await apiCall(
        token,
        'POST',
        `/api/ops/security-events/${fixture.eventId}/forces/allocation/${fixture.allocationId}/members/`,
        { employeeId: employees.results[0].id },
      )
      // Перезаход на список и повторное открытие: `reload()` сбрасывает
      // локальное состояние `opened` карточки в `DepartmentRequestsTable`
      // (адреса у карточки нет — она открывается кликом, а не маршрутом).
      await page.reload()
      await tab.click()
      await page
        .getByRole('button', { name: new RegExp(`^Открыть заявку ${event.code} `) })
        .click()
      // «Выделено» — колонка ТАБЛИЦЫ управлений (splitSection), а не блока
      // выделенных сотрудников: там строка называет ЧЕЛОВЕКА, а число «сколько
      // из скольких» — свойство управления.
      await expect(splitSection.getByText(`1 из ${need}`, { exact: false }).first()).toBeVisible({
        timeout: 15_000,
      })
      await membersSection.getByRole('button', { name: 'Отправить список в штаб' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
      await expect(
        membersSection.getByText('Отправлено — ждём решения штаба.', { exact: false }),
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await dropEvent(token, fixture.eventId)
    }
  })
})
