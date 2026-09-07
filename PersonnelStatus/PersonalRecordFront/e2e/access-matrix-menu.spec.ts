/**
 * Меню под семью учётками матрицы доступа (Plane №348).
 *
 * Заказчик описал персон СПИСКОМ НЕДОСТУПНЫХ МОДУЛЕЙ и сказал, что будет
 * заходить под ними руками. Проба ходит тем же путём: входит учёткой и читает
 * пункты меню — то же, что увидит он.
 *
 * Проверяются ПОРТАЛЬНЫЕ пункты («Обзор», «Статусы сотрудников», «Сбор сил на
 * ОМ», «Ежедневный отчёт»): только они скрываются правами (`lib/auth.tsx`).
 * Пункты раздела ОМ в меню стоят у всех намеренно, и закрыты они экраном
 * «Доступ закрыт» — их держат пробы прав раздела, а не эта.
 *
 * КРАСНОТА НА МУТАЦИИ: убери у `head-basic` ресурс `organization` — и
 * начальник управления потеряет «Обзор», который заказчик оставил ему явно;
 * добавь `employees` — и увидит «Сбор сил», который назвал недоступным.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/** Пункты, которые прячутся правами. Остальные в меню стоят у всех. */
const GATED = ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ', 'Ежедневный отчет'] as const

/**
 * 🔴 «СБОР СИЛ НА ОМ» СНЯТ У РУКОВОДИТЕЛЕЙ (Plane №939, решение заказчика
 * 07.09.2026): «acc_dir_head, acc_dir_head_d2, acc_dept_head, acc_dept_head_d2
 * не должны иметь доступ к модулю Сбор сил на ОМ».
 *
 * ИСТОРИЯ ПИНА. Матрица №348 называла «Сбор сил» недоступным всем, кроме
 * ответственного за сбор сил. 02.09.2026 (№375) пункт открыли всем с правом
 * на личный состав — и он появился у пяти персон из семи. 07.09.2026 заказчик
 * вернул руководителей к матрице: пропуск на `/employees` снова спрашивает
 * только права сбора сил (`forces.*`), а свой личный состав руководитель
 * читает в «Статусах сотрудников» (`[СБС-30]`: «отдельной страницы нет»).
 *
 * ⚠️ ШТАБ ВТОРОГО ДЕПАРТАМЕНТА (`acc_dir_head_d2`, `acc_dept_head_d2`) ПОКА
 * ВИДИТ ПУНКТ — это не забывчивость, а вилка, заданная заказчику в карточке
 * №939: раздел 7.1 документации называет обе персоны штабом сбора сил, и по
 * №944 (07.09.2026, тем же утром, позже №939) им выдано `forces.command`.
 * Снять пункт у штаба значит оставить цепочку сбора сил без штабного экрана.
 * Пин ниже держит ТЕКУЩЕЕ состояние; решение заказчика поменяет две строки.
 *
 * У СОТРУДНИКА пункта нет: у роли EMPLOYEE прав сбора сил нет вовсе.
 */
const EXPECTED: Record<string, readonly string[]> = {
  // Сотрудник: только статусы своего управления (права на состав у роли нет).
  acc_employee: ['Статусы сотрудников'],
  // Начальник управления: «Обзор» (заказчик выделил его отдельно) и статусы;
  // «Сбор сил» снят (№939).
  acc_dir_head: ['Обзор', 'Статусы сотрудников'],
  // Штаб: пункт остаётся до решения вилки №939 (см. разбор выше).
  acc_dir_head_d2: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ'],
  // Начальник департамента: плюс ежедневный отчёт; «Сбор сил» снят (№939).
  acc_dept_head: ['Обзор', 'Статусы сотрудников', 'Ежедневный отчет'],
  // Начальник второго департамента: ежедневный отчёт заказчик закрыл;
  // «Сбор сил» — до решения вилки №939.
  acc_dept_head_d2: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ'],
  acc_forces_officer: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ', 'Ежедневный отчет'],
  acc_admin: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ', 'Ежедневный отчет'],
}

async function tokenFor(username: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`токен для ${username}: ${res.status}`)
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page, username: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'матрица доступа: меню' : 'матрица доступа (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(
    PASSWORD === '',
    'нужен ACCESS_MATRIX_PASSWORD — тот же, которым заведены учётки',
  )

  for (const [username, visible] of Object.entries(EXPECTED)) {
    test(`${username} видит ровно ${visible.join(', ')}`, async ({ page }) => {
      await signIn(page, username)
      await page.goto(`${APP}/security-ops/profile`)

      const menu = page.locator('aside')
      // Сначала — что меню ВООБЩЕ отрисовалось: ассерт «пункта нет» на пустой
      // странице зелен всегда и не значит ничего.
      await expect(menu.getByRole('link', { name: 'Мой профиль' })).toBeVisible()

      for (const item of GATED) {
        const link = menu.getByRole('link', { name: item, exact: true })
        if (visible.includes(item)) {
          await expect(link, `${username}: «${item}» заказчик оставил открытым`).toBeVisible()
        } else {
          await expect(link, `${username}: «${item}» заказчик назвал недоступным`).toHaveCount(0)
        }
      }
    })
  }

  test('acc_employee: статусы открыты на просмотр и закрыты на правку', async ({ page }) => {
    await signIn(page, 'acc_employee')
    await page.goto(`${APP}/statuses`)

    // Сначала — что экран ВООБЩЕ отрисовался и данные пришли: ассерт «кнопки
    // нет» на пустой странице зелен всегда.
    await expect(page.getByRole('heading', { name: 'Управление статусами' })).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()

    // Заказчик: «видно своё управление, но без возможности редактирования».
    await expect(page.getByRole('tab', { name: 'Массовое обновление' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Импорт' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Прикомандировать' })).toHaveCount(0)
    // Выбор строк живёт только ради массовых действий — без них он лишний.
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    // Чтение остаётся: «Экспорт» — не правка.
    await expect(page.getByRole('button', { name: 'Экспорт' })).toBeVisible()
  })

  test('acc_employee: сервер отбивает запись статуса, а не только экран (Plane №938)', async () => {
    // Экран правку прятал и раньше (проба выше), а кадровая ручка
    // `/api/statuses/statuses/` принимала её от любого вошедшего: сотрудник
    // получал 400 по форме, то есть дверь была открыта, не хватало полей.
    // Проверка, которую обходят другим клиентом, проверкой не является —
    // поэтому проба идёт МИМО экрана, прямо в ручку.
    const employee = await tokenFor('acc_employee')
    const refused = await fetch(`${API}/api/statuses/statuses/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${employee}` },
      body: JSON.stringify({}),
    })
    expect(refused.status, 'сотрудник без status.manage: отказ по праву, а не по форме').toBe(403)

    // Обратная половина: у начальника управления дверь открыта — пустое тело
    // отбивается ФОРМОЙ (400), а не правом. Без неё проба зеленела бы и на
    // ручке, закрытой для всех.
    const head = await tokenFor('acc_dir_head')
    const allowed = await fetch(`${API}/api/statuses/statuses/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${head}` },
      body: JSON.stringify({}),
    })
    expect(allowed.status, 'начальник управления: правку не закрыли всем разом').toBe(400)
  })

  test('acc_dir_head: те же элементы на месте — правку сняли не у всех', async ({ page }) => {
    await signIn(page, 'acc_dir_head')
    await page.goto(`${APP}/statuses`)

    await expect(page.getByRole('heading', { name: 'Управление статусами' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Массовое обновление' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Импорт' })).toBeVisible()
  })
})
