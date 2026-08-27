/**
 * Экран «Подразделения» (`/organization`) — ЖИВОЙ стенд.
 *
 * До правки экран показывал только ИТОГ по зоне видимости, хотя ручка
 * статистики отдаёт ещё три массива с разрезом по департаментам, управлениям и
 * отделам — страница их выбрасывала. Рядом жили три вещи, которые врали:
 *
 * 1. под живым числом занятых стояла подпись «+12 за последний месяц» —
 *    прироста ручка не считает вовсе;
 * 2. бейдж «Обновлено: <сегодня>» печатал `new Date()` прямо в разметке: дата
 *    была сегодняшней всегда и о свежести данных не говорила ничего;
 * 3. строка поиска на странице не имела ни состояния, ни обработчика, ни
 *    доступа к дереву — набранное в ней не делало НИЧЕГО;
 * 4. подпись «Фокус: …» печатала имя КОРНЯ при любом выбранном узле.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface Counts {
  staff_units_count: number
  employees_count: number
  vacancies_count: number
}

interface Statistics {
  summary: Counts
  departments: (Counts & { department_name: string })[]
  directorates: (Counts & { directorate_name: string })[]
  divisions: (Counts & { division_name: string })[]
}

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

async function statistics(): Promise<Statistics> {
  const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
  const res = await fetch(`${API}/api/staff_unit/statistics/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as Statistics
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

/** Строка разреза по подписи подразделения: [уровень, штат, занято, вакансий]. */
async function breakdownRow(page: Page, name: string): Promise<string[]> {
  return page.evaluate((unit) => {
    const table = document.querySelector('table')
    if (table === null) return []
    const row = [...table.querySelectorAll('tbody tr')].find(
      // Только ПЕРВАЯ строка ячейки: с 27.08.2026 под именем стоит путь до
      // подразделения (Plane №214), и сравнение всего текста ячейки перестало
      // находить строку.
      (tr) =>
        ((tr.children[0] as HTMLElement)?.innerText ?? '').split('\n')[0].trim() === unit,
    )
    if (row === undefined) return []
    return [...row.children].slice(1).map((cell) => (cell.textContent ?? '').trim())
  }, name)
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'подразделения: разрез и поиск' : 'подразделения (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('разрез по подразделениям совпадает с ответом ручки', async ({ page }) => {
    /**
     * 🔴 На стенде у ДВУХ отделов числа совпадают (6/5/1), поэтому ассерт
     * «в таблице есть строка с такими числами» неотличим от «взяли не тот
     * отдел». Сверяем ПОИМЕННО: строка ищется по названию подразделения, и
     * дополнительно требуется, чтобы уровни различались числами — иначе
     * перепутанные местами массивы дали бы тот же экран.
     */
    const stats = await statistics()
    expect(stats.divisions.length, 'на стенде нет отделов — проба вакуумна').toBeGreaterThan(1)
    expect(stats.directorates.length, 'на стенде нет управлений').toBeGreaterThan(0)

    const directorate = stats.directorates[0]
    const division = stats.divisions[0]
    expect(
      directorate.staff_units_count,
      'штат управления равен штату отдела — уровни не различить',
    ).not.toBe(division.staff_units_count)

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/organization')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    for (const [name, level, counts] of [
      [stats.departments[0].department_name, 'Департамент', stats.departments[0]],
      [directorate.directorate_name, 'Управление', directorate],
      [division.division_name, 'Отдел', division],
      [stats.divisions[1].division_name, 'Отдел', stats.divisions[1]],
    ] as [string, string, Counts][]) {
      const row = await breakdownRow(page, name)
      expect(row, `строки «${name}» нет в разрезе`).not.toHaveLength(0)
      expect(row).toEqual([
        level,
        String(counts.staff_units_count),
        String(counts.employees_count),
        String(counts.vacancies_count),
      ])
    }
  })

  test('плитка «Занято» не приписывает несуществующий прирост', async ({ page }) => {
    const stats = await statistics()

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/organization')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    const body = (await page.locator('main').textContent()) ?? ''
    expect(body, 'вернулась выдуманная строка прироста').not.toContain('за последний месяц')
    // Гвард против вакуума: число под плиткой РЕАЛЬНО стоит на экране, иначе
    // ассерт выше зеленел бы и на пустой странице.
    expect(body).toContain(String(stats.summary.employees_count))
    expect(body).toContain('Занятых штатных единиц')

    // Бейджа «Обновлено: <сегодня>» больше нет: он печатал `new Date()` и
    // говорил о свежести то, чего ручка не сообщает.
    const today = new Date().toLocaleDateString('ru-RU')
    expect(body).not.toContain(`Обновлено: ${today}`)
  })

  test('поиск наводит дерево на найденное подразделение', async ({ page }) => {
    /**
     * 🔴 Ассерт «после ввода что-то нашлось» вакуумен: он зеленеет и на
     * подсказке, которая ничего не делает. Проверяется ПОСЛЕДСТВИЕ клика —
     * подпись фокуса становится именем найденного узла. Прежняя подпись
     * печатала имя КОРНЯ при любом выборе, поэтому она эту пробу не прошла бы.
     *
     * 🔴 Фикстуру нельзя брать первой попавшейся: одно из подразделений стенда
     * ОКАЗЫВАЕТСЯ корнем дерева, а на корне подпись фокуса не меняется по
     * определению — проба молча проверяла бы «ничего не произошло». Поэтому
     * перебираются все подразделения и требуется, чтобы хотя бы одно навелось.
     */
    const stats = await statistics()
    const names = stats.divisions.map((item) => item.division_name)
    expect(names.length, 'на стенде нет отделов — проба вакуумна').toBeGreaterThan(1)

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/organization')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    await expect(page.getByText('Кликните на подразделение для фокуса')).toBeVisible()

    const search = page.getByLabel('Поиск по структуре организации')
    await search.fill('заведомо-нет-такого')
    await expect(page.getByText('Ничего не найдено')).toBeVisible()

    let focused: string | null = null
    for (const name of names) {
      await search.fill(name)
      const hit = page.getByRole('button', { name: new RegExp(`^${name} — `) }).first()
      await expect(hit, `поиск не нашёл «${name}»`).toBeVisible()
      await hit.click()
      await expect(search).toHaveValue('')

      const label = page.getByText(/^Фокус: /)
      if ((await label.count()) > 0) {
        await expect(label).toHaveText(`Фокус: ${name}`)
        focused = name
        break
      }
    }

    expect(
      focused,
      'ни одно подразделение не навело фокус — подпись снова не следит за выбором',
    ).not.toBeNull()
  })

  test('подразделение — ОДИН узел дерева, а не карточка на каждую ставку', async ({ page }) => {
    /**
     * Дерево строилось по штатным единицам, но каждый узел подписывался именем
     * своего ПОДРАЗДЕЛЕНИЯ: отдел из пяти ставок рисовался пятью карточками с
     * одинаковым заголовком, по одному человеку в каждой.
     *
     * 🔴 Гвард против вакуума: у выбранного подразделения должно быть БОЛЬШЕ
     * ОДНОЙ штатной единицы. На отделе с единственной ставкой «ровно один
     * узел» выполнялось бы и до правки.
     */
    const stats = await statistics()
    const crowded = stats.divisions.find((item) => item.staff_units_count > 1)
    expect(
      crowded,
      'нет подразделения больше чем с одной ставкой — дублирование не на чем проверить',
    ).toBeTruthy()

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/organization')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })
    await page.getByRole('button', { name: 'Развернуть все' }).click()

    const titles = await page.evaluate(() =>
      [...document.querySelectorAll('h3')].map((node) => (node.textContent ?? '').trim()),
    )
    const repeats = titles.filter((title) => title === crowded!.division_name)
    expect(repeats.length, `«${crowded!.division_name}» нарисован ${repeats.length} раз`).toBe(1)

    // Обратная сторона: люди подразделения не потерялись при склейке. Один из
    // них — руководитель узла, поэтому в списке «Сотрудники» на одного меньше.
    //
    // Карточка берётся ОТ СВОЕГО заголовка вверх по разметке (h3 → строка
    // шапки → тело карточки): ассерт по «где-то на странице есть Сотрудники
    // (4)» не отличил бы свою карточку от соседней.
    const cardText = await page.evaluate((name) => {
      const heading = [...document.querySelectorAll('h3')].find(
        (node) => (node.textContent ?? '').trim() === name,
      )
      return heading?.parentElement?.parentElement?.parentElement?.textContent ?? ''
    }, crowded!.division_name)

    expect(cardText, 'карточка подразделения не найдена').not.toBe('')
    expect(cardText).toContain(`Сотрудники (${crowded!.employees_count - 1})`)

    // 🔴 Вакансии обязаны ПЕРЕЖИТЬ склейку. Пока узлом была одна штатная
    // единица, вакансия оказывалась «руководителем» своей карточки и была
    // видна; собранная в общий список, она чуть не пропала с экрана вовсе —
    // отбор `emp.employee` выбрасывал её молча. Счётчик вакансий их не
    // смешивает с людьми: пустая ставка не сотрудник.
    if (crowded!.vacancies_count > 0) {
      expect(cardText).toContain(`вакансий (${crowded!.vacancies_count})`)
    } else {
      expect(cardText).not.toContain('вакансий (')
    }
  })

  test('одноимённые подразделения различимы путём до них', async ({ page }) => {
    /**
     * 🔴 Проба стоит на ФАКТЕ СТЕНДА, а не на удобной фикстуре: имена
     * подразделений уникальны только внутри родителя, и на реальной структуре
     * «Первое управление» есть в каждом департаменте. Пока таблица печатала
     * одно имя, девять одинаковых строк «Первый отдел» различить было нечем —
     * а таблица нужна ровно затем, чтобы ответить «в каком отделе недобор»
     * (Plane №214).
     *
     * Сторож против вакуумности здесь обязателен: на стенде без повторов имён
     * проба зазеленела бы, ничего не проверив.
     */
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/organization')
    await hydrated(page)
    // Таблица появляется после ответа ручки статистики: без ожидания сторож
    // вакуумности срабатывает на пустой странице, а не на пустом разрезе.
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })

    const cells = await page.evaluate(() =>
      [...document.querySelectorAll('table tbody tr')].map((row) => {
        const cell = row.children[0] as HTMLElement
        const lines = (cell.innerText ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
        return { name: lines[0] ?? '', path: lines[1] ?? '' }
      }),
    )
    expect(cells.length, 'разрез пуст — проба вакуумна').toBeGreaterThan(2)

    const byName = new Map<string, string[]>()
    for (const cell of cells) {
      byName.set(cell.name, [...(byName.get(cell.name) ?? []), cell.path])
    }
    const repeated = [...byName.entries()].filter(([, paths]) => paths.length > 1)
    expect(
      repeated.length,
      'на стенде нет ни одного повторяющегося имени — различать нечего, проба вакуумна',
    ).toBeGreaterThan(0)

    for (const [name, paths] of repeated) {
      expect(new Set(paths).size, `строки «${name}» неразличимы: пути ${paths.join(' / ')}`).toBe(
        paths.length,
      )
    }
  })
})
