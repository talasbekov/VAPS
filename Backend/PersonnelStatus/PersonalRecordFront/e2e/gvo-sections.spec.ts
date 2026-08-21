/**
 * Правка сводных данных ГВО на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: разделы сводки действительно разбираются из
 * текстового формата прототипа («Фамилия | позывной | роль», блоки по дням) и
 * доходят до экрана, а не сохраняются в никуда. Поэтому каждый шаг ассертит
 * РАЗОБРАННОЕ значение в карточке, а не факт закрытия модалки.
 *
 * Мероприятие берётся первым из реестра, а не по зашитому id: id стенда живут
 * в БД и меняются с пересидом.
 *
 * Без SMOKE_LIVE=1 скипается, как и смоук-обход рядом: нужен поднятый стек
 * Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

// Пин дословно совпадает с константой на экране (app/security-ops/gvo/[id]/page.tsx)
// — проба ловит расхождение текста, а не только факт наличия какой-то строки.
const PERSONS_REGISTRY_GAP_LINE =
  'С реестром «Охраняемые лица» эти карточки не связаны — модель ГВО хранит только текст бюллетеня, без ссылки на запись каталога; появится бэк-этапом.'

interface EventRow {
  id: string
  code: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function registryEvents(): Promise<EventRow[]> {
  const token = await apiToken()
  const res = await fetch(`${API}/api/ops/security-events/?page_size=200`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function signIn(page: Page, username = 'admin', password = 'admin123'): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username,
      password,
      json: 'true',
    },
  })
}

test.describe(LIVE ? 'сводные данные ГВО' : 'сводные данные ГВО (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('разделы сохраняются разобранными и видны в реестре', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)
    await page.goto(`${APP}/security-ops/gvo/`)
    await expect(page.getByRole('heading', { name: 'Реестр ГВО' })).toBeVisible()

    const firstRow = page.locator('tbody tr').first()
    await expect(firstRow).toContainText('Черновик')
    const omCode = (await firstRow.locator('td').first().innerText()).split('\n')[0]
    await firstRow.locator('a').first().click()
    await expect(page.getByRole('heading', { name: 'Сводные данные' })).toBeVisible()

    // Охраняемое лицо: «параметр = значение» построчно
    await page.getByRole('button', { name: '＋ Добавить лицо' }).click()
    await page.getByRole('textbox', { name: 'ФИО' }).fill('Яков Милатович')
    await page.getByRole('textbox', { name: 'Должность' }).fill('Президент Черногории')
    await page
      .getByRole('textbox', { name: 'Данные' })
      .fill('Группа крови = А (II) Rh +\nРост = 185 см')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    const main = page.locator('main')
    await expect(main.getByText('Яков Милатович')).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('А (II) Rh +')).toBeVisible()
    await expect(main.getByText('185 см')).toBeVisible()

    // Группа ГВО: «Фамилия | позывной | роль»; счётчик состава пересчитывается
    await page.getByRole('button', { name: '＋ Группа' }).click()
    await page.getByRole('textbox', { name: 'Название группы' }).fill('ГВО «Черногория»')
    await page
      .getByRole('textbox', { name: 'Состав группы' })
      .fill('Булатаев | 2-27 | старший ГВО\nБайболов | 7-41 | прикреплённый')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(main.getByText('2-27')).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('старший ГВО')).toBeVisible()
    await expect(main.getByText('2 чел.').first()).toBeVisible()

    // Транспорт: «код | марка | примечание»
    await page.getByRole('button', { name: 'Изменить транспорт' }).click()
    await page
      .getByRole('textbox', { name: 'Транспорт' })
      .fill('VIP | Mercedes-Benz Pullman S600 W222, 2019 г.в. | бронь, гостевой парк')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(
      main.getByText('Mercedes-Benz Pullman S600 W222, 2019 г.в.'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('бронь, гостевой парк')).toBeVisible()

    // Объекты посещения: блок на день, блоки разделены пустой строкой
    await page.getByRole('button', { name: 'Изменить объекты посещения' }).click()
    await page
      .getByRole('textbox', { name: 'Объекты по дням' })
      .fill(
        '18.06.2026 | четверг\nМейрам | «ночь» — Офис\n\n19.06.2026 | пятница\nТарлан | Мухамадиев, позывной 2-13',
      )
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(main.getByText('18.06.2026')).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('19.06.2026')).toBeVisible()
    await expect(main.getByText('Мухамадиев, позывной 2-13')).toBeVisible()

    // Реестр читает ту же сводку: статус, старший ГВО и охраняемые лица
    await page.getByRole('link', { name: '← Назад к реестру ГВО' }).click()
    const row = page.locator('tbody tr', { hasText: omCode })
    await expect(row).toContainText('Заполнена', { timeout: 10_000 })
    await expect(row).toContainText('Булатаев · 2-27')
    await expect(row).toContainText('Яков Милатович')

    // Удаление элемента списка возвращает раздел в пустое состояние
    await row.locator('a').first().click()
    await page.getByRole('button', { name: 'Изменить данные лица 1' }).click()
    await page.getByRole('button', { name: 'Удалить лицо' }).click()
    await expect(
      main.getByText('Охраняемые лица не указаны в бюллетене'),
    ).toBeVisible({ timeout: 10_000 })

    // «Вернуть исходные» по КАЖДОМУ правленому разделу возвращает сводку в
    // черновик: пустой патч не хранится. Удаление элемента списка сюда не
    // считается — пустой список это тоже ручная правка, и статус остаётся
    // «Заполнена», пока раздел не сброшен явно.
    await expect(main.getByText('Сводка заполнена')).toBeVisible()
    for (const button of [
      'Изменить транспорт',
      'Изменить объекты посещения',
      'Изменить список охраняемых лиц',
      'Изменить состав ГВО',
    ]) {
      await page.getByRole('button', { name: button }).click()
      await page.getByRole('button', { name: 'Вернуть исходные' }).click()
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })
    }
    await expect(main.getByText('Черновик сводки')).toBeVisible({ timeout: 10_000 })

    // CLIENT_FETCH_ERROR — обрыв навигации NextAuth, не дефект экрана
    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  // Гейт раздела показывается персоной, у которой права НЕТ: под админом
  // (`*`) закрытое состояние недостижимо в принципе.
  test('без event.view реестр ГВО закрыт', async ({ page }) => {
    await signIn(page, 'observer', 'observer123')
    await page.goto(`${APP}/security-ops/gvo/`)
    await expect(page.getByText('реестра ГВО')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Реестр ГВО' })).toBeHidden()
  })
})

/**
 * Обратный переход «сводка → своё ОМ» (Task 9). Своей записи у сводки нет —
 * её id это id мероприятия (Task 8, entities/gvo-summary), поэтому ссылка
 * назад обязана вести на карточку С ТЕМ ЖЕ id, с которого сводка открыта.
 *
 * Ассерт на URL один не ловит подмену «ссылка ведёт на ДРУГОЕ, но валидное
 * ОМ» — форма адреса совпадёт, а запись под ней будет чужая. Поэтому после
 * перехода дополнительно проверяется код мероприятия НА ЛАНДЕД-СТРАНИЦЕ —
 * это и есть красная проба из отчёта (id захардкожен на «1» — он гарантированно
 * существует на стенде и гарантированно НЕ совпадает с целью теста).
 */
