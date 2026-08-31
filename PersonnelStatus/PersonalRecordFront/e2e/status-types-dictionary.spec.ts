/**
 * Справочник типов статусов виден на «Система → Справочники» (Plane №344).
 *
 * Заказчик завёл тип статуса в админке и не нашёл его на этом экране. №342
 * починил источник каталога для окон и подписей; сам справочник в реестре не
 * появился, потому что реестр перечислял только generic-справочники.
 *
 * Проба ходит его путём: открывает реестр, находит строку, переходит по ней и
 * читает свойства типа. Красная на мутации: убери строку из
 * `EXTERNAL_DEFINITIONS` на сервере — падает первый же ассерт.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'справочник типов статусов' : 'справочник типов статусов (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('реестр справочников называет типы статусов и ведёт на них', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/dictionaries`)

    // Сначала — что реестр ВООБЩЕ отрисовался: ассерт «строка есть» на пустой
    // странице ничего не значил бы.
    // `exact`, иначе локатор ловит ещё и «Кадровые справочники» ниже по
    // странице и падает на строгом режиме.
    await expect(
      page.getByRole('heading', { name: 'Справочники', exact: true }),
    ).toBeVisible()
    const row = page.locator('tr').filter({ hasText: 'Типы статусов сотрудников' })
    await expect(row).toHaveCount(1)

    await row.locator('a').first().click()

    // Слэш на конце НЕОБЯЗАТЕЛЕН: Next дорисовывает его сам, и якорь `$` без
    // этого не совпадал (тот же капкан, что с селектором по href).
    await expect(page).toHaveURL(/\/security-ops\/dictionaries\/status-types\/?$/)
    await expect(
      page.getByRole('heading', { name: 'Типы статусов сотрудников' }),
    ).toBeVisible()
  })

  test('экран показывает свойства типа, а не одни названия', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/dictionaries/status-types`)

    await expect(page.locator('table').first()).toBeVisible()
    // Именно свойства и отличают этот справочник от generic-«код → значение»:
    // ради них он и живёт своей таблицей.
    //
    // Заголовки ищутся элементом `th`, а НЕ ролью `columnheader`. Замерено
    // 31.08.2026: на этом экране и на реестре справочников роль `columnheader`
    // не находится вовсе (0 при восьми `th`), а на `/security-ops/vehicles` с
    // той же разметкой и теми же вычисленными `display` — находится (7 из 7).
    // Расхождение воспроизводимо и заведено отдельной карточкой: это дефект
    // доступности, а не свойство этой пробы, и подгонять под него ассерт
    // «пусть роли не будет» нельзя — проба обязана проверять ЗАГОЛОВКИ.
    const headers = await page.locator('th').allTextContents()
    for (const column of ['Приоритет', 'Колонка расхода', 'Жёсткая блокировка']) {
      expect(headers, `колонки «${column}» на экране нет`).toContain(column)
    }

    // Каталог стенда непустой — иначе проверять нечего, и молчание таблицы
    // читалось бы как зелень.
    const rows = page.locator('tbody tr')
    expect(await rows.count()).toBeGreaterThan(1)

    // Экран без кнопок обязан сказать, где тип заводится.
    await expect(page.getByText('Справочник только для чтения')).toBeVisible()
  })
})
