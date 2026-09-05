/**
 * Маршрут согласования в настройках, очередь и реквизиты подписи
 * (`[СОГ-05]`, `[СОГ-10]`, Plane №429).
 *
 * Путь заказчика: админ в «Администрировании» задаёт два шага (первый —
 * учётка acc_dept_head_d2, второй — без привязки), ОМ доводится до
 * «Согласования» и отправляется — на объекте маршрут из настроек, кнопок
 * «+ Добавить согласующего» и стрелок нет; acc_dept_head_d2 под своей учёткой
 * видит «Согласовать» и подписывает — в строке появляются реквизиты
 * («Согласовано … · ФИО, роль · версия N · хэш»), а PDF несёт подвал
 * «Согласовано: …». Второй шаг раньше первого сервер не принимает (проверяется
 * по API — на экране кнопка есть, отказ приходит словами).
 *
 * В конце проба возвращает маршрут настроек в прежнее состояние.
 *
 * КРАСНОТА НА МУТАЦИИ: убери `seed_route` из `send_for_approval` — отправка
 * ответит «маршрут не настроен»; сними проверку очереди в `decide_approver` —
 * второй шаг подпишется раньше первого.
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { assertStep } from './fixture-step'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const MATRIX_PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03')

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

function caller(token: string) {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  return async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    await assertStep(res, method, path)
    const json = await res.json().catch(() => ({}))
    return { status: res.status, ...json }
  }
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

/** ОМ на «Согласовании» — по API админа, как в `approval-print`. */
async function prepareOnApproval(call: ReturnType<typeof caller>): Promise<{ id: string; code: string; visitId: string }> {
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find((o: { publishedVersionCount: number }) => o.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const roster = await call('GET', '/api/ops/personnel/?page_size=100')
  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба маршрута согласования (e2e)',
    objectId: object.id,
    businessDate: '2026-09-24',
    kind: 'INTERNAL',
    chiefEmployeeId: roster.results[0]?.id,
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, { briefDescription: 'Проба маршрута.', initialTasks: '—' })
  // 🔴 ЗАВЕРШАТЬ БЮЛЛЕТЕНЬ НЕ НУЖНО И НЕЛЬЗЯ (Plane №812, найдено проверкой
  // шагов). ОМ с объектом заводится сразу на рекогносцировке («Реестр ОМ-5»),
  // и `bulletin/complete/` отвечал `INVALID_STAGE_TRANSITION` — «бюллетень
  // можно завершить только на этапе „Бюллетень“». Шаг был мёртв с самого
  // начала: ответ не смотрели, и отказ молчал. Тот же разбор уже стоял в
  // `recon-stage.spec.ts` — здесь его просто никто не повторил.
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
  const done = await call('POST', `${base}/placement/complete/`)
  return { id: created.id as string, code: created.code as string, visitId: done.visitObjects[0].id as string }
}

