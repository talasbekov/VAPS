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
