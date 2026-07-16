// Story 10.3 — юнит-тесты маппера day-state → вью-модель панели (Task 3):
// unsubmitted/submitted/submitted+drift, defensive-чтение drift (schema несёт
// unknown), резолв ФИО с fallback на id, строки changed «from → to».
// Story 10.6 (Task 4/5): defensive-ридеры amendment/summary, amendment/summary
// в submitted-вью-модели, «серверная строка побеждает» (AC-11а как чистая
// деривация resolvePanelState), строки осей сводки summaryRows (AC-10).
import { describe, expect, it } from 'vitest'

import type { DayStateResponse, DaySubmission, SelectedDayState } from './dayState'
import {
  driftRows,
  readAmendment,
  readDrift,
  readSummary,
  resolvePanelState,
  selectDayState,
  summaryRows,
} from './dayState'

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
        detail: {
          preview_event: 'CHANGED',
          traffic_light: null,
          amendment: null,
          summary: null,
        },
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
          amendment: null,
          summary: null,
        },
      }),
      DIVISION,
    )
    expect(state).toEqual({
      kind: 'submitted',
      submission,
      trafficLight: { status: 'GREEN', late: true, drift: null },
      amendment: null,
      summary: null,
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
          amendment: null,
          summary: null,
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
    expect(state).toEqual({
      kind: 'submitted',
      submission,
      trafficLight: null,
      amendment: null,
      summary: null,
    })
  })

  it('подразделение вне списка → null', () => {
    expect(selectDayState(response({}), 'нет-такого')).toBeNull()
  })

  it('amendment/summary из detail попадают в submitted-вью-модель (10.6)', () => {
    const amended: DaySubmission = { ...submission, event: 'AMENDED' }
    const state = selectDayState(
      response({
        divisions: [
          { division_id: DIVISION, name: 'Отдел А', submission: amended },
        ],
        detail: {
          preview_event: null,
          traffic_light: { status: 'GREEN', late: false, drift: null },
          amendment: { reason: 'ретро-правка', sanction: 'выговор' },
          summary: {
            status: 'STALE',
            superseded: [
              {
                division_id: OTHER,
                pinned_version: 1,
                current_version: 2,
              },
            ],
            missing: [],
            unpinned: [],
          },
        },
      }),
      DIVISION,
    )
    if (state?.kind !== 'submitted') throw new Error('ожидалось submitted')
    expect(state.amendment).toEqual({
      reason: 'ретро-правка',
      sanction: 'выговор',
    })
    expect(state.summary).toEqual({
      status: 'STALE',
      superseded: [
        { divisionId: OTHER, pinnedVersion: 1, currentVersion: 2 },
      ],
      missing: [],
      unpinned: [],
    })
  })
})

// --- 10.6: defensive-ридеры amendment/summary (зеркало readDrift) -----------------

describe('readAmendment — defensive-чтение блока 10.6', () => {
  it('валидный блок парсится; кривой/null → null', () => {
    expect(readAmendment({ reason: 'р', sanction: 'с' })).toEqual({
      reason: 'р',
      sanction: 'с',
    })
    expect(readAmendment(null)).toBeNull()
    expect(readAmendment('мусор')).toBeNull()
    expect(readAmendment({ reason: 42, sanction: 'с' })).toBeNull()
    expect(readAmendment({ reason: 'р' })).toBeNull()
  })
})

describe('readSummary — defensive-чтение блока 10.6', () => {
  it('валидный блок парсится: status + три оси', () => {
    expect(
      readSummary({
        status: 'STALE',
        superseded: [
          { division_id: 'd1', pinned_version: 1, current_version: 3 },
        ],
        missing: [{ division_id: 'd2', pinned_version: 2 }],
        unpinned: ['d3'],
      }),
    ).toEqual({
      status: 'STALE',
      superseded: [{ divisionId: 'd1', pinnedVersion: 1, currentVersion: 3 }],
      missing: [{ divisionId: 'd2', pinnedVersion: 2 }],
      unpinned: ['d3'],
    })
  })

  it('null/мусор → null; кривые строки осей отбрасываются', () => {
    expect(readSummary(null)).toBeNull()
    expect(readSummary('мусор')).toBeNull()
    expect(readSummary({ superseded: [] })).toBeNull() // без status — не блок
    expect(
      readSummary({
        status: 'FRESH',
        superseded: [{ division_id: 42 }, 'мусор'],
        missing: 'не-массив',
        unpinned: [7, 'd3'],
      }),
    ).toEqual({ status: 'FRESH', superseded: [], missing: [], unpinned: ['d3'] })
  })
})

