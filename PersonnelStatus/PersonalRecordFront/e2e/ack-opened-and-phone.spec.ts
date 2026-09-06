/**
 * «Открыл и не нажал» и ☎ в строке ознакомления (`[ОЗН-02]`/`[ОЗН-03]`,
 * Plane №452, следствие №432).
 *
 * ЧТО ЭТО СТЕРЕЖЁТ. До №452 старший видел ТРИ состояния строки —
 * подтвердил, отказался, ждём, — и в третьем не мог отличить «не видел» от
 * «видел и молчит». Это разные положения и разные действия: первому
 * напомнить, второму позвонить. Теперь состояний четыре, у четвёртого свой
 * жёлтый сегмент полосы, своё число в шапке и телефон в строке.
 *
 * 🔴 СОСТОЯНИЕ ПОДДЕЛЫВАЕТСЯ ПЕРЕХВАТОМ, А НЕ ПРАВКОЙ СТЕНДА — тем же
 * приёмом, что у пробы «этап мероприятия отстаёт» в
 * `acknowledgement-stage.spec.ts` и по той же причине: отметка «открыл»
 * ставится сервером при чтении человеком СВОЕГО списка, и подделать её
 * по-настоящему значило бы завести на общем стенде учётку сотрудника,
 * связать её с кадровой записью и сходить ею в профиль — четыре шага, каждый
 * из которых остаётся на стенде и мешает соседним пробам. Сама запись
 * проверена на живом стеке (`pytest test_ops_my_assignments.py`, пять
 * мутаций); здесь проверяется ЭКРАН.
 *
 * `serviceWorkers: 'block'` обязателен: без него `page.route` не
 * перехватывает запросы, ушедшие через service worker MSW, и проба была бы
 * зелёной на живых данных, ничего не подделав.
 *
 * МУТАЦИИ, НА КОТОРЫХ ПРОБА ОБЯЗАНА КРАСНЕТЬ:
 *   • `stateOf` перестаёт смотреть `viewedAt` (четвёртое состояние исчезает);
 *   • жёлтый сегмент убран из полосы;
 *   • «Ожидают» и «Напомнить всем» считают по `pending`, а не по неотвеченным;
 *   • ☎ показывается подтвердившим.
 */
import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

const OPENED_PHONE = '+7 701 000-00-01'
const PENDING_PHONE = '+7 701 000-00-02'

