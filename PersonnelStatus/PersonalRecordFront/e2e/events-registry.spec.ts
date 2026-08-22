/**
 * Реестр ОМ на ЖИВОМ стенде: фильтры периода и ответственного, и карточка ОМ
 * как хаб — перекрёстные переходы к объекту, сводке ГВО и «Сбору сил на ОМ».
 *
 * Проба фильтров отвечает на один вопрос: фильтры сужают выборку НА СЕРВЕРЕ, а
 * не по загруженной странице. Разница принципиальна — фильтр по странице
 * отвечал бы «ничего не найдено» там, где записи есть на следующей.
 *
 * Пробы ссылок отвечают на другой вопрос: ссылка ведёт на ТУ запись, которую
 * реально несёт карточка, а не на первую попавшуюся. Для объекта поэтому
 * берётся ОМ, чей objectId отличается от самого частого в выборке —
 * иначе баг «ссылка всегда на первый/самый частый объект» остался бы
 * незамеченным (событие с частым объектом привело бы туда же по случайности).
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

interface EventRow {
  id: string
  code: string
  stage: string
  objectId: string | null
  objectName: string
}

async function events(token: string, stage = ''): Promise<EventRow[]> {
  const query = `page_size=200${stage === '' ? '' : `&stage=${stage}`}`
  const res = await fetch(`${API}/api/ops/security-events/?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

/** ОМ, чей объект НЕ самый частый в выборке — см. заголовок файла. */
function pickDistinctObjectEvent(rows: EventRow[]): EventRow | undefined {
  const withObject = rows.filter((r) => r.objectId !== null)
  const counts = new Map<string, number>()
  for (const r of withObject) {
    counts.set(r.objectId as string, (counts.get(r.objectId as string) ?? 0) + 1)
  }
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return withObject.find((r) => r.objectId !== mode) ?? withObject[0]
}

