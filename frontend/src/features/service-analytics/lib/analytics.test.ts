// @vitest-environment node
// Модель аналитики службы (§22.3/§22.7/§22.12): пороги, конфликты, отдых,
// снимок и курсор. Чистые функции — ни React, ни apiClient.
import { describe, expect, it } from 'vitest'
import {
  buildMetric,
  buildSnapshotId,
  decodeCursor,
  detectConflictShiftIds,
  displayValue,
  encodeCursor,
  isResting,
  isUnconfirmed,
  isUnfinishedPast,
  metricState,
  resolvePreset,
  restDays,
  toDrilldownRow,
} from './analytics'
import type { AnalyticsDutyType, AnalyticsSourceShift } from './analytics'
import type { MetricDefinition } from '../model/types'

const BUSINESS_DATE = '2026-07-20'

// Виды различаются ТОЛЬКО кодом и сроком: режим нарушения §21.35 видом больше
// не задаётся — он приходит третьим аргументом из правил конфликтов («Настройки»
// §29), теми же, что читает планирование дежурств.
const HARD_TYPE: AnalyticsDutyType = {
  dutyTypeCode: 'OWN_OBJECT_DAILY',
  restAfterMinutes: 24 * 60,
}
const SOFT_TYPE: AnalyticsDutyType = {
  dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
  restAfterMinutes: 24 * 60,
}

function shift(overrides: Partial<AnalyticsSourceShift> = {}): AnalyticsSourceShift {
  return {
    id: 'shift-1',
    businessDate: BUSINESS_DATE,
    employeeName: 'Ерланов Д.',
    objectLabel: 'Штаб управления',
    stateCode: 'PLANNED',
    dutyTypeCode: HARD_TYPE.dutyTypeCode,
    actualStart: null,
    actualEnd: null,
    updatedAt: '2026-07-20T08:00:00+05:00',
    ...overrides,
  }
}

function definition(overrides: Partial<MetricDefinition> = {}): MetricDefinition {
  return {
    metricCode: 'TEST',
    safeLabel: 'Тестовый показатель',
    unit: 'COUNT',
    warningFrom: 2,
    criticalFrom: 4,
    drilldownAvailable: true,
    ...overrides,
  }
}

describe('периоды (§22.5)', () => {
  it('пресет разворачивается сервером во ВКЛЮЧИТЕЛЬНЫЕ границы', () => {
    expect(
      resolvePreset(
        { presetCode: 'TODAY', safeLabel: 'Сегодня', offsetDays: 0, lengthDays: 1 },
        BUSINESS_DATE,
      ),
      // Один день — from === to, а не пустой интервал.
    ).toEqual({ from: '2026-07-20', to: '2026-07-20' })

    expect(
      resolvePreset(
        { presetCode: 'WEEK', safeLabel: 'Неделя', offsetDays: 0, lengthDays: 7 },
        BUSINESS_DATE,
      ),
    ).toEqual({ from: '2026-07-20', to: '2026-07-26' })
  })

  it('отрицательное смещение уводит период в прошлое целиком', () => {
    expect(
      resolvePreset(
        { presetCode: 'PREV', safeLabel: 'Вчера', offsetDays: -1, lengthDays: 1 },
        BUSINESS_DATE,
      ),
    ).toEqual({ from: '2026-07-19', to: '2026-07-19' })
  })
})

describe('состояние показателя (§22.3)', () => {
  it('пороги СЕРВЕРНЫЕ и включают границу', () => {
    expect(metricState(1, definition())).toBe('NORMAL')
    expect(metricState(2, definition())).toBe('WARNING')
    expect(metricState(4, definition())).toBe('CRITICAL')
  })

  it('показатель без порогов всегда в норме — выдуманный порог тревожил бы зря', () => {
    const plain = definition({ warningFrom: null, criticalFrom: null })
    expect(metricState(0, plain)).toBe('NORMAL')
    expect(metricState(999, plain)).toBe('NORMAL')
  })

  it('неизвестное значение — UNKNOWN и «нет данных», а НЕ ноль и не зелёный', () => {
    const metric = buildMetric(definition(), null)
    expect(metric.value).toBeNull()
    expect(metric.state).toBe('UNKNOWN')
    expect(metric.displayValue).toBe('нет данных')
    // §22.4 отдельно запрещает подменять UNKNOWN зелёным: NORMAL здесь был бы
    // утверждением «всё хорошо», которого мы сделать не можем.
    expect(metric.state).not.toBe('NORMAL')
    // Раскрывать непосчитанный показатель нечем — пустая выборка читалась бы
    // как «строк нет», а не «не посчитано».
    expect(metric.drilldownAvailable).toBe(false)
  })

  it('единица измерения едет в displayValue: 12 человек и 12 процентов различимы', () => {
    expect(displayValue(12, 'COUNT')).toBe('12')
    expect(displayValue(12, 'PERCENT')).toBe('12%')
    expect(displayValue(12, 'HOURS')).toBe('12 ч')
  })
})