test.describe(LIVE ? 'ознакомление: открыл и не нажал' : 'ознакомление: открыл и не нажал (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.use({ serviceWorkers: 'block' })

  test('жёлтый сегмент, четвёртое число в шапке и ☎ у неответивших (Plane №452)', async ({
    page,
  }) => {
    const token = ((await (
      await fetch(`${API}/api/token/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
      })
    ).json()) as { access: string }).access

    const registry = (await (
      await fetch(`${API}/api/ops/security-events/?page_size=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as {
      results: {
        id: string
        visitObjects: unknown[]
        placementAssignments: { id: string }[]
      }[]
    }
    // ТРИ назначения — минимум, на котором вопрос ставится целиком: одно
    // «открыл и молчит», одно «не открывал», одно подтверждённое (у него ☎
    // быть НЕ должно). На двух строках последнее утверждение проверить нечем.
    const target = registry.results.find(
      (row) => row.visitObjects.length > 0 && row.placementAssignments.length >= 3,
    )
    expect(target, 'в реестре нет ОМ с объектом посещения и тремя назначениями').toBeTruthy()

    let expected: { total: number; confirmed: number; openedId: string; pendingId: string; ackedId: string } | null =
      null
    await page.route(
      new RegExp(`/api/ops/security-events/${target!.id}/(\\?.*)?$`),
      async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        body.stage = 'ACKNOWLEDGEMENT'
        body.visitObjects = body.visitObjects.map((visit: Record<string, unknown>) => ({
          ...visit,
          stage: 'ACKNOWLEDGEMENT',
        }))
        body.placementAssignments = body.placementAssignments.map(
          (a: Record<string, unknown>, index: number) => {
            if (index === 0) {
              return {
                ...a,
                acknowledgedAt: null,
                declinedAt: null,
                declineReason: null,
                viewedAt: '2026-09-05T05:00:00Z',
                phone: OPENED_PHONE,
              }
            }
            if (index === 1) {
              return {
                ...a,
                acknowledgedAt: null,
                declinedAt: null,
                declineReason: null,
                viewedAt: null,
                phone: PENDING_PHONE,
              }
            }
            // Остальные — подтверждённые, чтобы числа шапки были
            // однозначными: отказов ноль, ждут ровно двое.
            return {
              ...a,
              acknowledgedAt: '2026-09-05T04:00:00Z',
              acknowledgedVia: 'self',
              declinedAt: null,
              declineReason: null,
              viewedAt: '2026-09-05T03:00:00Z',
              phone: '+7 701 000-00-09',
            }
          },
        )
        const rows = body.placementAssignments as { id: string }[]
        expected = {
          total: rows.length,
          confirmed: rows.length - 2,
          openedId: rows[0]!.id,
          pendingId: rows[1]!.id,
          ackedId: rows[2]!.id,
        }
        await route.fulfill({ response, json: body })
      },
    )

    const api = page.context().request
    const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
    await api.post(`${APP}/api/auth/callback/credentials/`, {
      form: {
        csrfToken: csrf.csrfToken,
        username: STAND_USERNAME,
        password: STAND_PASSWORD,
        json: 'true',
      },
    })
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)

    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Ознакомление' }),
    })
    await expect(card).toBeVisible({ timeout: 15_000 })
    expect(expected, 'перехват не сработал — панель читает НЕ подделанный ответ').toBeTruthy()
    const { total, confirmed, openedId, pendingId, ackedId } = expected!

    // ── Шапка: четыре числа, а не три ─────────────────────────────────────
    const summary = card.getByTestId('ack-summary')
    await expect(summary).toContainText(`Ознакомились ${confirmed} из ${total}`)
    await expect(summary).toContainText('не открыли 1')
    await expect(summary).toContainText('открыли и молчат 1')
    await expect(summary).toContainText('отказов 0')

    // ── Полоса и легенда ──────────────────────────────────────────────────
    const opened = card.locator('[data-segment="opened"]')
    await expect(opened).toHaveCount(1)
    // Ширина ИМЕННО одной строки из total: сегмент нулевой ширины выглядит
    // как отсутствующий, и проба на одно только присутствие узла его бы
    // пропустила.
    await expect(opened).toHaveAttribute(
      'style',
      new RegExp(`width:\\s*${Math.round((1 / total) * 100)}%`),
    )
    await expect(card.getByTestId('ack-legend')).toContainText('открыл, не ответил')
    await expect(card.getByTestId('ack-legend')).toContainText('не открывал')

    // ── Строка «открыл и молчит»: своя плашка и ☎ ─────────────────────────
    const openedRow = card.getByTestId(`ack-row-${openedId}`)
    await expect(openedRow).toHaveAttribute('data-state', 'opened')
    await expect(openedRow).toContainText('не ответил')
    const phone = card.getByTestId(`ack-phone-${openedId}`)
    // 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (найдено ревью №825). В `href` уходит номер без
    // пробелов и дефисов: по RFC 3966 в `tel:` их быть не должно, а в кадровой
    // записи номер лежит форматированным. ВИДИМЫЙ текст остаётся
    // форматированным — его человек и читает, — и это проверяется строкой
    // ниже; поэтому проба стережёт обе половины, а не подогнана под вывод.
    await expect(phone).toHaveAttribute(
      'href',
      `tel:${OPENED_PHONE.replace(/[^+\d]/g, '')}`,
    )
    await expect(phone).toContainText(OPENED_PHONE)
    // Кнопки у неответившего те же: напомнить и отметить лично можно и тому,
    // кто открыл.
    await expect(openedRow.getByRole('button', { name: 'Ознакомлен лично' })).toBeVisible()

    // ── Строка «не открывал»: другая плашка, но ☎ тоже есть ───────────────
    const pendingRow = card.getByTestId(`ack-row-${pendingId}`)
    await expect(pendingRow).toHaveAttribute('data-state', 'pending')
    await expect(pendingRow).toContainText('Не открывал')
    // Тот же довод, что у ссылки выше: в `href` номер без разделителей.
    await expect(card.getByTestId(`ack-phone-${pendingId}`)).toHaveAttribute(
      'href',
      `tel:${PENDING_PHONE.replace(/[^+\d]/g, '')}`,
    )

    // ── Подтвердившему звонить не о чем: ☎ у него нет ─────────────────────
    await expect(card.getByTestId(`ack-row-${ackedId}`)).toHaveAttribute('data-state', 'confirmed')
    await expect(card.getByTestId(`ack-phone-${ackedId}`)).toHaveCount(0)

    // ── «Ожидают» и «Напомнить всем» считают ОБЕ неотвеченные корзины ─────
    await expect(
      card.getByRole('button', { name: 'Напомнить всем, кто не подтвердил (2)' }),
    ).toBeVisible()
    await card.getByRole('button', { name: 'Ожидают (2)' }).click()
    await expect(card.getByTestId(`ack-row-${openedId}`)).toBeVisible()
    await expect(card.getByTestId(`ack-row-${pendingId}`)).toBeVisible()
    await expect(card.getByTestId(`ack-row-${ackedId}`)).toHaveCount(0)
  })
})
