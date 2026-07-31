// Story 14.11j: demo-фикстуры для dev:mock-режима (реального бэка нет в
// mock-режиме, как и у всех фич на реальной схеме — прецедент
// personnel/mocks/fixtures.ts).
export interface DutyPlanFixture {
  id: number
  object: number
  year: number
  month: number
  status_code: 'DRAFT' | 'APPROVED'
  created_at: string
  updated_at: string
}

export const DUTY_PLANS: DutyPlanFixture[] = [
  {
    id: 1,
    object: 1,
    year: 2026,
    month: 8,
    status_code: 'DRAFT',
    created_at: '2026-07-20T09:00:00Z',
    updated_at: '2026-07-20T09:00:00Z',
  },
  {
    id: 2,
    object: 1,
    year: 2026,
    month: 7,
    status_code: 'APPROVED',
    created_at: '2026-06-20T09:00:00Z',
    updated_at: '2026-06-25T09:00:00Z',
  },
]

// Story 14.11k: смены плана (грид детали).
export interface DutyShiftFixture {
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
  created_at: string
  updated_at: string
}

export const DUTY_SHIFTS: DutyShiftFixture[] = [
  {
    id: 1,
    plan: 1,
    employee_id: '11111111-1111-1111-1111-111111111111',
    post: 1,
    duty_type: 1,
    duty_role_code: 'SENIOR',
    notes: '',
    starts_at: '2026-08-01T08:00:00Z',
    ends_at: '2026-08-01T20:00:00Z',
    cancelled_at: null,
    cancelled_by: null,
    cancelled_reason: '',
    created_at: '2026-07-20T09:00:00Z',
    updated_at: '2026-07-20T09:00:00Z',
  },
]