async function objectName(token: string, objectId: string): Promise<string> {
  const res = await fetch(`${API}/api/ops/objects/${objectId}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { name: string }).name
}

test.describe(LIVE ? 'реестр ОМ' : 'реестр ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('период и ответственный фильтруют на сервере', async ({ page }) => {
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}` }
    const all = (await (
      await fetch(`${API}/api/ops/security-events/?page_size=200`, { headers })
    ).json()) as { count: number; owners: string[]; results: { businessDate: string }[] }
    expect(all.owners.length, 'нужен хотя бы один ответственный').toBeGreaterThan(0)

    const dates = [...new Set(all.results.map((e) => e.businessDate))].sort()
    const cut = dates[dates.length - 1]
    const expected = (await (
      await fetch(`${API}/api/ops/security-events/?from=${cut}&page_size=200`, { headers })
    ).json()) as { count: number }
    expect(expected.count, 'фикстура не различает период').toBeLessThan(all.count)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
      timeout: 15_000,
    })

    // Полоса готовности из прототипа
    await expect(page.getByRole('progressbar').first()).toBeVisible()

    // Фильтр периода: число строк совпадает с ответом сервера на тот же запрос
    await page.getByLabel('Период с').fill(cut)
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 15_000 })
      .toBe(Math.min(expected.count, 20))

    // Фильтр по ответственному предлагает значения, посчитанные сервером
    const owner = all.owners[0]
    const select = page.getByLabel('Ответственный')
    await expect(select.locator('option', { hasText: owner })).toHaveCount(1)
  })

  test('карточка ОМ: ссылка на объект ведёт на его паспорт', async ({ page }) => {
    const token = await apiToken()
    const rows = await events(token)
    const target = pickDistinctObjectEvent(rows)
    expect(target, 'на стенде нет ни одного ОМ с привязанным объектом').toBeDefined()
    const expectedName = await objectName(token, target!.objectId as string)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    // Скоуп — контент, а не боковое меню: там уже есть пункт «Объекты и
    // паспорта», и без скоупа локатор ловит оба.
    const link = page.getByRole('main').getByRole('link', { name: /объект/i })
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()

    await expect(page).toHaveURL(/\/security-ops\/objects\//)
    await expect(page).toHaveURL(new RegExp(`/security-ops/objects/${target!.objectId}/?$`))
    await expect(
      page.getByRole('heading', { name: expectedName }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('карточка ОМ: ссылка на сводку ГВО открывает сводку этого ОМ', async ({ page }) => {
    const token = await apiToken()
    const rows = await events(token)
    // Стадия НЕ «Бюллетень» намеренно: там своя ссылка на сводку уже стоит
    // внутри блока «Сведения об ОМ» с 21.08 — эта проба стережёт ссылку,
    // видимую на карточке ОБЩО, вне зависимости от активного этапа.
    const target = rows.find((r) => r.stage !== 'BULLETIN')
    expect(target, 'на стенде нет ни одного ОМ вне стадии «Бюллетень»').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const link = page.getByRole('main').getByRole('link', { name: /сводк.*гво/i })
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()

    await expect(page).toHaveURL(new RegExp(`/security-ops/gvo/${target!.id}/?$`))
    await expect(
      page.getByRole('heading', { name: 'Сводные данные' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(target!.code)).toBeVisible()
  })

  test('колонки таблицы и календарь — по прототипу', async ({ page }) => {
    const token = await apiToken()
    const rows = await events(token)
    expect(rows.length, 'реестр пуст — проба вакуумна').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
      timeout: 20_000,
    })

    // Состав и ПОРЯДОК колонок пинятся литерально: перестановка — это другая
    // таблица, а не другой стиль. «Конфликтов» отдельной колонкой быть не
    // должно — сигнал переехал бейджем в «Этап и готовность».
    // Ждём саму таблицу: до ответа сервера на экране стоит «Загрузка реестра…»,
    // и снимок заголовков дал бы пустой список — ассерт прошёл бы мимо.
    // Локатор по разметке, а не по роли: снимок страницы показывает, что
    // Playwright читает эти <th> как cell, и getByRole('columnheader') их не
    // находит вовсе — ассерт был бы вечнозелёным на пустом массиве.
    const headCells = page.locator('thead th')
    await expect(headCells.first()).toBeVisible({ timeout: 20_000 })
    const headers = await headCells.allInnerTexts()
    expect(headers.map((h) => h.trim()).filter((h) => h !== '')).toEqual([
      'ОМ',
      'Даты',
      'Локация',
      'Этап и готовность',
      'Потребность',
      'Ответственный',
      // Последняя колонка — стрелка перехода; её заголовок скрыт визуально,
      // но для скринридера подписан, и в текстовом снимке он есть.
      'Действия',
    ])

    // Календарь мероприятий: второй режим экрана из прототипа. Открывается на
    // месяце, где мероприятия ЕСТЬ, — пустая сетка вместо отобранных записей
    // была бы худшим исходом, чем отсутствие режима.
    await page.getByRole('button', { name: 'Календарь' }).click()
    const calendar = page.getByText(/^Календарь мероприятий · /)
    await expect(calendar).toBeVisible({ timeout: 15_000 })
    const marks = page.locator('button[aria-label*="мероприятий"]:not([disabled])')
    expect(
      await marks.count(),
      'календарь открылся на месяце без единой отметки',
    ).toBeGreaterThan(0)

    // День с отметкой открывает СВОЙ список: у первой отметки берём число из
    // подписи и сверяем со счётчиком карточки справа.
    const label = (await marks.first().getAttribute('aria-label')) ?? ''
    const expected = Number(label.replace(/^.*мероприятий /, ''))
    expect(expected, 'подпись дня не несёт числа').toBeGreaterThan(0)
    await marks.first().click()
    // Ассерт по САМОМУ счётчику и ТОЧНЫМ текстом. Первая версия искала число
    // подстрокой во всей карточке — и была вакуумной: «1» находилась в коде
    // ОМ и в дате, красная проба с константой 999 оставалась зелёной.
    await expect(page.locator('[data-slot="events-day-count"]')).toHaveText(
      String(expected),
    )
  })

  test('этап «Запрос сил» ведёт в «Сбор сил на ОМ»', async ({ page }) => {
    const token = await apiToken()
    const forces = await events(token, 'FORCES')
    const target = forces[0]
    // Не молчаливый skip: причина явно записана в отчёте прогона.
    test.skip(target === undefined, 'на стенде нет ОМ на стадии FORCES («Запрос сил»)')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    // Скоуп — контент: в боковом меню уже есть пункт «Сбор сил на ОМ» с
    // тем же текстом, а строгий режим Playwright не терпит двух совпадений.
    const link = page.getByRole('main').getByRole('link', { name: /сбор сил/i })
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()

    await expect(page).toHaveURL(/\/employees\/?\?view=forces/)
    await expect(
      page.getByRole('heading', { name: 'Сбор сил на ОМ' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('group', { name: 'Личный состав на сбор' }),
    ).toBeVisible({ timeout: 15_000 })
  })
})
