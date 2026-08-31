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

/** Пункты, которые прячутся правами. Остальные в меню стоят у всех. */
const GATED = ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ', 'Ежедневный отчет'] as const

const EXPECTED: Record<string, readonly string[]> = {
  // Сотрудник: только статусы своего управления.
  acc_employee: ['Статусы сотрудников'],
  // Начальник управления: плюс «Обзор» (заказчик выделил его отдельно).
  acc_dir_head: ['Обзор', 'Статусы сотрудников'],
  acc_dir_head_d2: ['Обзор', 'Статусы сотрудников'],
  // Начальник департамента: плюс ежедневный отчёт.
  acc_dept_head: ['Обзор', 'Статусы сотрудников', 'Ежедневный отчет'],
  // Начальник второго департамента: ежедневный отчёт заказчик закрыл.
  acc_dept_head_d2: ['Обзор', 'Статусы сотрудников'],
  // Ответственный за сбор сил: единственный, у кого «Сбор сил на ОМ».
  acc_forces_officer: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ', 'Ежедневный отчет'],
  acc_admin: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ', 'Ежедневный отчет'],
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

  test('acc_dir_head: те же элементы на месте — правку сняли не у всех', async ({ page }) => {
    await signIn(page, 'acc_dir_head')
    await page.goto(`${APP}/statuses`)

    await expect(page.getByRole('heading', { name: 'Управление статусами' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Массовое обновление' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Импорт' })).toBeVisible()
  })
})
