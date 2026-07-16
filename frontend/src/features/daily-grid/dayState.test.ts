// Story 10.3 — юнит-тесты маппера day-state → вью-модель панели (Task 3):
// unsubmitted/submitted/submitted+drift, defensive-чтение drift (schema несёт
// unknown), резолв ФИО с fallback на id, строки changed «from → to».
import { describe, expect, it } from 'vitest'

import type { DayStateResponse, DaySubmission } from './dayState'
import { driftRows, readDrift, selectDayState } from './dayState'

const DIVISION = 'd1b2c3d4-0000-0000-0000-000000000001'
const OTHER = 'd1b2c3d4-0000-0000-0000-000000000002'

const submission: DaySubmission = {
  id: 7,
  division_id: DIVISION,
  business_date: '2026-07-16',
  version: 2,
  is_current: true,
  event: 'CONFIRMED_NO_CHANGES',
  submitted_by: 'op-1',
  submitted_at: '2026-07-16T08:30:00+05:00',
  late: true,
}

function response(overrides: Partial<DayStateResponse>): DayStateResponse {
  return {
    divisions: [
      { division_id: DIVISION, name: 'Отдел А', submission: null },
      { division_id: OTHER, name: 'Отдел Б', submission: null },
    ],
    detail: null,
    ...overrides,
  }
}

describe('readDrift — defensive-чтение shape 5.5a', () => {
  it('валидный drift парсится: added/removed/changed', () => {
    const drift = readDrift({
      added: ['e-new'],
      removed: ['e-gone'],
      changed: [{ employee_id: 'e1', from: 'IN_SERVICE', to: 'DUTY' }],
    })
    expect(drift).toEqual({
      added: ['e-new'],
      removed: ['e-gone'],
      changed: [{ employeeId: 'e1', from: 'IN_SERVICE', to: 'DUTY' }],
    })
  })

  it('null/мусор → null; кривые строки changed отбрасываются', () => {
    expect(readDrift(null)).toBeNull()
    expect(readDrift('мусор')).toBeNull()
    expect(readDrift(42)).toBeNull()
    const partial = readDrift({
      added: 'не-массив',
      changed: [{ from: 'A', to: 'B' }, 'мусор'],
    })
    expect(partial).toEqual({ added: [], removed: [], changed: [] })
  })
})

describe('selectDayState — вью-модель выбранного подразделения', () => {
  it('несдано: submission null + detail.preview_event → unsubmitted', () => {
    const state = selectDayState(
      response({
        detail: { preview_event: 'CHANGED', traffic_light: null },
      }),
      DIVISION,
    )
    expect(state).toEqual({ kind: 'unsubmitted', previewEvent: 'CHANGED' })
  })

  it('сдано без drift: submission + traffic_light GREEN/drift null', () => {
    const state = selectDayState(
      response({
        divisions: [{ division_id: DIVISION, name: 'Отдел А', submission }],
        detail: {
          preview_event: null,
          traffic_light: { status: 'GREEN', late: true, drift: null },
        },
      }),
      DIVISION,
    )
    expect(state).toEqual({
      kind: 'submitted',
      submission,
      trafficLight: { status: 'GREEN', late: true, drift: null },
    })
  })

  it('сдано + drift YELLOW: drift распарсен в DriftDetails', () => {
    const state = selectDayState(
      response({
        divisions: [{ division_id: DIVISION, name: 'Отдел А', submission }],
        detail: {
          preview_event: null,
          traffic_light: {
            status: 'YELLOW',
            late: false,
            drift: {
              added: [],
              removed: [],
              changed: [{ employee_id: 'e2', from: 'DUTY', to: 'SICK_LEAVE' }],
            },
          },
        },
      }),
      DIVISION,
    )
    expect(state).not.toBeNull()
    if (state?.kind !== 'submitted') throw new Error('ожидалось submitted')
    expect(state.trafficLight?.status).toBe('YELLOW')
    expect(state.trafficLight?.drift?.changed).toEqual([
      { employeeId: 'e2', from: 'DUTY', to: 'SICK_LEAVE' },
    ])
  })

  it('сдано, detail отсутствует (list-режим) → trafficLight null', () => {
    const state = selectDayState(
      response({
        divisions: [{ division_id: DIVISION, name: 'Отдел А', submission }],
      }),
      DIVISION,
    )
    expect(state).toEqual({ kind: 'submitted', submission, trafficLight: null })
  })

  it('подразделение вне списка → null', () => {
    expect(selectDayState(response({}), 'нет-такого')).toBeNull()
  })
})

describe('driftRows — резолв ФИО + fallback id, from → to', () => {
  const names = { e1: 'Асанов', e2: 'Борисов' }

  it('added/removed/changed с ФИО из словаря', () => {
    const rows = driftRows(
      {
        added: ['e1'],
        removed: ['e2'],
        changed: [{ employeeId: 'e1', from: 'IN_SERVICE', to: 'DUTY' }],
      },
      names,
    )
    expect(rows.map((r) => r.label)).toEqual([
      'Асанов — появился в расходе',
      'Борисов — выбыл из расхода',
      'Асанов: IN_SERVICE → DUTY',
    ])
    // ключи уникальны (React key)
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('id вне словаря → показывается сам id (AC-12 fallback)', () => {
    const rows = driftRows(
      { added: ['e-unknown'], removed: [], changed: [] },
      names,
    )
    expect(rows[0].label).toBe('e-unknown — появился в расходе')
  })
})
