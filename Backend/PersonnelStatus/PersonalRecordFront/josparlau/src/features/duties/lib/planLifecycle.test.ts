// @vitest-environment node
// Lifecycle месячного плана (§21.27) и action policy шапки (§21.28) — чистая
// модель, без React и сети.
import { describe, expect, it } from 'vitest'
import {
  DRAFT_LABEL,
  buildPlanActions,
  buildValidation,
  findAction,
  isValidationCurrent,
  planFingerprint,
} from './planLifecycle'
import type { MonthlyDutyPlanConflict } from './monthlyPlan'
import type { DutyShift, MonthlyPlanRecord } from '../model/types'

const ALL_RIGHTS = { canManage: true, canApprove: true }

function shift(id: string, overrides: Partial<DutyShift> = {}): DutyShift {
  return {
    id,
    businessDate: '2026-07-10',
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    target: { targetType: 'OWN_OBJECT', objectId: 'object-1', safeLabel: 'Дворец Независимости' },
    employeeName: 'Ерланов Д.',
    stateCode: 'PLANNED',
    acknowledgedAt: null,
    actualStart: null,
    actualEnd: null,
    updatedAt: '2026-07-01T09:00:00.000Z',
    passportBinding: null,
    note: null,
    cancellation: null,
    overrideReason: null,
    employeeId: null,
    unitId: null,
    ...overrides,
  }
}

function record(overrides: Partial<MonthlyPlanRecord> = {}): MonthlyPlanRecord {
  return {
    month: '2026-07',
    stateCode: 'DRAFT',
    revision: 1,
    createdAt: '2026-07-01T09:00:00.000Z',
    lastValidation: null,
    approvedAt: null,
    approvedBy: null,
    history: [],
    ...overrides,
  }
}

function conflict(severity: MonthlyDutyPlanConflict['severity']): MonthlyDutyPlanConflict {
  return {
    conflictId: `x-${severity}`,
    code: 'DUTY_OVERLAP',
    policyVersion: 'conflict-rules-test.1',
    severity,
    employeeName: 'Ерланов Д.',
    businessDate: '2026-07-10',
    message: 'сообщение',
  }
}

describe('planFingerprint (§21.27)', () => {
  it('не зависит от порядка смен во входе', () => {
    const a = shift('duty-1')
    const b = shift('duty-2', { businessDate: '2026-07-11' })
    expect(planFingerprint('2026-07', [a, b])).toBe(planFingerprint('2026-07', [b, a]))
  })

  it('меняется от ПРАВКИ смены, а не только от её появления', () => {
    const before = planFingerprint('2026-07', [shift('duty-1')])
    const after = planFingerprint('2026-07', [
      shift('duty-1', { updatedAt: '2026-07-02T09:00:00.000Z' }),
    ])
    expect(after).not.toBe(before)
  })

  it('отмена смены меняет отпечаток: отменённая в него не входит', () => {
    const before = planFingerprint('2026-07', [shift('duty-1')])
    const after = planFingerprint('2026-07', [
      shift('duty-1', { stateCode: 'CANCELLED', cancellation: { reason: 'x', cancelledAt: 'y' } }),
    ])
    expect(after).not.toBe(before)
    expect(after).toBe('')
  })

  it('смены соседнего месяца в отпечаток не входят', () => {
    const withNeighbour = planFingerprint('2026-07', [shift('duty-1'), shift('duty-2', {
      businessDate: '2026-08-01',
    })])
    expect(withNeighbour).toBe(planFingerprint('2026-07', [shift('duty-1')]))
  })
})

describe('buildValidation (§21.27 «VALIDATED — результат проверки»)', () => {
  it('жёсткий конфликт валит проверку, мягкий — нет', () => {
    expect(buildValidation('t', [conflict('SOFT'), conflict('SOFT')], 'fp')).toMatchObject({
      passed: true,
      hardConflicts: 0,
      softConflicts: 2,
    })
    expect(buildValidation('t', [conflict('HARD'), conflict('SOFT')], 'fp')).toMatchObject({
      passed: false,
      hardConflicts: 1,
      softConflicts: 1,
    })
  })

  it('проверка помнит отпечаток, по которому её делали', () => {
    const validation = buildValidation('t', [], 'fp-1')
    expect(isValidationCurrent(validation, 'fp-1')).toBe(true)
    expect(isValidationCurrent(validation, 'fp-2')).toBe(false)
    expect(isValidationCurrent(null, 'fp-1')).toBe(false)
  })
})

