/**
 * Цепочка этапов карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: пользователь видит ШЕСТЬ шагов, как в
 * прототипе Smart Josparlau (`stepNames`), а не девять стадий бэкенда, и
 * стадии, свёрнутые в один шаг, честно подписаны — иначе цепочка выдавала бы
 * подготовку расчёта за расстановку.
 *
 * Мероприятия берутся с живого стенда; нужны ОМ на разных стадиях, чтобы
 * проверить и совпадающий шаг, и свёрнутый. Чего нет — то пропускается с
 * явной причиной.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

const STEPS = [
  'Бюллетень',
  'Рекогносцировка',
  'Расстановка',
  'Согласование',
  'Ознакомление',
  'Закрытие',
]

interface EventRow {
  id: string
  code: string
  stage: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string, stage = ''): Promise<EventRow[]> {
  const query = `page_size=50${stage === '' ? '' : `&stage=${stage}`}`
  const res = await fetch(`${API}/api/ops/security-events/?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

/** Первое ОМ на любой из свёрнутых стадий. Спрашиваем СЕРВЕР по стадиям:
 * поиск по первой странице реестра перестаёт находить фикстуру, как только
 * стенд наберёт полсотни мероприятий, и проба уходит в молчаливый skip. */
async function collapsedStageEvent(token: string): Promise<EventRow | undefined> {
  for (const stage of ['DEMAND', 'FORCES', 'CONDUCT', 'CLOSED']) {
    const found = (await events(token, stage))[0]
    if (found !== undefined) return found
  }
  return undefined
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

test.describe(LIVE ? 'цепочка этапов' : 'цепочка этапов (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('шагов шесть, свёрнутые стадии подписаны', async ({ page }) => {
    const token = await apiToken()
    const rows = await events(token)
    const any = rows[0]
    expect(any, 'на стенде нет ни одного ОМ').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${any.id}/`)
    const chain = page.getByRole('list', { name: 'Этапы ОМ' })
    await expect(chain).toBeVisible({ timeout: 15_000 })

    // Ровно шесть шагов и ровно в порядке прототипа
    const items = chain.locator('li')
    await expect(items).toHaveCount(6)
    for (const [index, label] of STEPS.entries()) {
      await expect(items.nth(index)).toContainText(`${index + 1}. ${label}`)
    }
    // Стадий бэкенда, выведенных из цепочки, в ней быть не должно
    for (const gone of ['Потребность', 'Запрос сил', 'Проведение', 'Закрыто']) {
      await expect(chain).not.toContainText(gone)
    }

    // Свёрнутая стадия подписана: где именно внутри шага стоит мероприятие
    const collapsed = await collapsedStageEvent(token)
    test.skip(collapsed === undefined, 'на стенде нет ОМ на свёрнутой стадии')
    await page.goto(`${APP}/security-ops/events/${collapsed!.id}/`)
    const expected: Record<string, string> = {
      DEMAND: 'Подготовка расчёта: потребность',
      FORCES: 'Подготовка расчёта: выделение сил',
      CONDUCT: 'Проведение и закрытие',
      CLOSED: 'Дело закрыто',
    }
    await expect(page.getByText(expected[collapsed!.stage])).toBeVisible({
      timeout: 15_000,
    })
  })
})
