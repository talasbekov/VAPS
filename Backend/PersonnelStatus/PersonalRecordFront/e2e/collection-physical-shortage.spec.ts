/** Plane №1129: UI получает уже посчитанный сервером только физический итог. */
import { expect, test, type Page } from '@playwright/test'

const APP = process.env.SMOKE_APP!
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD!

async function signInAsHeadquarters(page: Page) {
  const csrf = await (await page.context().request.get(`${APP}/api/auth/csrf/`)).json()
  const login = await page.context().request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'acc_ops_staff', password: PASSWORD, json: 'true' },
  })
  expect((await login.json()).url).not.toContain('error=')
}

test('№1129: Штаб видит 2 физсотрудника и 2 спецгруппы без ложного физического недобора', async ({ page }) => {
  await signInAsHeadquarters(page)
  const collection = {
    eventId: '1129', code: 'ОМ-1129', title: 'Смешанный состав', businessDate: '2026-09-15',
    location: 'Дворец', eventTime: null, stage: 'FORCES', need: 2, allocated: 2, gathered: 2,
    remaining: 0, collectionStatus: 'ANSWERED', urgent: false,
    boardStatus: { code: 'ANSWERED', label: 'Ответы получены 1 из 1' },
    needByObject: [{ visitObjectId: 'o1129', objectName: 'Дворец', need: 2, statusLabel: 'Завершена', chiefName: '' }],
    demandRows: [
      { id: 'physical', kindCode: 'PHYSICAL_SQUAD', need: 2, visitObjectId: 'o1129', place: 'Периметр' },
      { id: 'screening', kindCode: 'SCREENING_GROUP', need: 2, visitObjectId: 'o1129', place: 'Вход', specification: 'Досмотр' },
    ],
    allocations: [{
      id: 'a1129', departmentId: '631', departmentName: 'Первый департамент', need: 2,
      allocating: 2, sent: 2, status: 'SUBMITTED', sentAt: '2026-09-10T10:00:00Z',
      members: [
        { employeeId: 'physical-1', name: 'Физический 1', kindCode: 'PHYSICAL_SQUAD', divisionName: 'Управление', source: 'STATUS' },
        { employeeId: 'physical-2', name: 'Физический 2', kindCode: 'PHYSICAL_SQUAD', divisionName: 'Управление', source: 'STATUS' },
        { employeeId: 'group-1', name: 'Досмотр 1', kindCode: 'SCREENING_GROUP', divisionName: 'Управление', source: 'STATUS' },
        { employeeId: 'group-2', name: 'Досмотр 2', kindCode: 'SCREENING_GROUP', divisionName: 'Управление', source: 'STATUS' },
      ], groupDemands: [{ id: 'screening', kindCode: 'SCREENING_GROUP', need: 2, place: 'Вход', specification: 'Досмотр' }],
    }],
    totals: { need: 2, requested: 2, allocating: 2, sent: 2, shortage: 0 }, roster: [], objects: [], handover: {},
  }
  await page.route(url => url.pathname.endsWith('/force-collection/'), route => route.fulfill({ json: collection }))
  await page.goto(`${APP}/employees?view=forces&tab=collections&collection=1129`)
  await expect(page.getByRole('heading', { name: 'Смешанный состав', exact: true })).toBeVisible()
  const totals = page.locator('[data-slot="collection-totals"]')
  await expect(totals).toContainText('прислано 2')
  await expect(totals).toContainText('недобор 0')
  await expect(page.getByLabel('Потребность в специальных группах').getByText('Досмотр · 2 · Вход', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'smoke-results/1129-mixed-physical-shortage.png', fullPage: true, animations: 'disabled' })
})
