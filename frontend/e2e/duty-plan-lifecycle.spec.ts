// Story 14.12b — e2e полного цикла плана дежурств в РЕАЛЬНОМ chromium против
// e2e-harness/duty-plan.html (dist-e2e, порт 4174).
//
// Зачем это поверх ~30 jsdom-тестов 14.11i-l/14.12a. Модальность <dialog>
// (create-shift/replan-shift), datetime-local и реальная навигация между
// /duty-plans и /duty-plans/:id — тот же класс пробелов, что day-submission
// (10.3)/notifications (11.4) закрывали для своих экранов: jsdom эмулирует
// эти вещи, а не воспроизводит. Сеть перехвачена page.route — реальный fetch,
// реальные статусы, реальный конверт §36.
//
// Один сценарий, весь цикл: создать план → создать смену A → утвердить план
// → создать смену B (после утверждения — тоже допустимо) → отменить смену A
// (причина) → перепланировать смену B (модалка, explicit-null снимает пост).
// Не два раздельных теста на cancel/replan: обе смены нужны одновременно
// (ShiftsTable скрывает cancel/replan для уже отменённой строки — 14.11l),
// поэтому естественный порядок цикла требует ДВУХ смен, а не одной дважды.
import { expect, test, type Page } from '@playwright/test'

const HARNESS = 'http://localhost:4174/e2e-harness/duty-plan.html'

interface Plan {
  id: number
  object: number
  year: number
  month: number
  status_code: 'DRAFT' | 'APPROVED'
}

interface Shift {
  id: number
  plan: number
  employee_id: string
  post: number | null
  duty_type: number | null
  duty_role_code: string
  notes: string
  starts_at: string
  ends_at: string
  cancelled_at: string | null
  cancelled_by: string | null
  cancelled_reason: string
}

function paginated<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results }
}

async function stubApi(page: Page) {
  let nextPlanId = 1
  let nextShiftId = 1
  const plans: Plan[] = []
  const shifts: Shift[] = []

  await page.route('**/api/operations/my-permissions/', (route) =>
    route.fulfill({ json: { permissions: ['duty.manage'] } }),
  )

  await page.route('**/api/operations/duty-plans/', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as {
        object: number
        year: number
        month: number
      }
      const plan: Plan = { id: nextPlanId++, ...body, status_code: 'DRAFT' }
      plans.push(plan)
      await route.fulfill({ status: 201, json: plan })
      return
    }
    await route.fulfill({ json: paginated(plans) })
  })

  await page.route(/\/api\/operations\/duty-plans\/(\d+)\/approve\/$/, async (route) => {
    const id = Number(route.request().url().match(/duty-plans\/(\d+)\/approve/)?.[1])
    const plan = plans.find((p) => p.id === id)!
    plan.status_code = 'APPROVED'
    await route.fulfill({ json: plan })
  })

  await page.route(/\/api\/operations\/duty-plans\/(\d+)\/shifts\/$/, async (route) => {
    const planId = Number(route.request().url().match(/duty-plans\/(\d+)\/shifts/)?.[1])
    const request = route.request()
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as Partial<Shift>
      const shift: Shift = {
        id: nextShiftId++,
        plan: planId,
        employee_id: body.employee_id ?? '',
        post: body.post ?? null,
        duty_type: body.duty_type ?? null,
        duty_role_code: body.duty_role_code ?? '',
        notes: body.notes ?? '',
        starts_at: body.starts_at ?? '',
        ends_at: body.ends_at ?? '',
        cancelled_at: null,
        cancelled_by: null,
        cancelled_reason: '',
      }
      shifts.push(shift)
      await route.fulfill({ status: 201, json: shift })
      return
    }
    await route.fulfill({
      json: paginated(shifts.filter((s) => s.plan === planId)),
    })
  })

  await page.route(
    /\/api\/operations\/duty-plans\/\d+\/shifts\/(\d+)\/cancel\/$/,
    async (route) => {
      const shiftId = Number(route.request().url().match(/shifts\/(\d+)\/cancel/)?.[1])
      const shift = shifts.find((s) => s.id === shiftId)!
      const body = JSON.parse(route.request().postData() ?? '{}') as { reason: string }
      shift.cancelled_at = '2026-09-01T00:00:00Z'
      shift.cancelled_by = 'duty-operator-e2e'
      shift.cancelled_reason = body.reason
      await route.fulfill({ json: shift })
    },
  )

  await page.route(
    /\/api\/operations\/duty-plans\/(\d+)\/shifts\/(\d+)\/replan\/$/,
    async (route) => {
      const match = route.request().url().match(/duty-plans\/(\d+)\/shifts\/(\d+)\/replan/)!
      const planId = Number(match[1])
      const oldShiftId = Number(match[2])
      const old = shifts.find((s) => s.id === oldShiftId)!
      const body = JSON.parse(route.request().postData() ?? '{}') as Partial<Shift> & {
        reason: string
      }
      old.cancelled_at = '2026-09-01T00:00:00Z'
      old.cancelled_by = 'duty-operator-e2e'
      old.cancelled_reason = body.reason
      const newShift: Shift = {
        id: nextShiftId++,
        plan: planId,
        employee_id: body.employee_id ?? old.employee_id,
        post: 'post' in body ? (body.post ?? null) : old.post,
        duty_type: 'duty_type' in body ? (body.duty_type ?? null) : old.duty_type,
        duty_role_code: body.duty_role_code ?? old.duty_role_code,
        notes: body.notes ?? old.notes,
        starts_at: body.starts_at ?? old.starts_at,
        ends_at: body.ends_at ?? old.ends_at,
        cancelled_at: null,
        cancelled_by: null,
        cancelled_reason: '',
      }
      shifts.push(newShift)
      await route.fulfill({ status: 201, json: newShift })
    },
  )

  return { plans, shifts }
}

