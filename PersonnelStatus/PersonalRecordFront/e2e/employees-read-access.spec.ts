/**
 * Кадровый реестр открыт на ЧТЕНИЕ тому, у кого есть право на личный состав
 * (Plane №375, решение заказчика 02.09.2026).
 *
 * ЕГО СЛОВА: «для всех сотрудников свои управления видны без возможности
 * редактировать или менять статусы, строго ознакомление, но редактировать
 * могут те, у кого есть права».
 *
 * ЧТО БЫЛО. Экран `/employees` объединяет кадровый реестр и «Сбор сил на ОМ»
 * (слиты 21.08.2026), а пропуск на него спрашивал ТОЛЬКО права сбора сил.
 * У роли «Оператор подразделения» их нет ни одного, поэтому вместе со сбором
 * ему закрывался и список своих людей — при том что статусы им он ставит.
 * Найдено ручным тестированием (№377), подтверждено красной пробой смоука.
 *
 * ЧТО СТЕРЕЖЁТ ПРОБА — две половины решения сразу:
 *   1. экран ОТКРЫТ читателю (иначе первая половина потеряна);
 *   2. заведение сотрудника ему НЕ предлагается (иначе потеряна вторая:
 *      кнопка звала бы на действие, которое сервер отобьёт).
 *
 * Учётка `erda` — «Оператор подразделения»: право `personnel.view` есть,
 * `orgstructure.manage` и прав сбора сил нет. Под администратором проба была
 * бы вакуумной: у него не гаснет ничего.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signInAsOperator(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  const res = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: 'erda',
      password: 'erda123',
      json: 'true',
    },
  })
  expect(res.status(), 'учётка оператора подразделения не пустила').toBe(200)
}

test.describe(LIVE ? 'кадровый реестр: чтение по праву личного состава' : 'кадровый реестр: чтение по праву личного состава (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('оператор подразделения видит экран, но завести сотрудника ему не предлагают', async ({
    page,
  }) => {
    await signInAsOperator(page)
    await page.goto(`${APP}/employees?view=forces`)

    // Экран ОТКРЫТ: вкладки на месте, отказа нет.
    await expect(
      page.getByRole('tab', { name: 'Список сотрудников' }),
      'экран закрыт читателю — гейт снова спрашивает только права сбора сил',
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Недостаточно прав|Доступ закрыт/)).toHaveCount(0)

    // И в нём есть люди: пустой список прошёл бы проверку «экран открыт»,
    // ничего не показав.
    await page.getByRole('tab', { name: 'Список сотрудников' }).click()
    await expect
      .poll(async () => page.getByRole('row').count(), { timeout: 30_000 })
      .toBeGreaterThan(1)

    // А правка НЕ предлагается: заведение сотрудника закрыто своим правом.
    await expect(
      page.getByRole('button', { name: /Добавить сотрудника/ }),
      'кнопка заведения показана тому, у кого нет права правки',
    ).toHaveCount(0)
  })
})