describe('buildPlanActions (§21.28 action policy)', () => {
  it('возвращает все шесть действий даже когда нельзя ни одного', () => {
    const actions = buildPlanActions(null, { canManage: false, canApprove: false }, false)
    expect(actions.map((action) => action.code)).toEqual([
      'CREATE_DRAFT',
      'CHECK_CONFLICTS',
      'APPROVE',
      'REOPEN',
      'EXPORT',
      'ADD_SHIFT',
    ])
    // Ни одно недоступное действие не молчит о причине (§35).
    expect(actions.filter((action) => !action.enabled).every((action) => action.reason !== null))
      .toBe(true)
  })

  it('кнопка черновика называется «Сформировать черновик», а не «Сформировать план» (§21.27)', () => {
    const actions = buildPlanActions(null, ALL_RIGHTS, false)
    expect(findAction(actions, 'CREATE_DRAFT')?.label).toBe(DRAFT_LABEL)
    expect(DRAFT_LABEL).toBe('Сформировать черновик')
  })

  it('без ops.duty.manage причина — отсутствие права, а не состояние плана', () => {
    const actions = buildPlanActions(null, { canManage: false, canApprove: true }, false)
    expect(findAction(actions, 'CREATE_DRAFT')?.reason).toContain('ops.duty.manage')
    // Иначе пользователь без права пошёл бы «сначала формировать черновик».
    expect(findAction(actions, 'CREATE_DRAFT')?.reason).not.toContain('черновик')
  })

  it('плана нет: доступны только черновик и добавление дежурства', () => {
    const actions = buildPlanActions(null, ALL_RIGHTS, false)
    expect(actions.filter((action) => action.enabled).map((action) => action.code)).toEqual([
      'CREATE_DRAFT',
      'ADD_SHIFT',
    ])
  })

  it('черновик без проверки: утверждение закрыто именно отсутствием проверки', () => {
    const actions = buildPlanActions(record(), ALL_RIGHTS, false)
    expect(findAction(actions, 'APPROVE')).toMatchObject({ enabled: false })
    expect(findAction(actions, 'APPROVE')?.reason).toContain('Проверка конфликтов не проводилась')
    expect(findAction(actions, 'CHECK_CONFLICTS')?.enabled).toBe(true)
  })

  it('проверка была, но состав менялся — утверждение закрыто устареванием проверки', () => {
    const actions = buildPlanActions(
      record({ lastValidation: buildValidation('t', [], 'fp-1') }),
      ALL_RIGHTS,
      false,
    )
    expect(findAction(actions, 'APPROVE')?.reason).toContain('менялся после последней проверки')
  })

  it('проверка не пройдена: причина называет число жёстких конфликтов', () => {
    const actions = buildPlanActions(
      record({ lastValidation: buildValidation('t', [conflict('HARD')], 'fp-1') }),
      ALL_RIGHTS,
      true,
    )
    expect(findAction(actions, 'APPROVE')?.reason).toContain('жёстких конфликтов: 1')
  })

  it('свежая пройденная проверка открывает утверждение', () => {
    const actions = buildPlanActions(
      record({ lastValidation: buildValidation('t', [conflict('SOFT')], 'fp-1') }),
      ALL_RIGHTS,
      true,
    )
    expect(findAction(actions, 'APPROVE')).toMatchObject({ enabled: true, reason: null })
  })

  it('утверждение требует своего права, а не ops.duty.manage', () => {
    const actions = buildPlanActions(
      record({ lastValidation: buildValidation('t', [], 'fp-1') }),
      { canManage: true, canApprove: false },
      true,
    )
    expect(findAction(actions, 'APPROVE')?.reason).toContain('ops.duty.approve_plan')
    // Планировать при этом можно: права разные и не подменяют друг друга.
    expect(findAction(actions, 'ADD_SHIFT')?.enabled).toBe(true)
  })

  it('утверждённый план: добавление дежурства закрыто с номером редакции, открыта только новая редакция', () => {
    const actions = buildPlanActions(
      record({ stateCode: 'APPROVED', revision: 2 }),
      ALL_RIGHTS,
      true,
    )
    expect(actions.filter((action) => action.enabled).map((action) => action.code)).toEqual([
      'REOPEN',
    ])
    expect(findAction(actions, 'ADD_SHIFT')?.reason).toContain('редакция 2')
  })

  it('экспорт недоступен по нереализованности, а не по правам', () => {
    const withRights = findAction(buildPlanActions(null, ALL_RIGHTS, true), 'EXPORT')
    const withoutRights = findAction(
      buildPlanActions(null, { canManage: false, canApprove: false }, true),
      'EXPORT',
    )
    expect(withRights).toEqual(withoutRights)
    expect(withRights?.reason).toContain('не реализован')
  })
})
