// Story 14.11j: MSW handlers для существующего (не pending-contract)
// /api/operations/duty-plans/ — dev:mock demo-режим не имеет живого бэка
// (прецедент personnel/mocks/handlers.ts). Только create/list — approve/
// cancel/replan/validate/conflicts/shifts приезжают с 14.11k/l.
import { http, HttpResponse } from 'msw'
import { DUTY_PLANS } from './fixtures'
import type { DutyPlanFixture } from './fixtures'

let nextId = DUTY_PLANS.length + 1

export const dutyPlansHandlers = [
  http.get('*/api/operations/duty-plans/', () =>
    HttpResponse.json({
      count: DUTY_PLANS.length,
      next: null,
      previous: null,
      results: DUTY_PLANS,
    }),
  ),
  http.post('*/api/operations/duty-plans/', async ({ request }) => {
    const body = (await request.json()) as { object: number; year: number; month: number }
    const duplicate = DUTY_PLANS.some(
      (p) => p.object === body.object && p.year === body.year && p.month === body.month,
    )
    if (duplicate) {
      return HttpResponse.json(
        {
          error_code: 'DUTY_PLAN_ALREADY_EXISTS',
          message: 'План на этот месяц уже существует.',
          details: {},
          request_id: null,
          timestamp: new Date().toISOString(),
        },
        { status: 409 },
      )
    }
    const now = new Date().toISOString()
    const plan: DutyPlanFixture = {
      id: nextId++,
      object: body.object,
      year: body.year,
      month: body.month,
      status_code: 'DRAFT',
      created_at: now,
      updated_at: now,
    }
    DUTY_PLANS.push(plan)
    return HttpResponse.json(plan, { status: 201 })
  }),
]
