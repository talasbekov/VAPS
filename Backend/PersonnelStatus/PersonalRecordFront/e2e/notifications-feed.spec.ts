/**
 * Лента колокольчика: ключ строки (Plane №563) и отказ ОДНОЙ из двух лент
 * (Plane №565).
 *
 * 🔴 ДВА РОДА ПРОБ В ОДНОМ ФАЙЛЕ, И ЭТО НАРОЧНО. Ключ строки — чистая функция,
 * ей ни браузера, ни стенда не нужно, и привязка к стенду сделала бы её
 * медленной и мигающей (тот же приём, что у `route-map-coverage.spec.ts`: без
 * `SMOKE_LIVE` она даёт «passed», а не «skipped», иначе молчание читалось бы
 * как зелень). А частичный отказ ленты проверить чисто НЕЛЬЗЯ: предмет пробы —
 * что видит человек, когда одна половина упала, а вторая пришла. Живая проба
 * гасит одну ленту перехватом запроса в браузере и читает колокольчик глазами.
 */
import { expect, test } from '@playwright/test'
import { notificationKey, type Notification } from '../features/notifications/api/notifications-api'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

/**
 * Ключ строки в ленте колокольчика (Plane №563).
 *
 * Проба стоит рядом со склонением по той же причине: обе про ЧИСТЫЕ функции
 * ленты уведомлений, обе не требуют ни браузера, ни стенда, и обе стерегут то,
 * что ломается молча.
 */
test.describe('ключ строки в ленте', () => {
  test('совпавшие номера из разных таблиц дают РАЗНЫЕ ключи', () => {
    // Колокольчик сводит легаси-ленту и ленту раздела ОМ; их первичные ключи
    // нумеруются независимо, поэтому пара строк с одним номером — обычное
    // дело, а не редкость.
    const row = (id: number, source: 'legacy' | 'ops'): Notification => ({
      id,
      notification_type: 'X',
      title: `строка ${source} ${id}`,
      message: '',
      link: null,
      is_read: false,
      created_at: '2026-09-05T00:00:00Z',
      source,
    })
    // 🔴 Мутация, на которой проба обязана краснеть: вернуть `String(n.id)`.
    expect(notificationKey(row(7, 'legacy'))).not.toBe(notificationKey(row(7, 'ops')))
    // Ключ строки не меняется от вызова к вызову — иначе `AnimatePresence`
    // считал бы каждую перерисовку заменой всего списка.
    expect(notificationKey(row(7, 'ops'))).toBe(notificationKey(row(7, 'ops')))
    // И остаётся различающим внутри одного источника.
    expect(notificationKey(row(7, 'ops'))).not.toBe(notificationKey(row(8, 'ops')))
  })
})

test.describe('отказ одной из двух лент', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('упала одна лента — вторая показана, а не спрятана (Plane №565)', async ({ page }) => {
    /**
     * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Слияние двух лент (Plane №402) сделали через
     * `Promise.all`, и это оказалось РЕГРЕССОМ: до него легаси-уведомления
     * показывались сами по себе, а после — единственный 500 с любой стороны
     * ронял весь запрос, и колокольчик рисовал «Не удалось загрузить
     * уведомления» поверх строк, которые прекрасно пришли.
     *
     * Мутация, на которой проба обязана краснеть: вернуть `Promise.all` —
     * вместо неполного списка появится отказ целиком.
     */
    const api = page.context().request
    const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
    await api.post(`${APP}/api/auth/callback/credentials/`, {
      form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
    })

    // Гасим ЛЕГАСИ-ленту: у неё свой адрес, и упасть она может независимо.
    await page.route('**/api/notifications/notifications/unread/', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' })
    )

    await page.goto(`${APP}/dashboard`)
    await page.getByRole('button', { name: 'Уведомления' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible({ timeout: 20_000 })

    // Про упавшую половину сказано ВСЛУХ (role=alert читает скринридер).
    const alert = menu.getByText('Часть уведомлений не загрузилась', { exact: false })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    // И отказа целиком НЕТ: вторая лента ответила, её строки имеют право
    // быть показанными.
    await expect(menu.getByText('Не удалось загрузить уведомления', { exact: false })).toHaveCount(0)
    // «Нет новых уведомлений» тоже не годится: это утверждение о мире, а мы
    // знаем только половину.
    await expect(menu.getByText('Нет новых уведомлений', { exact: false })).toHaveCount(0)
  })
})