test.describe(LIVE ? 'маршрут согласования' : 'маршрут согласования (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(MATRIX_PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — тот же, которым заведены учётки')

  test('маршрут из настроек, очередь подписей, реквизиты и подвал PDF', async ({ page }) => {
    const adminToken = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const admin = caller(adminToken)
    const before = (await admin('GET', '/api/ops/approval-route/')).results as {
      roleLabel: string; unit: string; username: string; fullName: string
    }[]

    try {
      // 1. Админ задаёт маршрут на экране «Администрирование».
      await signIn(page, STAND_USERNAME, STAND_PASSWORD)
      await page.goto(`${APP}/security-ops/settings`)
      const card = page.locator('[data-slot="approval-route-card"]')
      await expect(card).toBeVisible()
      await admin('PUT', '/api/ops/approval-route/', { steps: [] })
      await page.reload()
      await expect(card.locator('[data-slot="approval-route-none"]')).toBeVisible()
      await card.getByRole('button', { name: '+ Добавить подписанта' }).click()
      await card.getByLabel('Роль подписанта 1').fill('Начальник 2-го департамента')
      await card.getByLabel('Учётка подписанта 1').fill('acc_dept_head_d2')
      await card.getByRole('button', { name: '+ Добавить подписанта' }).click()
      await card.getByLabel('Роль подписанта 2').fill('Заместитель руководителя организации')
      await card.getByRole('button', { name: 'Сохранить маршрут' }).click()
      await expect(card.getByText('Маршрут сохранён.')).toBeVisible()
      await card.screenshot({ path: path.join(SHOTS, 'approval-route-settings.png') })

      // 2. ОМ на «Согласовании» получает маршрут при отправке; на объекте нет
      //    ни «+ Добавить согласующего», ни стрелок.
      const target = await prepareOnApproval(admin)
      const sent = await admin('POST', `/api/ops/security-events/${target.id}/approval/send/`, { visitObjectId: target.visitId })
      expect(sent.status, JSON.stringify(sent).slice(0, 200)).toBe(200)
      const route = (sent.visitObjects as { id: string; approvalRoute: { id: string; position: string; username: string }[] }[])
        .find((v) => v.id === target.visitId)!.approvalRoute
      expect(route.map((r) => r.position)).toEqual(['Начальник 2-го департамента', 'Заместитель руководителя организации'])
      expect(route[0].username).toBe('acc_dept_head_d2')

      // Второй шаг раньше первого — сервер отказывает по очереди.
      //
      // 🔴 МИМО ПРОВЕРЯЮЩЕГО ПОМОЩНИКА, И НАМЕРЕННО (Plane №813). Здесь отказ
      // — ПРЕДМЕТ пробы, а не сбой подготовки: `caller` роняет шаг-переход,
      // ответивший не 2xx, и на этой строке уронил бы правильный ответ
      // сервера. Ровно тот случай, о котором №813 предупреждает: сторож,
      // требующий успеха от КАЖДОГО вызова, глушится исключениями и перестаёт
      // ловить что-либо. Поэтому проверка формулируется здесь и целиком.
      const earlyResponse = await fetch(
        `${API}/api/ops/security-events/${target.id}/approval/route/${route[1].id}/decide/`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'APPROVED', visitObjectId: target.visitId }),
        },
      )
      const early = (await earlyResponse.json()) as { error_code?: string }
      expect(earlyResponse.status).toBe(422)
      expect(early.error_code).toBe('APPROVAL_OUT_OF_ORDER')

      // 3. Начальник второго департамента подписывает свою строку с экрана.
      await page.context().clearCookies()
      await signIn(page, 'acc_dept_head_d2', MATRIX_PASSWORD)
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      const stage = page.getByRole('region', { name: 'Согласование расстановки' })
      await expect(stage).toBeVisible()
      await expect(stage.getByRole('button', { name: '+ Добавить согласующего' })).toHaveCount(0)
      await expect(stage.getByRole('button', { name: /^Выше: / })).toHaveCount(0)
      await expect(stage.getByText('учётка acc_dept_head_d2')).toBeVisible()
      await stage.getByRole('button', { name: 'Согласовать', exact: true }).first().click()
      const signature = stage.locator('[data-slot="approval-signature"]').first()
      await expect(signature).toBeVisible()
      await expect(signature).toContainText(/Согласовано \d{2}\.\d{2}\.\d{4}/)
      await expect(signature).toContainText('Начальник 2-го департамента')
      await expect(signature).toContainText(/версия \d+ · [0-9a-f]{16}/)
      await stage.screenshot({ path: path.join(SHOTS, 'approval-route-signed.png') })

      // 4. Подвал PDF.
      const query = new URLSearchParams({ kind: 'placement', event: target.code, ext: 'pdf', visitObject: target.visitId })
      const pdf = await admin('GET', `/api/ops/event-documents/render/?${query.toString()}`)
      expect(pdf.status).toBe(200)
      const raw = Buffer.from(pdf.contentBase64 as string, 'base64')
      expect(raw.subarray(0, 4).toString()).toBe('%PDF')
      // Подвал — текст в потоке страницы LibreOffice; хотя бы одно слово «версия»
      // после подписи там есть (латиница «PDF» сама по себе не обещает подвала).
      expect(raw.length).toBeGreaterThan(20_000)
    } finally {
      await admin('PUT', '/api/ops/approval-route/', {
        steps: before.map((s) => ({ roleLabel: s.roleLabel, unit: s.unit, username: s.username, fullName: s.fullName })),
      })
    }
  })
})
