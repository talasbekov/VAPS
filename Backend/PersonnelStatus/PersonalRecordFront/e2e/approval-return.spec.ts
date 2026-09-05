/**
 * Возврат на доработку: модалка с замечаниями, авто-«Срочно», diff версий
 * (`[ВОЗ-01]`, `[ВОЗ-02]`, `[ВОЗ-06]`, Plane №431).
 *
 * Путь заказчика: на «Согласовании» согласующий нажимает «Вернуть» — модалка
 * «Вернуть на доработку»: общая причина, «+ Замечание» дважды (одно к посту,
 * второе общее со «Срочно»), «Подтвердить возврат». Объект уходит на этап 2
 * с двумя замечаниями. После ответа старшего и повторной отправки история
 * версий показывает v2 с diff против v1 («изменений нет» или замена).
 * В «Администрировании» появилась секция «Политика согласования» с порогом.
 *
 * Фикстура: ОМ на «Согласовании» с отправленным маршрутом — по API админа,
 * маршрут настроек на время пробы — один шаг без учётки.
 *
 * КРАСНОТА НА МУТАЦИИ: убери `remarks` из тела decide на клиенте — второе
 * замечание не заведётся; сними `diff` из сериализатора — v2 без строки diff.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { assertStep } from './fixture-step'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

function caller(token: string) {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  return async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    await assertStep(res, method, path)
    const json = await res.json().catch(() => ({}))
    return { status: res.status, ...json }
  }
}

async function token(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

async function prepareSent(call: ReturnType<typeof caller>): Promise<{ id: string; visitId: string; postId: string }> {
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find((o: { publishedVersionCount: number }) => o.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const roster = await call('GET', '/api/ops/personnel/?page_size=100')
  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба модалки возврата (e2e)',
    objectId: object.id,
    businessDate: '2026-09-26',
    kind: 'INTERNAL',
    chiefEmployeeId: roster.results[0]?.id,
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, { briefDescription: 'Проба возврата.', initialTasks: '—' })
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
  const visitId = done.visitObjects[0].id as string
  const sent = await call('POST', `${base}/approval/send/`, { visitObjectId: visitId })
  if (sent.status !== 200) throw new Error(`отправка не прошла: ${JSON.stringify(sent).slice(0, 200)}`)
  return { id: created.id as string, visitId, postId: after.reconSectorPosts[0].id as string }
}

test.describe(LIVE ? 'модалка возврата' : 'модалка возврата (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('возврат с двумя замечаниями, затем v2 с diff; порог срочности в настройках', async ({ page }) => {
    const admin = caller(await token())
    const before = (await admin('GET', '/api/ops/approval-route/')).results as { roleLabel: string; unit: string; username: string; fullName: string }[]
    await admin('PUT', '/api/ops/approval-route/', { steps: [{ roleLabel: 'Проба: согласующий' }] })
    try {
      const target = await prepareSent(admin)

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      const stage = page.getByRole('region', { name: 'Согласование расстановки' })
      await expect(stage).toBeVisible()
      await stage.getByRole('button', { name: 'Вернуть', exact: true }).first().click()
      const dialog = page.locator('[data-slot="return-dialog"]')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Общая причина *').fill('Состав не соответствует расчёту')
      await dialog.getByRole('button', { name: '+ Замечание' }).click()
      await dialog.getByLabel('Текст замечания 1').fill('Пост без старшего')
      await dialog.getByLabel('Пост замечания 1').selectOption({ index: 1 })
      await dialog.getByRole('button', { name: '+ Замечание' }).click()
      await dialog.getByLabel('Текст замечания 2').fill('Нет резерва')
      await dialog.getByLabel('Срочно 2').check()
      await dialog.getByRole('button', { name: 'Подтвердить возврат' }).click()
      await expect(dialog).toBeHidden()

      const fresh = await admin('GET', `/api/ops/security-events/${target.id}/`)
      const visit = (fresh.visitObjects as { id: string; approvalStatus: string; approvalRemarks: { text: string; postId: string | null; urgent: boolean }[] }[]).find((v) => v.id === target.visitId)!
      expect(visit.approvalStatus).toBe('RETURNED')
      expect(visit.approvalRemarks.map((r) => r.text)).toEqual(['Пост без старшего', 'Нет резерва'])
      expect(visit.approvalRemarks[0].postId).not.toBeNull()
      expect(visit.approvalRemarks[1].urgent).toBe(true)

      // Ответ старшего, повторная отправка → v2 с diff.
      for (const remark of (visit.approvalRemarks as unknown as { id: string }[])) {
        await admin('POST', `/api/ops/security-events/${target.id}/approval/remarks/${remark.id}/resolve/`, {
          decision: 'RESOLVED', visitObjectId: target.visitId,
        })
      }
      await admin('POST', `/api/ops/security-events/${target.id}/placement/complete/`, { visitObjectId: target.visitId })
      const resent = await admin('POST', `/api/ops/security-events/${target.id}/approval/send/`, { visitObjectId: target.visitId })
      expect(resent.status, JSON.stringify(resent).slice(0, 200)).toBe(200)
      await page.reload()
      const history = page.getByRole('region', { name: 'История версий документа' })
      await expect(history).toBeVisible()
      await expect(history).toContainText('v2')
      await expect(history.locator('[data-slot="version-diff"]').first()).toContainText(/Изменений против предыдущей версии нет|→|пост/)

      // 🔴 «ОТМЕНА» ЗАБЫВАЕТ НАБРАННОЕ (Plane №667). Окно возврата ОДНО на
      // весь маршрут, а кого возвращаем, помнит `returnFor`. До правки
      // «Отмена» и Esc чистили только его: причина и список замечаний
      // сбрасывались лишь после УСПЕШНОГО возврата, и брошенный черновик
      // всплывал при следующем открытии — уже против другой строки
      // согласующего. Проверяем оба способа закрытия: кнопкой и клавишей.
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      await expect(stage).toBeVisible()
      const returnAgain = stage.getByRole('button', { name: 'Вернуть', exact: true }).first()
      await returnAgain.click()
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Общая причина *').fill('Брошенный черновик')
      await dialog.getByRole('button', { name: '+ Замечание' }).click()
      await dialog.getByLabel('Текст замечания 1').fill('Замечание, которое не должно всплыть')
      await dialog.getByRole('button', { name: 'Отмена' }).click()
      await expect(dialog).toBeHidden()

      await returnAgain.click()
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByLabel('Общая причина *'),
        'причина прошлого, отменённого возврата всплыла в новом окне',
      ).toHaveValue('')
      await expect(
        dialog.getByLabel('Текст замечания 1'),
        'брошенное замечание всплыло и уехало бы против другой строки маршрута',
      ).toHaveCount(0)

      // Esc — тот же путь закрытия, и забывать обязан так же.
      await dialog.getByLabel('Общая причина *').fill('Второй брошенный черновик')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await returnAgain.click()
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByLabel('Общая причина *'),
        'Esc закрыл окно, но набранное осталось',
      ).toHaveValue('')
      await page.keyboard.press('Escape')

      // Порог срочности — в «Администрировании».
      await page.goto(`${APP}/security-ops/settings`)
      await expect(page.getByText('Политика согласования')).toBeVisible()
      await expect(page.getByText('Срочность возврата: порог в днях')).toBeVisible()
    } finally {
      await admin('PUT', '/api/ops/approval-route/', {
        steps: before.map((s) => ({ roleLabel: s.roleLabel, unit: s.unit, username: s.username, fullName: s.fullName })),
      })
    }
  })
})
