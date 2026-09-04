/**
 * Реестр транспорта ГОН на ЖИВОМ стенде (Plane №215).
 *
 * Проба отвечает на три вопроса: таблица показывает колонки ОБРАЗЦА, отбор по
 * классу брони считает СЕРВЕР (а не браузер над уже полученным списком), и
 * снятая машина в реестр по умолчанию не попадает.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next.
 */
import { expect, test, type Page } from '@playwright/test'
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/vehicles/'

interface VehicleRow {
  id: string
  brand: string
  plate: string
  armorClass: string
  deployment: string
  isActive: boolean
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function fleet(token: string, query = ''): Promise<VehicleRow[]> {
  const res = await fetch(`${API}/api/ops/vehicles/${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: VehicleRow[] }).results
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'транспорт ГОН' : 'транспорт ГОН (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('таблица несёт колонки образца и живые строки реестра', async ({ page }) => {
    const token = await apiToken()
    const car = requireFixture(
      (await fleet(token))[0],
      'машина в реестре транспорта (заводится manage.py seed_vehicles)',
    )

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await expect(
      page.getByRole('heading', { name: 'Транспорт ГОН' }),
    ).toBeVisible({ timeout: 20_000 })

    // Колонки ПИНЯТСЯ ПОИМЁННО: подписи взяты из образца заказчика, и
    // переименование колонки — решение, а не оговорка. Подмени любую — проба
    // покраснеет.
    for (const column of [
      'Марка автомобиля',
      'Классификация по кузову',
      'Год выпуска',
      'ГРНЗ',
      'Класс брони',
      'Дислокация',
      'Примечание',
    ]) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible()
    }

    // Строка ЖИВАЯ: номер взят из ответа сервера, а не из вёрстки.
    const row = page.getByRole('row', { name: new RegExp(car.plate) })
    await expect(row).toBeVisible()
    await expect(row).toContainText(car.brand)

    // Врезки «на бэке нет /api/ops/*» здесь быть НЕ ДОЛЖНО: строки выше
    // пришли с сервера, и утверждать над ними, что всё показанное — мок,
    // значит врать о собственных данных (Plane №215).
    await expect(page.getByText('на бэке нет')).toHaveCount(0)
  })

  test('отбор по классу брони сужает выдачу и живёт в адресе', async ({ page }) => {
    const token = await apiToken()
    const all = await fleet(token)
    const classes = [...new Set(all.map((c) => c.armorClass).filter(Boolean))]
    // Сторож вакуумности: на парке из одного класса отбор не проверяется —
    // «сузил» и «показал всё» дали бы одну и ту же таблицу.
    expect(
      classes.length,
      'в парке один класс брони — отбор проверять нечем (manage.py seed_vehicles)',
    ).toBeGreaterThan(1)
    const wanted = classes[0]
    const expected = all.filter((c) => c.armorClass === wanted).map((c) => c.plate)
    const hidden = all.find((c) => c.armorClass !== wanted && c.armorClass !== '')

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await page.getByRole('button', { name: wanted, exact: true }).click()

    // Отбор УЕХАЛ В АДРЕС: обновление страницы не сбрасывает выборку, и
    // ссылкой можно поделиться.
    await expect(page).toHaveURL(new RegExp(`armorClass=${wanted}`))
    for (const plate of expected) {
      await expect(page.getByRole('row', { name: new RegExp(plate) })).toBeVisible()
    }
    if (hidden !== undefined) {
      await expect(
        page.getByRole('row', { name: new RegExp(hidden.plate) }),
      ).toHaveCount(0)
    }
  })

  test('машина выделяется на ОМ и видна в сводке ГВО, снятие её убирает', async ({
    page,
  }) => {
    // Путь целиком, а не ассерт на своё же поле: выделили ЭКРАНОМ → машина
    // названа в разделе «Выделяемый транспорт» карточки ОМ вместе с ГРНЗ →
    // сняли → строка ушла. Ровно того, чего не умел свободный текст.
    const token = await apiToken()
    const car = requireFixture(
      (await fleet(token))[0],
      'машина в реестре транспорта (manage.py seed_vehicles)',
    )
    const event = requireFixture(
      (
        await (
          await fetch(`${API}/api/ops/security-events/?page_size=100`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json()
      ).results.find(
        (row: { stage: string; kind: string }) =>
          row.stage !== 'CLOSED' && row.kind !== 'INTERNAL',
      ),
      'незакрытый визит иностранного ОЛ — панель ГВО есть только у них',
    ) as { id: string; vehicles: { id: string }[] }

    // Уборка ДО пробы, а не после: прошлый прогон мог оборваться на середине,
    // и «уже выделена» превратило бы падение фикстуры в падение проверки.
    for (const row of event.vehicles) {
      await fetch(`${API}/api/ops/security-events/${event.id}/vehicles/${row.id}/`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    }

    await signIn(page)
    // Сводка — на странице визита (`[ГВО-03]`, Plane №441): панели в карточке
    // ОМ больше нет.
    await page.goto(`${APP}/security-ops/visits/${event.id}/`)
    // Раздел ищется по СВОЕЙ карточке: `Section` рисует `[data-slot="card"]`
    // с заголовком внутри, отдельного `<section>` у него нет.
    const section = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('heading', { name: 'Выделяемый транспорт' }) })
      .first()
    await expect(section).toBeVisible({ timeout: 15_000 })

    await section.getByRole('button', { name: '+ Машина из реестра' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Поиск по реестру транспорта' }).fill(car.plate)
    await dialog.getByRole('button', { name: new RegExp(car.plate) }).click()
    await dialog.getByLabel('Позывной в кортеже').fill('S1')
    await dialog.getByLabel('Назначение').fill('кортеж')
    await dialog.getByRole('button', { name: 'Выделить' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    // ГРНЗ и класс брони — то, ради чего заводился реестр: у свободного
    // текста их не было вовсе.
    await expect(section).toContainText(car.plate, { timeout: 15_000 })
    await expect(section).toContainText('из реестра ГОН')

    await section.getByRole('button', { name: 'Снять' }).first().click()
    await expect(section).not.toContainText(car.plate, { timeout: 15_000 })
  })

  test('снятая машина показывается только по прямой просьбе', async ({ page }) => {
    const token = await apiToken()
    const whole = await fleet(token, '?includeRetired=1')
    const retired = whole.find((c) => !c.isActive)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const live = await fleet(token)
    expect(live.every((c) => c.isActive), 'реестр по умолчанию отдал снятую машину').toBe(
      true,
    )

    test.skip(
      retired === undefined,
      'на стенде нет снятой машины — переключатель проверять не на чем',
    )
    await page.getByRole('button', { name: 'Показывать снятые' }).click()
    await expect(page).toHaveURL(/includeRetired=1/)
    await expect(
      page.getByRole('row', { name: new RegExp(retired!.plate) }),
    ).toBeVisible({ timeout: 10_000 })
  })
})
