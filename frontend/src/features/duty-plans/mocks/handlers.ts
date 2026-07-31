// Story 14.11j/k: MSW handlers для существующего (не pending-contract)
// /api/operations/duty-plans/ — dev:mock demo-режим не имеет живого бэка
// (прецедент personnel/mocks/handlers.ts). create/list/shifts(list+create) —
// approve/cancel/replan/validate/conflicts приезжают с 14.11l.
import { http, HttpResponse } from 'msw'
import { DUTY_PLANS, DUTY_SHIFTS } from './fixtures'
import type { DutyPlanFixture, DutyShiftFixture } from './fixtures'

let nextId = DUTY_PLANS.length + 1
let nextShiftId = DUTY_SHIFTS.length + 1

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
  http.get('*/api/operations/duty-plans/:id/shifts/', ({ params }) => {
    const planId = Number(params.id)
    const shifts = DUTY_SHIFTS.filter((s) => s.plan === planId)
    return HttpResponse.json({ count: shifts.length, next: null, previous: null, results: shifts })
  }),
  http.post('*/api/operations/duty-plans/:id/shifts/', async ({ params, request }) => {
    const planId = Number(params.id)
    const body = (await request.json()) as Omit<
      DutyShiftFixture,
      'id' | 'plan' | 'cancelled_at' | 'cancelled_by' | 'cancelled_reason' | 'created_at' | 'updated_at'
    >
    const now = new Date().toISOString()
    const shift: DutyShiftFixture = {
      id: nextShiftId++,
      plan: planId,
      employee_id: body.employee_id,
      post: body.post ?? null,
      duty_type: body.duty_type ?? null,
      duty_role_code: body.duty_role_code ?? '',
      notes: body.notes ?? '',
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      cancelled_at: null,
      cancelled_by: null,
      cancelled_reason: '',
      created_at: now,
      updated_at: now,
    }
    DUTY_SHIFTS.push(shift)
    return HttpResponse.json(shift, { status: 201 })
  }),
]
