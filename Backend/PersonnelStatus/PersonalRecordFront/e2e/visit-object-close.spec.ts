/**
 * Закрытие ОБЪЕКТА посещения (`[ЗАК-05]`/`[ЗАК-12]`, Plane №404) на ЖИВОМ стенде.
 *
 * Два вопроса. Первый — панель «Закрытие объекта» на «Проведении» ведёт к
 * подтверждению с итоговым комментарием (`[ЗАК-04]`), и «Отмена» ничего не
 * меняет. Само закрытие проба НЕ выполняет — оно необратимо и сделало бы
 * фикстуру одноразовой (тот же принцип, что у `closure-stage.spec.ts`);
 * успешный путь и «последний объект закрывает мероприятие» держат серверные
 * пробы `test_ops_visit_object_close.py`. Второй — владелец правила «закрыть
 * объект можно только на „Проведении“» — сервер: с любой другой стадии
 * эндпоинт отвечает 422 `INVALID_STAGE_TRANSITION`, а стадия не сдвигается.
 */
import { expect, test, type Page } from '@playwright/test'
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventRow {
  id: string
  stage: string
  visitObjects: { id: string; objectName: string; stage: string }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  const body = (await res.json()) as { access?: string }
  if (body.access === undefined) throw new Error('нет токена стенда')
  return body.access
}

async function events(token: string, stage = ''): Promise<EventRow[]> {
  const query = `page_size=50${stage === '' ? '' : `&stage=${stage}`}`
  const res = await fetch(`${API}/api/ops/security-events/?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function eventDetail(token: string, id: string): Promise<EventRow> {
  const res = await fetch(`${API}/api/ops/security-events/${id}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as EventRow
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

test.describe(LIVE ? 'закрытие объекта посещения' : 'закрытие объекта посещения (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('на «Проведении» есть подтверждение с комментарием, «Отмена» ничего не меняет', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    const token = await apiToken()
    const target = requireFixture(
      (await events(token, 'CONDUCT')).find((e) =>
        e.visitObjects.some((v) => v.stage !== 'CLOSED'),
      ),
      'мероприятие на «Проведении» с незакрытым объектом',
    )
    const visit = target.visitObjects.find((v) => v.stage !== 'CLOSED')!

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const panel = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Закрытие объекта' }),
    })
    await expect(panel).toBeVisible({ timeout: 15_000 })
    // Панель говорит, что будет с мероприятием: либо «закроется целиком»,
    // либо сколько объектов ещё открыто — обе подписи считаются от живых данных.
    const openOthers = target.visitObjects.filter(
      (v) => v.id !== visit.id && v.stage !== 'CLOSED',
    ).length
    await expect(panel).toContainText(
      openOthers === 0 ? 'закроет мероприятие целиком' : `Ещё не закрыто объектов: ${openOthers}`,
    )

    await panel.getByRole('button', { name: 'Закрыть объект' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Закрыть объект «')
    await expect(dialog).toContainText('После закрытия изменения по объекту невозможны.')
    await expect(dialog.getByLabel('Итоговый комментарий по объекту (необязательно)')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Подтвердить закрытие' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()

    const after = await eventDetail(token, target.id)
    expect(after.stage).toBe('CONDUCT')
    expect(after.visitObjects.find((v) => v.id === visit.id)?.stage).not.toBe('CLOSED')
    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('вне «Проведения» закрытие объекта отбивает сервер', async () => {
    const token = await apiToken()
    const target = requireFixture(
      (await events(token)).find(
        (e) => !['CONDUCT', 'CLOSED'].includes(e.stage) && e.visitObjects.length > 0,
      ),
      'мероприятие не на «Проведении» с объектом посещения',
    )
    const res = await fetch(
      `${API}/api/ops/security-events/${target.id}/visit-objects/${target.visitObjects[0].id}/close/`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'проба' }),
      },
    )
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('INVALID_STAGE_TRANSITION')
    const after = await eventDetail(token, target.id)
    expect(after.stage).toBe(target.stage)
    expect(after.visitObjects[0].stage).toBe(target.visitObjects[0].stage)
  })
})