describe('конфликты (§21.34/§22.7)', () => {
  it('две смены в один день — жёсткий конфликт, обе стороны', () => {
    const shifts = [
      shift({ id: 'a' }),
      shift({ id: 'b', objectLabel: 'Дворец Независимости' }),
    ]
    const conflicts = detectConflictShiftIds(shifts, [HARD_TYPE], 'HARD_BLOCK')
    expect(conflicts.hard).toEqual(['a', 'b'])
    expect(conflicts.soft).toEqual([])
  })

  it('нарушение отдыха принадлежит ВТОРОЙ смене пары, а severity — действующему режиму', () => {
    const soft = detectConflictShiftIds(
      [
        shift({ id: 'first', dutyTypeCode: SOFT_TYPE.dutyTypeCode }),
        shift({ id: 'second', businessDate: '2026-07-21', dutyTypeCode: SOFT_TYPE.dutyTypeCode }),
      ],
      [SOFT_TYPE],
      'SOFT_OVERRIDE',
    )
    // Первая смена своей обязанности не нарушала — раньше положенного
    // заступает вторая.
    expect(soft.soft).toEqual(['second'])
    expect(soft.hard).toEqual([])

    const hard = detectConflictShiftIds(
      [shift({ id: 'first' }), shift({ id: 'second', businessDate: '2026-07-21' })],
      [HARD_TYPE],
      'HARD_BLOCK',
    )
    expect(hard.hard).toEqual(['second'])
  })

  it('отменённая смена выбывает из расчёта', () => {
    const conflicts = detectConflictShiftIds(
      [shift({ id: 'a' }), shift({ id: 'b', stateCode: 'CANCELLED' })],
      [HARD_TYPE],
      'HARD_BLOCK',
    )
    expect(conflicts.hard).toEqual([])
  })

  it('смены РАЗНЫХ сотрудников в один день конфликтом не являются', () => {
    const conflicts = detectConflictShiftIds(
      [shift({ id: 'a' }), shift({ id: 'b', employeeName: 'Абишев Н.' })],
      [HARD_TYPE],
      'HARD_BLOCK',
    )
    expect(conflicts.hard).toEqual([])
    expect(conflicts.soft).toEqual([])
  })

  it('смена, попавшая в оба набора, остаётся ЖЁСТКОЙ — занижать severity нельзя', () => {
    // «second» нарушает мягкий отдых после первой и одновременно пересекается
    // с третьей в тот же день (жёсткий).
    const conflicts = detectConflictShiftIds(
      [
        shift({ id: 'first', dutyTypeCode: SOFT_TYPE.dutyTypeCode }),
        shift({ id: 'second', businessDate: '2026-07-21', dutyTypeCode: SOFT_TYPE.dutyTypeCode }),
        shift({ id: 'third', businessDate: '2026-07-21', dutyTypeCode: SOFT_TYPE.dutyTypeCode }),
      ],
      [SOFT_TYPE],
      'SOFT_OVERRIDE',
    )
    expect(conflicts.hard).toContain('second')
    expect(conflicts.soft).not.toContain('second')
  })
})