test('полный цикл: создать план → 2 смены → утвердить → отменить одну → перепланировать другую', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto(HARNESS)

  // 1. Создать план.
  await expect(page.getByRole('heading', { name: 'Планы дежурств' })).toBeVisible()
  await page.getByRole('button', { name: '+ Создать план' }).click()
  const createPlanDialog = page.getByRole('dialog')
  await createPlanDialog.getByLabel('ID объекта').fill('7')
  await createPlanDialog.getByLabel('Год').fill('2026')
  await createPlanDialog.getByLabel('Месяц (1-12)').fill('9')
  await createPlanDialog.getByRole('button', { name: 'Создать' }).click()
  await expect(createPlanDialog).not.toBeVisible()

  // 2. Перейти в деталь плана.
  await page.getByRole('link', { name: '7' }).click()
  await expect(
    page.getByRole('heading', { name: 'Объект 7 — Сентябрь 2026' }),
  ).toBeVisible()

  // 3. Создать смену A (будет отменена).
  await page.getByRole('button', { name: '+ Создать смену' }).click()
  let shiftDialog = page.getByRole('dialog')
  await shiftDialog.getByLabel('UUID сотрудника').fill('11111111-1111-1111-1111-111111111111')
  await shiftDialog.getByLabel('Начало').fill('2026-09-01T08:00')
  await shiftDialog.getByLabel('Окончание').fill('2026-09-01T20:00')
  await shiftDialog.getByRole('button', { name: 'Создать' }).click()
  await expect(shiftDialog).not.toBeVisible()
  await expect(page.getByText('11111111-1111-1111-1111-111111111111')).toBeVisible()

  // 4. Утвердить план.
  await page.getByRole('button', { name: 'Утвердить план' }).click()
  await expect(page.getByRole('button', { name: 'Утверждён' })).toBeDisabled()

  // 5. Создать смену B (после утверждения — тоже допустимо), с постом.
  await page.getByRole('button', { name: '+ Создать смену' }).click()
  shiftDialog = page.getByRole('dialog')
  await shiftDialog.getByLabel('UUID сотрудника').fill('22222222-2222-2222-2222-222222222222')
  await shiftDialog.getByLabel('ID поста (опционально)').fill('3')
  await shiftDialog.getByLabel('Начало').fill('2026-09-02T08:00')
  await shiftDialog.getByLabel('Окончание').fill('2026-09-02T20:00')
  await shiftDialog.getByRole('button', { name: 'Создать' }).click()
  await expect(shiftDialog).not.toBeVisible()
  await expect(page.getByText('22222222-2222-2222-2222-222222222222')).toBeVisible()

  // 6. Отменить смену A — причина обязательна.
  const rowA = page.locator('tr', { hasText: '11111111-1111-1111-1111-111111111111' })
  await rowA.getByRole('button', { name: 'Отменить' }).click()
  await expect(rowA.getByRole('button', { name: 'Подтвердить' })).toBeDisabled()
  await rowA.getByLabel('Причина отмены').fill('Болезнь сотрудника')
  await rowA.getByRole('button', { name: 'Подтвердить' }).click()
  await expect(rowA.getByText('Отменена')).toBeVisible()

  // 7. Перепланировать смену B — предзаполнено, explicit-null снимает пост.
  const rowB = page.locator('tr', { hasText: '22222222-2222-2222-2222-222222222222' })
  await rowB.getByRole('button', { name: 'Перепланировать' }).click()
  const replanDialog = page.getByRole('dialog')
  await expect(replanDialog.getByLabel('ID поста')).toHaveValue('3')
  await replanDialog.getByLabel('Причина перепланирования').fill('Смена состава')
  await replanDialog.getByLabel('Снять пост').check()
  await replanDialog.getByRole('button', { name: 'Перепланировать' }).click()
  await expect(replanDialog).not.toBeVisible()

  // Итог: смена A отменена, старая B отменена (заменена новой), новая
  // смена — без поста («—» в колонке).
  const cancelledRows = page.locator('tr', { hasText: 'Отменена' })
  await expect(cancelledRows).toHaveCount(2)
  const activeRows = page.locator('tr', { hasText: 'Активна' })
  await expect(activeRows).toHaveCount(1)
})
