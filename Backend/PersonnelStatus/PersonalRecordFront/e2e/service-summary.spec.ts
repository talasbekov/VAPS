/**
 * «Свод по Службе» (Plane №992, `[РАСХ-РШ-05]`, §20.4 п.7) — ЖИВОЙ стенд.
 *
 * Рабочее место ответственного за сбор сил: видит готовность сдачи по ВСЕЙ
 * организации (не по одному департаменту, как «Свод департамента» №990),
 * может собрать и отправить свод СЛУЖБЫ, но не правит статусы сотрудников
 * и не сдаёт день за подчинённых.
 *
 * Пробы стерегут:
 * 1) экран открыт ТОЛЬКО ответственному за сбор сил — другая роль видит текст
 *    отказа, а не список департаментов;
 * 2) дерево показывает РЕАЛЬНУЮ структуру (департаменты → управления →
 *    отделы → сотрудники), а не плоский список — раскрытие листа даёт
 *    поимённый состав СО СТАТУСОМ, без единой кнопки правки;
 * 3) «Собрать свод Службы» проходит даже когда ни один департамент не
 *    собран (Plane №989/№990 сняли жёсткий гейт и на этом уровне тоже —
 *    `assemble_summary` не различает уровень дерева); «Отправить дежурному»
 *    неполного свода требует причину — тот же паттерн, что у №990;
 * 4) негативная проба API (403 дежурному на PATCH статуса) уже покрыта
 *    `test_status_update_api.py::test_duty_officer_reads_but_cannot_write_a_status`
 *    на бэкенде — здесь не дублируется.
 *
 * Дата — со СВОИМ генератором [5, 59] и проверкой свободности (тот же
 * приём, что в `department-summary.spec.ts`): корень «Служба» — общий
 * ресурс, и повторный прогон в тот же день не должен упереться в уже
 * собранный им же свод.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''

async function apiToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  expect(res.status, `учётка ${username} не получила токен`).toBe(200)
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

const ROOT_DIVISION_ID = 1

// СВОЙ генератор — та же причина, что в `department-summary.spec.ts`:
// `uniqueBusinessDate()` метит десятилетний диапазон за окном сдачи №989.
const FAR_WINDOW_START = 5
const FAR_WINDOW_DAYS = 55
const farBase = Math.floor(Math.random() * FAR_WINDOW_DAYS)
let farIssued = 0

function farDate(): string {
  const offset = FAR_WINDOW_START + ((farBase + farIssued) % FAR_WINDOW_DAYS)
  farIssued += 1
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

async function freshRootDate(adminToken: string): Promise<string> {
  for (let attempt = 0; attempt < FAR_WINDOW_DAYS; attempt += 1) {
    const date = farDate()
    const res = await fetch(
      `${API}/api/ops/daily/daily-submissions/?division_id=${ROOT_DIVISION_ID}&business_date=${date}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    )
    const body = (await res.json()) as { count: number }
    if (body.count === 0) return date
  }
  throw new Error(`не нашлось свободной даты за ${FAR_WINDOW_DAYS} попыток — окно исчерпано`)
}

test.describe(LIVE ? 'Свод по Службе' : 'Свод по Службе (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нужен ROLE_ACCOUNTS_PASSWORD')

    // Plane №1223: экран — оперативному дежурному (был — ответственному, №1115).
  test('открыт только оперативному дежурному', async ({ page }) => {
    await signIn(page, 'role_duty_officer', ROLE_PASSWORD)
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('region', { name: 'Свод по Службе', exact: true }),
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('group').first()).toBeVisible()

    await signIn(page, 'role_division_operator', ROLE_PASSWORD)
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByText('Недостаточно прав для просмотра свода по Службе.'),
    ).toBeVisible({ timeout: 25_000 })
    await expect(
      page.getByRole('region', { name: 'Свод по Службе', exact: true }),
    ).toHaveCount(0)
  })

  test('дерево показывает реальную структуру, раскрытие листа — поимённый состав без правки', async ({
    page,
  }) => {
    await signIn(page, 'role_duty_officer', ROLE_PASSWORD)
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    const region = page.getByRole('region', { name: 'Свод по Службе', exact: true })
    await expect(region).toBeVisible({ timeout: 25_000 })

    const departments = region.getByRole('list', { name: 'Департаменты' }).getByRole('group')
    await expect(departments.first()).toBeVisible()
    const firstDeptCount = await departments.count()
    expect(firstDeptCount, 'на стенде нет ни одного департамента').toBeGreaterThan(0)

    // Раскрыть первый департамент — под ним появляются его дети.
    const firstDept = departments.first()
    await firstDept.getByRole('button').first().click()

    // Спуск ГЛУБИНОЙ, а не однократным перебором соседей одного уровня:
    // реальные данные стенда смешивают на одной глубине лист («управление»
    // без вложенных отделов) и не-лист (управление С отделами) — плоский
    // перебор `[role="group"] [role="group"]` считал бы узлы всех глубин
    // сразу и упирался в гонку с асинхронной загрузкой личного состава
    // (клик разворачивает узел мгновенно, а список людей приходит позже
    // сетевым запросом — синхронная проверка счётчика сразу после клика
    // читала пустоту как «не лист», отсюда и была первая версия пробы
    // красной). Рекурсия построчно ждёт результат КАЖДОГО клика и умеет
    // свернуть неверную ветку и попробовать следующую.
    async function descendToLeaf(container: ReturnType<typeof region.locator>): Promise<boolean> {
      const children = container.locator('> [role="group"]')
      const childCount = await children.count()
      for (let i = 0; i < childCount; i += 1) {
        const candidate = children.nth(i)
        await candidate.getByRole('button').first().click()
        // Лист без сотрудников или лист с ними сначала рендерит «Загрузка
        // личного состава…» (`LeafEmployees`) — ждать нужно ЕЁ ИСЧЕЗНОВЕНИЯ,
        // а не появления первого попавшегося `<p>`: сама строка загрузки —
        // тоже `<p>`, и `.or()` на «любой параграф» удовлетворялся ЕЮ ЖЕ,
        // так и не дождавшись настоящего результата (первая правка гонки
        // накрыла только СИНХРОННУЮ версию проверки, а не эту).
        await expect(candidate.getByText('Загрузка личного состава…')).toHaveCount(0, {
          timeout: 10_000,
        })
        const peopleList = candidate.locator('> ul[role="list"]')
        if ((await peopleList.count()) > 0) {
          await expect(peopleList.getByRole('listitem').first()).toBeVisible({ timeout: 10_000 })
          // БЕЗ кнопок правки — только имя/звание/статус текстом.
          await expect(peopleList.getByRole('button')).toHaveCount(0)
          return true
        }
        if (await descendToLeaf(candidate)) return true
        await candidate.getByRole('button').first().click() // свернуть обратно
      }
      return false
    }

    const foundEmployees = await descendToLeaf(firstDept)
    expect(foundEmployees, 'ни один лист не раскрылся в список сотрудников').toBe(true)
  })

  test('«Собрать свод Службы» проходит при неполной готовности, «Отправить» требует причину', async ({
    page,
  }) => {
    const adminToken = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const date = await freshRootDate(adminToken)

    await signIn(page, 'role_duty_officer', ROLE_PASSWORD)
    await page.goto(`${APP}/security-ops/service-summary?dateFrom=${date}`, {
      waitUntil: 'domcontentloaded',
    })
    const section = page.getByRole('region', { name: `Свод по Службе на` })
    await expect(section).toBeVisible({ timeout: 25_000 })

    await section.getByRole('button', { name: 'Собрать свод Службы' }).click()
    const sendButton = section.getByRole('button', { name: 'Отправить дежурному' })
    await expect(sendButton).toBeVisible({ timeout: 15_000 })

    await sendButton.click()
    await expect(
      section.getByText('Свод неполный — укажите причину и подтвердите отправку'),
    ).toBeVisible({ timeout: 15_000 })

    const confirmButton = section.getByRole('button', { name: 'Подтвердить отправку' })
    await expect(confirmButton).toBeDisabled()
    await section
      .getByPlaceholder('Причина неполной отправки — обязательна')
      .fill('не все департаменты собрали свод, штаб предупреждён')
    await expect(confirmButton).toBeEnabled()
    await confirmButton.click()

    await expect(section.getByText('Свод отправлен дежурному')).toBeVisible({ timeout: 15_000 })
  })
})
