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

/**
 * Отказ и черновик комментария в окне закрытия (Plane №609, №610).
 *
 * 🔴 СВОЁ ОПИСАНИЕ С `serviceWorkers: 'block'`: без него `page.route` не
 * перехватывает запросы, ушедшие через service worker MSW, — отказ сервера
 * подделать нельзя, и проба была бы зелёной на живых данных, ничего не
 * проверив.
 *
 * Отказ подделывается ПЕРЕХВАТОМ, а не настоящим закрытием: закрытие
 * необратимо и сделало бы фикстуру одноразовой (тот же принцип, что у пробы
 * выше).
 */
test.describe(LIVE ? 'закрытие объекта: отказ и черновик' : 'закрытие объекта: отказ (скип)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.use({ serviceWorkers: 'block' })

  test('отказ виден ВНУТРИ окна, а не под ним (Plane №609)', async ({ page }) => {
    /**
     * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. `StageError` стоял в теле карточки, а окно живёт в
     * ПОРТАЛЕ поверх неё. При отказе (двое закрывают один объект — 422
     * `VISIT_OBJECT_ALREADY_CLOSED`) окно оставалось открытым, кнопка
     * включалась обратно, а сообщение сервера красилось ЗА оверлеем. Нажатие
     * читалось как ничего: ни ошибки, ни закрытия, ни объяснения — и человек
     * жал снова.
     *
     * Мутация, на которой проба обязана краснеть: вернуть `StageError` в тело
     * карточки.
     */
    const token = await apiToken()
    const target = requireFixture(
      (await events(token, 'CONDUCT')).find((e) =>
        e.visitObjects.some((v) => v.stage !== 'CLOSED'),
      ),
      'мероприятие на «Проведении» с незакрытым объектом',
    )

    await page.route('**/visit-objects/*/close/', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error_code: 'VISIT_OBJECT_ALREADY_CLOSED',
          message: 'Объект уже закрыт другим пользователем.',
          details: {},
        }),
      }),
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const panel = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Закрытие объекта' }),
    })
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await panel.getByRole('button', { name: 'Закрыть объект' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Подтвердить закрытие' }).click()

    // Окно осталось открытым — и отказ написан ЗДЕСЬ ЖЕ, а не за оверлеем.
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toContainText('уже закрыт', { ignoreCase: true })
  })

  test('черновик комментария не живёт дольше окна (Plane №610)', async ({ page }) => {
    /**
     * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Поле не чистилось НИ на успешном закрытии, НИ на
     * отмене, НИ при смене объекта в шапке: у компонента нет `key`, и
     * переключение `?visit=` переиспользует ТОТ ЖЕ экземпляр. Человек закрывал
     * объект A с итогом «Пост 3 снят досрочно», переключался на объект B,
     * открывал окно — и там уже стоял итог A. Одно нажатие писало формулировку
     * A в комментарий закрытия объекта B и в его аудит.
     *
     * Проверяется путь, доступный на ЛЮБОМ стенде: отмена и повторное
     * открытие того же объекта. Он ловит ту же причину — состояние переживает
     * закрытие окна; второй объект для этого не нужен, а требовать его значило
     * бы поставить пробу в зависимость от того, что кто-то завёл фикстуру.
     *
     * Мутация, на которой проба обязана краснеть: снять сброс `comment` из
     * эффекта и из `onEvent`.
     */
    const token = await apiToken()
    const target = requireFixture(
      (await events(token, 'CONDUCT')).find((e) =>
        e.visitObjects.some((v) => v.stage !== 'CLOSED'),
      ),
      'мероприятие на «Проведении» с незакрытым объектом',
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const panel = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Закрытие объекта' }),
    })
    await expect(panel).toBeVisible({ timeout: 15_000 })

    const label = 'Итоговый комментарий по объекту (необязательно)'
    await panel.getByRole('button', { name: 'Закрыть объект' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel(label).fill('Пост 3 снят досрочно')
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()

    // Второе открытие того же объекта — поле чистое: отменённая формулировка
    // не должна уходить на сервер одним нажатием.
    await panel.getByRole('button', { name: 'Закрыть объект' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel(label)).toHaveValue('')
    await dialog.getByRole('button', { name: 'Отмена' }).click()
  })
})
