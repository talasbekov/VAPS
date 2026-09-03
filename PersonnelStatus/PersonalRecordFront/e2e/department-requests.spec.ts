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
  options: { businessDate?: string } = {},
): Promise<{ eventId: string; allocationId: string; departmentId: string }> {
  const objects = (await apiCall(token, 'GET', '/api/ops/security-events/bindable-objects/')) as {
    results: { id: string; publishedVersionCount: number }[]
  }
  const object = objects.results.find((item) => item.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

  const created = (await apiCall(token, 'POST', '/api/ops/security-events/', {
    title: `Проба заявки департаменту (e2e) ${Date.now()}`,
    objectId: object.id,
    businessDate: options.businessDate ?? '2026-09-25',
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

      // «Отправить в управления» — кнопки на этом экране не было вовсе.
      // Подпись — словами спецификации `[СБС-22]` (Plane №392); в №389 она
      // звалась «Оповестить управления» — пин правлен осознанно.
      await splitSection.getByRole('button', { name: 'Отправить в управления' }).click()
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

  test('ответ департамента «Выделяем: X» — своя цифра, отказ нулём и снятие отказа (Plane №391)', async ({
    page,
  }) => {
    /**
     * `[СБС-21]`: «Запрошено штабом: N · Выделяем: [ввод] · Комментарий».
     * Цифру ставит ответственный, штаб читает; ограничений нет; «0» закрывает
     * запрос статусом «Отказ». До правки поля не было вовсе — департамент не
     * мог сказать штабу «даём меньше» иначе как молча недобрав.
     *
     * Проба ведёт три состояния подряд на ОДНОЙ заявке: цифра меньше
     * запрошенной (с подсказкой «желательно пояснить»), отказ нулём (статус
     * «Отказ» и на карточке, и в таблице заявок), ненулевая цифра после
     * отказа (отказ снят). Всё — через экран, факт сверяется по API.
     */
    const token = await apiToken()
    const fixture = await createDepartmentAllocationFixture(token)

    try {
      await signIn(page)
      await page.goto(`${APP}/employees?view=forces`)
      const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      const event = await apiCall(token, 'GET', `/api/ops/security-events/${fixture.eventId}/`)
      const need: number = event.forceNeed
      await page
        .getByRole('button', { name: new RegExp(`^Открыть заявку ${event.code} `) })
        .click()

      const answer = page.locator('section[aria-labelledby="answer-heading"]')
      await expect(answer).toBeVisible({ timeout: 20_000 })
      await expect(answer.getByText(`Запрошено штабом: ${need}`, { exact: false })).toBeVisible()

      const rowOf = async () => {
        const fresh = await apiCall(token, 'GET', `/api/ops/security-events/${fixture.eventId}/`)
        return (fresh.forceAllocation as {
          id: string
          status: string
          allocating: number | null
          answerComment: string
        }[]).find((r) => r.id === fixture.allocationId)!
      }

      // 1. Меньше запрошенного — подсказка без блокировки, ответ доезжает.
      const less = Math.max(1, need - 1)
      await answer.getByLabel('Выделяем').fill(String(less))
      if (less < need) {
        await expect(answer.getByText('желательно пояснить', { exact: false })).toBeVisible()
      }
      await answer.getByLabel('Комментарий').fill('Двое в отпуске')
      await answer.getByRole('button', { name: 'Сохранить ответ' }).click()
      await expect.poll(async () => (await rowOf()).allocating, { timeout: 15_000 }).toBe(less)
      expect((await rowOf()).answerComment).toBe('Двое в отпуске')

      // 2. Ноль — отказ: статус на карточке и в таблице.
      await answer.getByLabel('Выделяем').fill('0')
      await expect(answer.getByText('закроет запрос отказом', { exact: false })).toBeVisible()
      await answer.getByRole('button', { name: 'Сохранить ответ' }).click()
      await expect.poll(async () => (await rowOf()).status, { timeout: 15_000 }).toBe('DECLINED')
      await expect(answer.getByText('Запрос закрыт отказом', { exact: false })).toBeVisible({
        timeout: 15_000,
      })

      // 3. Ненулевая цифра снимает отказ.
      await answer.getByLabel('Выделяем').fill(String(need))
      await answer.getByRole('button', { name: 'Сохранить ответ' }).click()
      await expect.poll(async () => (await rowOf()).status, { timeout: 15_000 }).not.toBe('DECLINED')
      await expect(answer.getByText('Запрос закрыт отказом', { exact: false })).toHaveCount(0)
    } finally {
      await dropEvent(token, fixture.eventId)
    }
  })

  test('«Отправить в управления» доставляет начальнику управления уведомление со ссылкой (Plane №392)', async ({
    page,
  }) => {
    /**
     * `[СБС-22]`: «Кнопка „Отправить в управления“ → уведомления начальникам
     * со ссылкой». До правки оповещение ставило управлению только момент
     * `notifiedAt` — персональной рассылки не было, начальник узнавал о
     * запросе, только если ему сказали словами.
     *
     * Читает уведомление `acc_dir_head` (область — «Первое управление»
     * Первого департамента). Фикстура раскладывает запрос ЕМУ и отправляет
     * с экрана ответственного. Проверяется сервер (лента по API) и экран
     * (колокольчик: текст с цифрой и переход по ссылке в «Статусы»).
     *
     * Дата ОМ — своя на прогон: ключ уведомления «одно на день».
     */
    const bossPassword = process.env.ACCESS_MATRIX_PASSWORD ?? ''
    test.skip(bossPassword === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')

    const token = await apiToken()
    const day = new Date(Date.UTC(2027, 3, 1) + (Math.floor(Date.now() / 1000) % 300) * 86_400_000)
    const businessDate = day.toISOString().slice(0, 10)
    const fixture = await createDepartmentAllocationFixture(token, { businessDate })

    try {
      await signIn(page)
      await page.goto(`${APP}/employees?view=forces`)
      const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      const event = await apiCall(token, 'GET', `/api/ops/security-events/${fixture.eventId}/`)
      await page
        .getByRole('button', { name: new RegExp(`^Открыть заявку ${event.code} `) })
        .click()

      const splitSection = page.locator('section[aria-labelledby="split-heading"]')
      // Раскладка — Первому управлению (у него есть начальник на стенде).
      const firstInput = splitSection.locator('tr', { hasText: 'Первое управление' }).locator('input')
      await expect(firstInput).toBeVisible({ timeout: 20_000 })
      await firstInput.fill('1')
      await splitSection.getByRole('button', { name: 'Сохранить раскладку' }).click()
      await expect(splitSection.getByText('Набрано 1 из', { exact: false })).toBeVisible({ timeout: 15_000 })
      await splitSection.getByRole('button', { name: 'Отправить в управления' }).click()
      await expect(splitSection.getByText('Запрошено', { exact: false }).first()).toBeVisible({ timeout: 15_000 })

      // Сервер: у начальника управления — запрос об ЭТОЙ заявке.
      const bossToken = (
        (await (
          await fetch(`${API}/api/token/`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'acc_dir_head', password: bossPassword }),
          })
        ).json()) as { access: string }
      ).access
      const feedOf = async () =>
        (await (
          await fetch(`${API}/api/operations/notifications/?unread=true`, {
            headers: { Authorization: `Bearer ${bossToken}` },
          })
        ).json()) as { results: { id: number; kind: string; payload: { allocationId?: string; need?: number } }[] }
      await expect
        .poll(
          async () =>
            (await feedOf()).results.some(
              (r) => r.kind === 'FORCES_REQUEST' && r.payload.allocationId === fixture.allocationId,
            ),
          { timeout: 15_000 },
        )
        .toBe(true)

      // Экран начальника: колокольчик называет цифру и ведёт в «Статусы».
      const ctx = await page.context().browser()!.newContext()
      const boss = await ctx.newPage()
      const csrf = (await (await ctx.request.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
      await ctx.request.post(`${APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: csrf.csrfToken, username: 'acc_dir_head', password: bossPassword, json: 'true' },
      })
      await boss.goto(`${APP}/dashboard`)
      await boss.getByRole('button', { name: 'Уведомления' }).click()
      const item = boss.getByRole('menu').getByText(`Выделите 1 сотрудников на ${event.code}`, { exact: false })
      await expect(item).toBeVisible({ timeout: 15_000 })
      await item.click()
      await expect(boss).toHaveURL(new RegExp(`/statuses/\\?forcesRequest=`), { timeout: 15_000 })

      // Уборка ленты: своё уведомление отмечено прочитанным.
      for (const row of (await feedOf()).results.filter((r) => r.payload.allocationId === fixture.allocationId)) {
        await fetch(`${API}/api/operations/notifications/${row.id}/read/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bossToken}` },
        })
      }
      await ctx.close()
    } finally {
      await dropEvent(token, fixture.eventId)
    }
  })

  test('ссылка запроса открывает «Статусы» с баннером «Запрос на ОМ-…: выделено X из Y» (Plane №394)', async ({
    page,
  }) => {
    /**
     * `[СБС-30]`: «Отдельной страницы нет — работает в „Статусы сотрудников“.
     * Уведомление … открывает таблицу с фильтром своего управления и
     * баннером „Запрос на ОМ-…: выделено 1 из 2“». До правки баннера не было
     * (`grep` — 0), и ссылка приводила бы на обычную таблицу.
     *
     * Проба НЕ ждёт уведомления: баннер живёт по адресу
     * `?forcesRequest=<allocationId>`, и его достаточно раскладки — так
     * баннер проверяется отдельно от рассылки (№392), и обе пробы падают
     * каждая на своём. Читает `acc_dir_head` (область — «Первое управление»);
     * чужому управлению баннер отвечает словами «не найден».
     */
    const bossPassword = process.env.ACCESS_MATRIX_PASSWORD ?? ''
    test.skip(bossPassword === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')

    const token = await apiToken()
    const fixture = await createDepartmentAllocationFixture(token)
    try {
      const divisions = (await apiCall(token, 'GET', '/api/core/divisions/?page_size=200')) as {
        results: { id: number; name: string; parent: number | null }[]
      }
      const first = divisions.results.find(
        (d) => d.name === 'Первое управление' && String(d.parent) === fixture.departmentId,
      )!
      const split = await apiCall(
        token,
        'POST',
        `/api/ops/security-events/${fixture.eventId}/forces/allocation/${fixture.allocationId}/split/`,
        { rows: [{ divisionId: String(first.id), need: 2 }] },
      )
      expect(split.error_code, 'раскладка не сохранилась').toBeUndefined()
      const event = await apiCall(token, 'GET', `/api/ops/security-events/${fixture.eventId}/`)

      const api = page.context().request
      const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
      await api.post(`${APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: csrf.csrfToken, username: 'acc_dir_head', password: bossPassword, json: 'true' },
      })
      await page.goto(`${APP}/statuses/?forcesRequest=${encodeURIComponent(fixture.allocationId)}`)

      const banner = page.getByRole('status', { name: `Запрос на ${event.code}` })
      await expect(banner).toBeVisible({ timeout: 30_000 })
      await expect(banner.getByText('выделено 0 из 2', { exact: false })).toBeVisible()
      await expect(banner.getByText('Первое управление', { exact: false })).toBeVisible()

      // Чужая/снятая заявка — словами, а не пустотой.
      await page.goto(`${APP}/statuses/?forcesRequest=force-allocation-nope`)
      await expect(page.getByText('Запрос на сбор сил по ссылке не найден', { exact: false })).toBeVisible({
        timeout: 30_000,
      })
    } finally {
      await dropEvent(token, fixture.eventId)
    }
  })

  test('чекбоксы на «Статусах» + «Выделить на ОМ» ставят «Участие в ОМ» из запроса (Plane №395)', async ({
    page,
  }) => {
    /**
     * `[СБС-31]`: «Начальник отмечает сотрудников чекбоксами. Статус „Участие
     * в ОМ“ создаётся автоматически с мероприятием и датами из запроса. Поле
     * „мероприятие“ он не выбирает и не видит». До правки статус ставился
     * диалогом с ручным выбором мероприятия, а реестр начальнику отвечал 403.
     *
     * Проба: раскладка Первому управлению → `acc_dir_head` открывает баннер
     * → отмечает СВОЕГО сотрудника чекбоксом в таблице → «Выделить на
     * ОМ-…: 1» → баннер «выделено 1 из 2», а в заявке (API) человек числится
     * выделенным. Дата ОМ — своя на прогон: у сотрудника не должно быть
     * пересечения статусов с прошлыми прогонами.
     */
    const bossPassword = process.env.ACCESS_MATRIX_PASSWORD ?? ''
    test.skip(bossPassword === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')

    const token = await apiToken()
    const day = new Date(Date.UTC(2027, 5, 1) + (Math.floor(Date.now() / 1000) % 300) * 86_400_000)
    const fixture = await createDepartmentAllocationFixture(token, {
      businessDate: day.toISOString().slice(0, 10),
    })
    try {
      const divisions = (await apiCall(token, 'GET', '/api/core/divisions/?page_size=200')) as {
        results: { id: number; name: string; parent: number | null }[]
      }
      const first = divisions.results.find(
        (d) => d.name === 'Первое управление' && String(d.parent) === fixture.departmentId,
      )!
      await apiCall(
        token,
        'POST',
        `/api/ops/security-events/${fixture.eventId}/forces/allocation/${fixture.allocationId}/split/`,
        { rows: [{ divisionId: String(first.id), need: 2 }] },
      )
      const event = await apiCall(token, 'GET', `/api/ops/security-events/${fixture.eventId}/`)

      const api = page.context().request
      const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
      await api.post(`${APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: csrf.csrfToken, username: 'acc_dir_head', password: bossPassword, json: 'true' },
      })
      await page.goto(`${APP}/statuses/?forcesRequest=${encodeURIComponent(fixture.allocationId)}`)
      const banner = page.getByRole('status', { name: `Запрос на ${event.code}` })
      await expect(banner).toBeVisible({ timeout: 30_000 })
      // Без отметок кнопка выключена и говорит, что делать.
      await expect(banner.getByRole('button', { name: /Отметьте сотрудников/ })).toBeDisabled()

      // Свой сотрудник — чекбокс в строке таблицы. «Токтаров А.» — учётка
      // `acc_employee`, штатно в Первом управлении.
      const row = page.locator('tbody tr', { hasText: 'Токтаров' }).first()
      await expect(row).toBeVisible({ timeout: 30_000 })
      await row.getByRole('checkbox').check()
      const select = banner.getByRole('button', { name: `Выделить на ${event.code}: 1` })
      await expect(select).toBeEnabled()
      await select.click()

      await expect(banner.getByText('Выделено:', { exact: false })).toBeVisible({ timeout: 15_000 })
      await expect(banner.getByText('выделено 1 из 2', { exact: false })).toBeVisible({ timeout: 15_000 })

      // Сервер: человек в заявке, статус — от мероприятия.
      const fresh = await apiCall(token, 'GET', `/api/ops/security-events/${fixture.eventId}/`)
      const members = (fresh.forceAllocation as { members: { name: string; statusId: string }[] }[])[0].members
      expect(members.map((m) => m.name)).toContain('Токтаров А.')
      expect(members[0].statusId, 'статус привлечения не поставлен').toBeTruthy()
    } finally {
      await dropEvent(token, fixture.eventId)
    }
  })
})