// --- 10.6 AC-11(а): серверная строка побеждает локальный 201 ----------------------

describe('resolvePanelState — server-priority деривация (AC-11а)', () => {
  const local: DaySubmission = { ...submission, version: 1, event: 'CHANGED' }
  const serverSubmitted: SelectedDayState = {
    kind: 'submitted',
    submission: { ...submission, version: 2, event: 'AMENDED' },
    trafficLight: { status: 'GREEN', late: false, drift: null },
    amendment: { reason: 'чужая пересдача', sanction: 'указание' },
    summary: null,
  }

  it('без локального 201 → серверное состояние как есть', () => {
    expect(resolvePanelState(serverSubmitted, null)).toBe(serverSubmitted)
    expect(resolvePanelState(null, null)).toBeNull()
  })

  it('server.version >= local.version → серверная строка (чужой amendment виден)', () => {
    const state = resolvePanelState(serverSubmitted, local)
    if (state?.kind !== 'submitted') throw new Error('ожидалось submitted')
    expect(state.submission.version).toBe(2)
    expect(state.submission.event).toBe('AMENDED')
    expect(state.amendment).toEqual({
      reason: 'чужая пересдача',
      sanction: 'указание',
    })
  })

  it('равные версии → серверная строка (не застывший локальный 201)', () => {
    const serverV1: SelectedDayState = {
      kind: 'submitted',
      submission: { ...submission, version: 1, event: 'CHANGED' },
      trafficLight: { status: 'YELLOW', late: false, drift: null },
      amendment: null,
      summary: null,
    }
    const state = resolvePanelState(serverV1, local)
    expect(state).toBe(serverV1)
  })

  it('сервер ещё отстаёт (unsubmitted/старее) → локальный 201 БЕЗ стейл-деталей', () => {
    // Сервер ещё не догнал 201 (keepPreviousData/инвалидация в полёте).
    const state = resolvePanelState(null, { ...local, version: 2 })
    expect(state).toEqual({
      kind: 'submitted',
      submission: { ...local, version: 2 },
      trafficLight: null,
      amendment: null,
      summary: null,
    })
    // Светофор/сводка stale-строки посчитаны по v1 — графтить их на v2
    // нельзя (ложный drift-alert «разошёлся» после пересдачи: снапшот v2
    // только что пересобран); до прихода рефетча деталей у v2 НЕТ.
    const stale: SelectedDayState = {
      kind: 'submitted',
      submission: { ...submission, version: 1, event: 'CHANGED' },
      trafficLight: {
        status: 'YELLOW',
        late: false,
        drift: { added: [], removed: [], changed: [] },
      },
      amendment: null,
      summary: { status: 'STALE', superseded: [], missing: [], unpinned: [] },
    }
    const after = resolvePanelState(stale, { ...local, version: 2 })
    if (after?.kind !== 'submitted') throw new Error('ожидалось submitted')
    expect(after.submission.version).toBe(2)
    expect(after.trafficLight).toBeNull()
    expect(after.summary).toBeNull()
  })
})

// --- 10.6 AC-10: строки осей сводки ------------------------------------------------

describe('summaryRows — оси STALE с резолвом имён по словарю divisions', () => {
  const names = { d1: 'Отдел А', d2: 'Отдел Б' }

  it('superseded/missing/unpinned → строки с именем; id вне словаря → id', () => {
    const rows = summaryRows(
      {
        status: 'STALE',
        superseded: [{ divisionId: 'd1', pinnedVersion: 1, currentVersion: 3 }],
        missing: [{ divisionId: 'd2', pinnedVersion: 2 }],
        unpinned: ['d-unknown'],
      },
      names,
    )
    expect(rows.map((r) => r.label)).toEqual([
      'Отдел А: пин v1 → текущая v3',
      'Отдел Б: сдача ребёнка отозвана',
      'd-unknown: появился несведённый ребёнок',
    ])
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
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
