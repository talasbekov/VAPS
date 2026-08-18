/**
 * Таблицы кадров и статусов — ЖИВОЙ стенд.
 *
 * Проба стережёт то, что обе таблицы ГОВОРЯТ ПРАВДУ, а не то, как они
 * выглядят. До правки:
 *
 * 1. ручка штатки не клала в `current_status` даты, хотя они есть в модели, —
 *    «Последнее обновление» и «Следующее обновление» печатали «Не обновлено» и
 *    «Не указано» во ВСЕХ строках, 362 px на две колонки без единого бита;
 * 2. карточка сотрудника подставляла вместо отсутствующей даты СЕГОДНЯШНЕЕ
 *    число — колонка «Дата найма» показывала одну дату у всех, а «стаж
 *    работы» обнулялся у всякого, кто ушёл в отпуск;
 * 3. подсветка просрочки не срабатывала ни разу: `isOverdue` разбирал обратно
 *    уже отформатированную строку (`new Date("14.08.2026")` → NaN).
 *
 * 🔴 Фикстура обязана содержать И просроченные статусы, И действующие — иначе
 * ассерт «просроченные отмечены» вырождается в «отмечены все» или «никто».
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface StatusBrief {
  status_type: string
  state: string
  start_date?: string | null
  end_date?: string | null
}

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

/**
 * Дождаться СТРОК, а не таблицы: шапка отрисована сразу, и проба, ждущая
 * `table`, читает пустой `tbody` и получает пустую колонку — «нет данных» и
 * «данные одинаковы» при этом выглядят одинаково.
 */
async function tableFilled(page: Page): Promise<void> {
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })
}

/** Значения колонки по её подписи в шапке. */
async function column(page: Page, head: string): Promise<string[]> {
  return page.evaluate((name) => {
    const table = document.querySelector('table')
    if (table === null) return []
    const heads = [...table.querySelectorAll('thead th')]
    const index = heads.findIndex((th) => th.textContent?.trim() === name)
    if (index === -1) return []
    return [...table.querySelectorAll('tbody tr')].map((row) =>
      (row.children[index]?.textContent ?? '').trim(),
    )
  }, head)
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'таблицы: правда в колонках' : 'таблицы (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('период статуса доезжает с бэка до обеих таблиц', async ({ page }) => {
    // Сверяемся с ответом сервера, а не с числами в коде: «сегодня» плавает.
    const token = await tokenFor('admin', 'admin123')
    const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await raw.json()) as {
      staff_units: { employee: { current_status: StatusBrief | null } | null }[]
    }
    const statuses = body.staff_units
      .map((unit) => unit.employee?.current_status)
      .filter((status): status is StatusBrief => status !== undefined && status !== null)

    expect(statuses.length, 'на стенде нет ни одного статуса — проба вакуумна').toBeGreaterThan(0)
    // Ручка собирает current_status литеральным словарём; даты в него не
    // клали, и обе колонки печатали константу.
    const withStart = statuses.filter((s) => typeof s.start_date === 'string' && s.start_date !== '')
    expect(withStart.length, 'ручка штатки не отдаёт start_date — колонки нечем наполнить').toBe(
      statuses.length,
    )

    await signIn(page, 'admin', 'admin123')
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    const since = await column(page, 'Последнее обновление')
    const until = await column(page, 'Следующее обновление')
    expect(since.length).toBeGreaterThan(0)
    // Ключевой ассерт: колонка РАЗЛИЧАЕТ строки. Одно значение на всю таблицу
    // — ровно то состояние, из которого её вытаскивали.
    expect(new Set(since).size, `«Последнее обновление» одинаково во всех строках: ${since[0]}`)
      .toBeGreaterThan(1)
    expect(new Set(until).size, `«Следующее обновление» одинаково во всех строках: ${until[0]}`)
      .toBeGreaterThan(1)
    // Даты — без времени: `toLocaleString` дописывал «, 00:00:00» у поля,
    // у которого времени нет.
    expect(since.join(' ')).not.toContain('00:00:00')
  })

  test('просроченные статусы отмечены, действующие — нет', async ({ page }) => {
    await signIn(page, 'admin', 'admin123')
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    const marks = await page.evaluate(() => {
      const table = document.querySelector('table')
      if (table === null) return []
      const heads = [...table.querySelectorAll('thead th')]
      const index = heads.findIndex((th) => th.textContent?.trim() === 'Следующее обновление')
      return [...table.querySelectorAll('tbody tr')].map((row) => ({
        text: (row.children[index]?.textContent ?? '').trim(),
        marked: getComputedStyle(row).backgroundColor === 'rgb(254, 242, 242)',
      }))
    })

    const dated = marks.filter((row) => /^\d{2}\.\d{2}\.\d{4}$/.test(row.text))
    expect(dated.length, 'ни одной строки с датой окончания — проба вакуумна').toBeGreaterThan(0)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const overdue = dated.filter((row) => {
      const [day, month, year] = row.text.split('.').map(Number)
      return new Date(year, month - 1, day) < today
    })
    const actual = dated.filter((row) => !overdue.includes(row))

    // 🔴 Обе стороны обязаны быть непустыми: на одних просроченных ассерт
    // «отмечены просроченные» неотличим от «отмечены все».
    expect(overdue.length, 'нет просроченных статусов — отметку не на чем проверить').toBeGreaterThan(0)
    expect(actual.length, 'нет действующих статусов — отметка неотличима от «всегда»').toBeGreaterThan(0)

    expect(overdue.every((row) => row.marked), 'просроченная строка не отмечена').toBe(true)
    expect(actual.some((row) => row.marked), 'действующая строка отмечена как просроченная').toBe(false)
  })

  test('кадровая таблица не выдаёт сегодняшнее число за дату у всех', async ({ page }) => {
    await signIn(page, 'admin', 'admin123')
    await page.goto('/employees')
    await hydrated(page)
    await tableFilled(page)

    const values = await column(page, 'Статус с')
    expect(values.length, 'таблица сотрудников пуста — проба вакуумна').toBeGreaterThan(1)

    // Колонка звалась «Дата найма», а несла начало текущего статуса с
    // фолбэком `new Date()`: у всех строк стояло сегодняшнее число.
    const todayRu = new Date().toLocaleDateString('ru-RU')
    expect(
      values.every((value) => value === todayRu),
      `все строки показывают сегодняшнюю дату (${todayRu}) — вернулся фолбэк «сегодня»`,
    ).toBe(false)
    expect(new Set(values).size, 'колонка одинакова во всех строках').toBeGreaterThan(1)

    // Колонки «Контакты» нет: телефон и почту эта ручка не отдаёт вовсе, а
    // подпись поля с пустым значением читается как «не заполнено».
    const heads = await page.evaluate(() =>
      [...document.querySelectorAll('table thead th')].map((th) => th.textContent?.trim() ?? ''),
    )
    expect(heads).not.toContain('Контакты')
    expect(heads).not.toContain('Дата найма')
  })
})
