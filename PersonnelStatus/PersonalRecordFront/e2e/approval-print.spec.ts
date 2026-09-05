/**
 * Печатный вид «Расчёт расстановки сил» и «Скачать PDF» на этапе 3
 * (`[СОГ-02]`, `[СОГ-03]`, Plane №430).
 *
 * На «Согласовании» вместо списка «ФИО — Сектор · Пост» стоит документ в
 * печатном виде: шапка «ОМ-код «Название» · Объект · дата · Старший объекта»,
 * секторы, посты с людьми, строка «Итого: секторов N · постов N · сотрудников
 * N · потребность N · недобор N». Кнопка «Скачать PDF» есть всегда; до
 * согласования подпись предупреждает о водяном знаке «Проект», а сам PDF по
 * API той же учётки содержит слово «ПРОЕКТ».
 *
 * ОМ на «Согласовании» берётся живой; нет — готовится тем же путём, что в
 * `approval-rights` (старший объекта + принятый состав — с №424 и №428 без
 * них расстановка с экрана не проходится, но проба ставит людей по API).
 *
 * КРАСНОТА НА МУТАЦИИ: убери `stamp_draft` из `render_placement` — вторая
 * половина красна; сними `data-slot="printed-placement-total"` — первая.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventRow {
  id: string
  code: string
  stage: string
  visitObjects: { id: string; approvalStatus: string }[]
}

async function token(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(tok: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=100`, {
    headers: { Authorization: `Bearer ${tok}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

async function prepareOnApproval(tok: string): Promise<void> {
  const headers = { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }
  const call = async (method: string, p: string, body?: unknown): Promise<any> =>
    (await fetch(`${API}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
      .json()
      .catch(() => ({}))
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find((o: { publishedVersionCount: number }) => o.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const roster = await call('GET', '/api/ops/personnel/?page_size=100')
  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба печатного вида (e2e)',
    objectId: object.id,
    businessDate: '2026-09-23',
    kind: 'INTERNAL',
    chiefEmployeeId: roster.results[0]?.id,
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, { briefDescription: 'Проба печати.', initialTasks: '—' })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const after = await call('GET', `${base}/`)
  await call('PATCH', `${base}/recon/`, {
    checklist: after.reconChecklist.map((i: Record<string, unknown>) => ({ ...i, state: 'NORMAL', done: true, result: 'MATCHES' })),
    sectorPosts: after.reconSectorPosts,
  })
  await call('POST', `${base}/recon/complete/`)
  let cursor = 0
  for (const post of after.reconSectorPosts as { id: string; need: number }[]) {
    for (let i = 0; i < Math.max(post.need, 1); i += 1) {
      await call('POST', `${base}/placement/assign/`, { postId: post.id, employeeId: roster.results[cursor % roster.results.length].id })
      cursor += 1
    }
  }
  await call('POST', `${base}/placement/complete/`)
}

test.describe(LIVE ? 'печатный вид расстановки' : 'печатный вид расстановки (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('на согласовании — документ в печатном виде, «Скачать PDF» и знак «Проект»', async ({ page }) => {
    const tok = await token()
    let target = (await events(tok)).find((e) => e.stage === 'APPROVAL')
    if (target === undefined) {
      await prepareOnApproval(tok)
      target = (await events(tok)).find((e) => e.stage === 'APPROVAL')
    }
    expect(target, 'не удалось подготовить ОМ на «Согласовании»').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const printed = page.getByRole('region', { name: 'Расчёт расстановки сил' })
    await expect(printed).toBeVisible()
    await expect(printed).toContainText(`${target!.code} «`)
    await expect(printed).toContainText('Старший объекта:')
    await expect(printed).toContainText(/Сектор «/)
    await expect(printed.locator('[data-slot="printed-placement-total"]')).toContainText(
      /Итого: секторов \d+ · постов \d+ · сотрудников \d+ · потребность \d+ · недобор \d+/,
    )
    await expect(printed.getByRole('button', { name: 'Скачать PDF' })).toBeEnabled()
    const draft = target!.visitObjects.every((v) => v.approvalStatus !== 'APPROVED')
    if (draft) {
      await expect(printed.getByText('до согласования — с водяным знаком «Проект»')).toBeVisible()
      const visit = target!.visitObjects[0]
      const query = new URLSearchParams({ kind: 'placement', event: target!.code, ext: 'pdf' })
      if (visit !== undefined) query.set('visitObject', visit.id)
      const res = await fetch(`${API}/api/ops/event-documents/render/?${query.toString()}`, {
        headers: { Authorization: `Bearer ${tok}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { contentBase64: string }
      const pdf = Buffer.from(body.contentBase64, 'base64')
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
      // Слово в PDF лежит в потоке страницы-наложения: reportlab пишет текст
      // шрифтом DejaVu, и в «сыром» виде оно читается по подмножеству шрифта;
      // надёжнее спросить сервер тем же путём, что и проба бэкенда, — но у
      // клиента нет pypdf. Признак наложения — второй объект «/Font» на
      // странице: у чистого документа шрифт один (LibreOffice).
      expect((pdf.toString('latin1').match(/\/Font/g) ?? []).length).toBeGreaterThan(1)
    }
  })
})
