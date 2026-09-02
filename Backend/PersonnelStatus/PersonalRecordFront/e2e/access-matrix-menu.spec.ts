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

/**
 * 🔴 «СБОР СИЛ НА ОМ» ПЕРЕЕХАЛ К БОЛЬШИНСТВУ ПЕРСОН (Plane №375, решение
 * заказчика 02.09.2026 — он выбрал его из трёх вариантов, ответив на прямой
 * вопрос).
 *
 * ЕГО СЛОВА: «для всех сотрудников свои управления видны без возможности
 * редактировать или менять статусы, строго ознакомление, но редактировать
 * могут те, у кого есть права». Список личного состава живёт на экране
 * `/employees` — первой вкладкой того самого пункта «Сбор сил на ОМ»
 * (реестр кадров и сбор сил слиты 21.08.2026). Значит пункт открывается
 * всем, у кого есть право на личный состав; правка при этом закрыта своими
 * правами и проверяется пробой `employees-read-access`.
 *
 * ЧТО ЭТО ЗНАЧИТ ДЛЯ ПИНА. До 02.09.2026 здесь стояло «единственный, у кого
 * „Сбор сил на ОМ“, — ответственный за сбор сил»: так матрица №348 читалась
 * буквально. Пин поднят ОСОЗНАННО, по новому слову заказчика, а не подогнан
 * под вывод: у пяти персон из семи в меню стало на пункт больше.
 *
 * У СОТРУДНИКА ПУНКТ НЕ ПОЯВИЛСЯ, и это не забывчивость: у роли EMPLOYEE
 * нет права `personnel.view` вовсе. Захочет заказчик показать реестр и ему —
 * это одно движение на экране «Роли», без правки кода.
 */
const EXPECTED: Record<string, readonly string[]> = {
  // Сотрудник: только статусы своего управления (права на состав у роли нет).
  acc_employee: ['Статусы сотрудников'],
  // Начальник управления: «Обзор» (заказчик выделил его отдельно) и состав.
  acc_dir_head: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ'],
  acc_dir_head_d2: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ'],
  // Начальник департамента: плюс ежедневный отчёт.
  acc_dept_head: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ', 'Ежедневный отчет'],
  // Начальник второго департамента: ежедневный отчёт заказчик закрыл.
  acc_dept_head_d2: ['Обзор', 'Статусы сотрудников', 'Сбор сил на ОМ'],
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
