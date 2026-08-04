// Story 16.8h1: demo-фикстуры для dev:mock-режима (реального бэка нет в
// mock-режиме, прецедент duty-plans/mocks/fixtures.ts).
export interface PlacementAssignmentFixture {
  id: number
  employee_id: string
  post: number
  conflict_severity: 'SOFT' | 'HARD' | ''
  conflict_codes: string[]
  acknowledged_at: string | null
  ack_escalated_at: string | null
}

export interface AssignmentVersionFixture {
  id: number
  event: number
  status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED'
  version: number
  is_current: boolean
  signature_hash: string
  created_at: string
  updated_at: string
  assignments: PlacementAssignmentFixture[]
}

// Story 17.7c: demo-фикстуры журнала штаба (17.7a's реальная схема).
export interface JournalEntryFixture {
  id: number
  event: number
  entry_type: 'BRIEFING' | 'DIRECTIVE' | 'INCIDENT'
  text: string
  post: number | null
  participant_ids: string[]
  photo_attachment_id: string | null
  created_by: string | null
  created_at: string
}

export const JOURNAL_ENTRIES: JournalEntryFixture[] = [
  {
    id: 1,
    event: 1,
    entry_type: 'BRIEFING',
    text: 'Инструктаж проведён, личный состав ознакомлен.',
    post: null,
    participant_ids: [],
    photo_attachment_id: null,
    created_by: 'demo-omd',
    created_at: '2026-08-01T09:15:00Z',
  },
]

export const ASSIGNMENT_VERSIONS: AssignmentVersionFixture[] = [
  {
    id: 1,
    event: 1,
    status: 'DRAFT',
    version: 1,
    is_current: true,
    signature_hash: '',
    created_at: '2026-08-01T09:00:00Z',
    updated_at: '2026-08-01T09:00:00Z',
    assignments: [
      {
        id: 1,
        employee_id: '11111111-1111-1111-1111-111111111111',
        post: 1,
        conflict_severity: '',
        conflict_codes: [],
        acknowledged_at: null,
        ack_escalated_at: null,
      },
    ],
  },
]