test.describe(
  LIVE ? 'сводка ГВО ↔ карточка ОМ' : 'сводка ГВО ↔ карточка ОМ (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('ссылка со сводки ведёт на карточку СВОЕГО ОМ', async ({ page }) => {
      const rows = await registryEvents()
      // id «1» зарезервирован под красную пробу отчёта — цель теста должна
      // гарантированно от него отличаться.
      const target = rows.find((r) => r.id !== '1') ?? rows[0]
      expect(target, 'на стенде нет ни одного ОМ').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/gvo/${target!.id}/`)
      await expect(page.getByRole('heading', { name: 'Сводные данные' })).toBeVisible({
        timeout: 15_000,
      })

      const link = page.getByRole('main').getByRole('link', { name: /мероприятию/i })
      await expect(link).toBeVisible()
      await link.click()

      await expect(page).toHaveURL(new RegExp(`/security-ops/events/${target!.id}/?$`))
      // Landed-identity: код мероприятия на КАРТОЧКЕ ОМ, а не только форма URL.
      // .first() — на этапе «Бюллетень» код мероприятия дублируется в фактах
      // шага; первый в DOM — код-бейдж шапки карточки, оба варианта верны.
      await expect(
        page.getByRole('main').getByText(target!.code, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 })
    })

    test('сводка честно называет отсутствие связи с реестром лиц', async ({ page }) => {
      const rows = await registryEvents()
      const target = rows[0]
      expect(target, 'на стенде нет ни одного ОМ').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/gvo/${target!.id}/`)
      await expect(page.getByRole('heading', { name: 'Сводные данные' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(
        page.getByText(PERSONS_REGISTRY_GAP_LINE, { exact: true }),
      ).toBeVisible()
    })
  },
)
