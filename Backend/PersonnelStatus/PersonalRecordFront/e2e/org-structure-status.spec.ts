/**
 * Оргструктура не выдаёт отсутствие статуса за «В строю» — ЖИВОЙ стенд.
 *
 * Фолбэк `current_status?.status_type || "in_service"` стоял в шести местах
 * (`lib/api.ts` дважды, `OrgChart` четырежды, `OrgBoard` дважды) и врал тем
 * заметнее, чем меньше данных:
 *
 * * вакантная должность получала `status: "in_service"` ЛИТЕРАЛОМ и светилась
 *   зелёной точкой наравне с работающим человеком;
 *
 * * сотрудник без статуса подписывался «В строю».
 *
 * Два разных случая «нет статуса», и они приходят РАЗНЫМИ ветками кода:
 *
 * 1. вакансия — `headEmployee` есть, но `headEmployee.employee` пуст. Достижима
 *    на данных стенда;
 * 2. узел без единой записи о людях — `headEmployee` нет вовсе. На стенде
 *    недостижима (адаптер оставляет `employees` пустым только у строки без
 *    должности И без сотрудника, таких в базе нет), поэтому строка для неё
 *    добавляется перехватом.
 *
 * Третья проба — обратная: убрав фолбэк, легко потерять и настоящие статусы.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

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

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'оргструктура: статус' : 'оргструктура (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('вакантная должность не подписана «В строю» и не светится зелёным', async ({ page }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/organization')
    await hydrated(page)

    // Ждём отрисовки дерева, а не просто загрузки страницы.
    await expect(page.getByText('Вакантная должность').first()).toBeVisible({ timeout: 25_000 })

    const vacancies = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('*')].filter(
        (element) =>
          element.children.length === 0 &&
          element.textContent?.trim() === 'Вакантная должность',
      )
      return nodes.map((node) => {
        // Карточка узла: поднимаемся, пока не найдём блок с точкой-индикатором.
        let card: Element | null = node
        for (let step = 0; step < 6 && card !== null; step += 1) {
          const dot = card.querySelector('.rounded-full.border-2')
          if (dot !== null) {
            return {
              dotClass: dot.className,
              text: (card.textContent ?? '').replace(/\s+/g, ' ').trim(),
            }
          }
          card = card.parentElement
        }
        return { dotClass: '', text: (node.textContent ?? '').trim() }
      })
    })

    expect(vacancies.length, 'на стенде нет вакансий — проба вакуумна').toBeGreaterThan(0)

    for (const vacancy of vacancies) {
      // 🔴 Ключевое: «В строю» рядом с вакансией — это вернувшийся фолбэк.
      expect(vacancy.text, `вакансия подписана статусом: ${vacancy.text}`).not.toContain(
        'В строю',
      )
      // Зелёная точка — тот же фолбэк, только цветом.
      expect(
        vacancy.dotClass,
        `точка вакансии зелёная (${vacancy.dotClass}) — статус выдуман`,
      ).not.toContain('bg-green')
    }
  })

  test('сотрудник с настоящим статусом по-прежнему им подписан', async ({ page }) => {
    // Обратная сторона: убрав фолбэк, легко потерять и настоящие статусы.
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/organization')
    await hydrated(page)
    await expect(page.getByText('Вакантная должность').first()).toBeVisible({ timeout: 25_000 })

    const painted = await page.evaluate(() => {
      const dots = [...document.querySelectorAll('.rounded-full.border-2')]
      return dots.filter((dot) => !dot.className.includes('bg-gray')).length
    })
    expect(painted, 'ни одной цветной точки — статусы потерялись вовсе').toBeGreaterThan(0)
  })

  test('узел без единой записи о людях: «Вакантная должность» без статуса', async ({ page }) => {
    /**
     * Ветка `convertStaffUnitToOrgUnit`, где `headEmployee` отсутствует
     * ВОВСЕ — `staffUnit.employees` пуст. Раньше она подставляла
     * `status: "in_service"` ЛИТЕРАЛОМ.
     *
     * 🔴 На данных стенда эта ветка не исполняется: адаптер `getStaffUnits`
     * оставляет `employees` пустым только у строки БЕЗ должности И без
     * сотрудника, а таких единиц в базе нет. Именно поэтому первая красная
     * проба этой правки прошла зелёной — мутация ложилась на код, который
     * не работает. Строка добавляется перехватом, чтобы ветка исполнилась
     * по-настоящему, в браузере.
     */
    const MARK = 'Пустой узел (проба)'

    await page.route(
      (url) =>
        url.pathname.includes('/api/staff_unit/staff-units') &&
        !url.pathname.includes('directorate'),
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          results?: Record<string, unknown>[]
        }
        const rows = body.results ?? []
        const first = rows[0]
        if (first !== undefined) {
          rows.push({
            ...first,
            id: 999001,
            parent_id: first.id,
            division: {
              ...(first.division as Record<string, unknown>),
              id: 999001,
              name: MARK,
            },
            // Ни должности, ни сотрудника — адаптер отдаст пустой employees,
            // и конвертер уйдёт в ветку «headEmployee нет».
            position: null,
            employee: null,
            vacancy: null,
          })
        }
        await route.fulfill({ response, json: { ...body, results: rows } })
      },
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/organization')
    await hydrated(page)

    const node = page.getByText(MARK).first()
    await expect(node, 'подменённый узел не отрисовался — ветка не исполнилась').toBeVisible({
      timeout: 25_000,
    })

    const card = await page.evaluate((mark) => {
      const leaf = [...document.querySelectorAll('*')].find(
        (element) =>
          element.children.length === 0 && element.textContent?.trim() === mark,
      )
      let current: Element | null = leaf ?? null
      for (let step = 0; step < 8 && current !== null; step += 1) {
        const dot = current.querySelector('.rounded-full.border-2')
        if (dot !== null) {
          return {
            dotClass: dot.className,
            text: (current.textContent ?? '').replace(/\s+/g, ' ').trim(),
          }
        }
        current = current.parentElement
      }
      return null
    }, MARK)

    expect(card, 'у подменённого узла нет карточки с точкой').not.toBeNull()
    // Гвард против вакуума: это должна быть именно ветка «нет headEmployee».
    expect(card!.text).toContain('Вакантная должность')
    expect(card!.text, `узлу без людей приписан статус: ${card!.text}`).not.toContain(
      'В строю',
    )
    expect(card!.dotClass, 'точка узла без людей зелёная — статус выдуман').not.toContain(
      'bg-green',
    )
  })
})
