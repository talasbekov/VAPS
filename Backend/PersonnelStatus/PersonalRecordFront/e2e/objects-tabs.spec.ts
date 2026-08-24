/**
 * Вкладки реестра объектов на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: вкладки стоят на настоящих полях бэка, а не
 * на выдумке экрана. Поэтому ассерты сверяются с ответом /api/ops/objects/,
 * а не с зашитыми числами: подставь фикстуру другого размера — проба
 * подстроится, а расхождение вкладки с данными всё равно упадёт.
 *
 * Без SMOKE_LIVE=1 скипается, как и смоук-обход рядом: нужен поднятый стек
 * Django :8100 + Next :3106.
 */
import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3106'

interface RegistryRow {
  code: string
  ownership: 'OWN' | 'GUARDED'
  hasSecurityEvents: boolean
}

test.describe(LIVE ? 'вкладки реестра объектов' : 'вкладки (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('счётчики вкладок совпадают с ответом бэка', async ({ page }) => {
    const api = page.context().request
    const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
      csrfToken: string
    }
    await api.post(`${APP}/api/auth/callback/credentials/`, {
      form: {
        csrfToken: csrf.csrfToken,
        username: STAND_USERNAME,
        password: STAND_PASSWORD,
        json: 'true',
      },
    })

    // Ожидание строим ОТ ТОГО ЖЕ ОТВЕТА, который получил экран, — не из
    // повторного запроса. Свой fetch пришлось бы слать на BACKEND_URL с
    // Bearer-токеном сессии (см. lib/ops-api.ts), и разойдись он с реальным
    // хоть на заголовок — проба сверяла бы вкладки с чужими данными.
    const registry = page.waitForResponse(
      (res) => res.url().includes('/api/ops/objects/') && res.status() === 200,
    )
    await page.goto(`${APP}/security-ops/objects/`)
    const payload = await (await registry).json()

    const group = page.getByRole('group', { name: 'Раздел реестра' })
    await expect(group).toBeVisible()

    const rows: RegistryRow[] = payload?.results ?? []
    expect(rows.length, 'реестр не должен быть пустым — иначе все нули сойдутся').toBeGreaterThan(0)

    const expected = {
      'Все объекты': rows.length,
      'Собственные объекты': rows.filter((r) => r.ownership === 'OWN').length,
      'Охраняемые объекты': rows.filter((r) => r.ownership === 'GUARDED').length,
      'Объекты ОМ': rows.filter((r) => r.hasSecurityEvents).length,
    }

    for (const [label, count] of Object.entries(expected)) {
      await expect(
        group.getByRole('button', { name: new RegExp(`^${label}`) }),
      ).toHaveText(new RegExp(`${label}\\s*${count}$`))
    }
  })

  test('вкладка сужает реестр и живёт в URL', async ({ page }) => {
    const api = page.context().request
    const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
      csrfToken: string
    }
    await api.post(`${APP}/api/auth/callback/credentials/`, {
      form: {
        csrfToken: csrf.csrfToken,
        username: STAND_USERNAME,
        password: STAND_PASSWORD,
        json: 'true',
      },
    })

    await page.goto(`${APP}/security-ops/objects/`)
    const group = page.getByRole('group', { name: 'Раздел реестра' })
    await group.getByRole('button', { name: /^Объекты ОМ/ }).click()

    await expect(page).toHaveURL(/[?&]tab=om\b/)
    await expect(
      group.getByRole('button', { name: /^Объекты ОМ/ }),
    ).toHaveAttribute('aria-pressed', 'true')

    // Перезагрузка: вкладка обязана пережить её — состояние в URL, не в памяти.
    await page.reload()
    await expect(
      page.getByRole('group', { name: 'Раздел реестра' })
        .getByRole('button', { name: /^Объекты ОМ/ }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