describe('отдых, просрочка и подтверждение (§22.7)', () => {
  it('длина отдыха округляется ВВЕРХ: неполные сутки — всё ещё отдых', () => {
    expect(restDays({ ...HARD_TYPE, restAfterMinutes: 24 * 60 })).toBe(1)
    expect(restDays({ ...HARD_TYPE, restAfterMinutes: 25 * 60 })).toBe(2)
    expect(restDays(undefined)).toBe(0)
  })

  it('отдых идёт ПОСЛЕ смены и только у завершённой', () => {
    const completed = shift({ stateCode: 'COMPLETED' })
    expect(isResting(completed, HARD_TYPE, '2026-07-21')).toBe(true)
    // День самой смены — не отдых, человек на посту.
    expect(isResting(completed, HARD_TYPE, BUSINESS_DATE)).toBe(false)
    expect(isResting(completed, HARD_TYPE, '2026-07-22')).toBe(false)
    expect(isResting(shift({ stateCode: 'PLANNED' }), HARD_TYPE, '2026-07-21')).toBe(false)
  })

  it('просрочена только смена СТРОГО до бизнес-даты и не в терминальном состоянии', () => {
    expect(isUnfinishedPast(shift({ businessDate: '2026-07-19' }), BUSINESS_DATE)).toBe(true)
    // Сегодняшняя смена ещё не обязана быть закрытой — записать её в просрочку
    // значило бы обвинить раньше срока (§22.11).
    expect(isUnfinishedPast(shift({ businessDate: BUSINESS_DATE }), BUSINESS_DATE)).toBe(false)
    expect(
      isUnfinishedPast(shift({ businessDate: '2026-07-19', stateCode: 'COMPLETED' }), BUSINESS_DATE),
    ).toBe(false)
    expect(
      isUnfinishedPast(shift({ businessDate: '2026-07-19', stateCode: 'CANCELLED' }), BUSINESS_DATE),
    ).toBe(false)
  })

  it('неподтверждённым считается несение службы без факта, но не план и не отмена', () => {
    expect(isUnconfirmed(shift({ stateCode: 'ACTIVE' }))).toBe(true)
    expect(isUnconfirmed(shift({ stateCode: 'ACTIVE', actualStart: 'x' }))).toBe(false)
    // У завершённой нужны ОБА факта: смена без времени окончания подтверждена
    // наполовину, а это не подтверждение.
    expect(isUnconfirmed(shift({ stateCode: 'COMPLETED', actualStart: 'x' }))).toBe(true)
    expect(isUnconfirmed(shift({ stateCode: 'COMPLETED', actualStart: 'x', actualEnd: 'y' }))).toBe(
      false,
    )
    expect(isUnconfirmed(shift({ stateCode: 'PLANNED' }))).toBe(false)
    expect(isUnconfirmed(shift({ stateCode: 'CANCELLED' }))).toBe(false)
  })
})

describe('снимок и курсор (§22.12)', () => {
  it('идентификатор снимка детерминирован входом, а не часами', () => {
    const input = { revision: 7, from: '2026-07-01', to: '2026-07-31', scopeId: 'demo' }
    expect(buildSnapshotId(input)).toBe(buildSnapshotId(input))
    // Другой период — другой снимок: иначе выборка одного периода подошла бы
    // к показателю другого.
    expect(buildSnapshotId({ ...input, to: '2026-07-30' })).not.toBe(buildSnapshotId(input))
    // Другая версия данных — тоже другой снимок.
    expect(buildSnapshotId({ ...input, revision: 8 })).not.toBe(buildSnapshotId(input))
  })

  it('курсор кодируется и разбирается, мусор даёт первую страницу', () => {
    expect(decodeCursor(encodeCursor(8))).toBe(8)
    expect(decodeCursor(null)).toBe(0)
    expect(decodeCursor('не-курсор')).toBe(0)
  })

  it('строка выборки несёт СТАБИЛЬНЫЙ id, а ФИО — только по праву', () => {
    const allowed = toDrilldownRow(shift(), true)
    expect(allowed.rowId).toBe('shift-1')
    expect(allowed.employeeLabel).toBe('Ерланов Д.')

    const suppressed = toDrilldownRow(shift(), false)
    expect(suppressed.employeeLabel).toBeNull()
    // Ни в одном другом поле строки сотрудника тоже нет.
    expect(JSON.stringify(suppressed)).not.toContain('Ерланов')
  })
})
