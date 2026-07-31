// Отбор и безопасный контекст реестра итоговых оценок (§19.15-19.16).
import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  REGISTRY_PAGE_SIZE,
  matchesFilters,
  pageCount,
  pageOf,
  safeEvaluatorContext,
} from './registry'
import type { EvaluationRegistryRow } from './registry'

function row(overrides: Partial<EvaluationRegistryRow> = {}): EvaluationRegistryRow {
  return {
    rowId: 'row-evaluation-1',
    employeeId: 'employee-1',
    employeeSafeLabel: 'Ерланов Д.',
    unitSafeLabel: 'Первое управление',
    eventNumber: 'ОМ-2026-014',
    eventTitle: 'Международный форум',
    objectLabel: 'Конгресс-холл',
    postLabel: 'Пост 1 — главный вход',
    participated: true,
    evaluationDirection: 'SENIOR_TO_EMPLOYEE',
    method: 'MANUAL',
    evaluatedAt: '2026-07-10',
    corrected: false,
    aggregateRating: 8.6,
    aggregateState: 'READY',
    ...overrides,
  }
}

describe('строка реестра (§19.16)', () => {
  it('не несёт ни score, ни комментария, ни основания, ни оценщика', () => {
    // Ассерт по ВСЕМУ объекту, а не по знакомым именам: закрытое значение
    // приезжает и в производном поле так же, как в своём.
    const json = JSON.stringify(row())
    expect(json).not.toContain('score')
    expect(json).not.toContain('comment')
    expect(json).not.toContain('basis')
    expect(json).not.toContain('valuator')
  })
})

describe('отбор (§19.15)', () => {
  it('границы периода включительны с обеих сторон', () => {
    const filters = { ...EMPTY_FILTERS, from: '2026-07-10', to: '2026-07-10' }
    expect(matchesFilters(row({ evaluatedAt: '2026-07-10' }), filters)).toBe(true)
    expect(matchesFilters(row({ evaluatedAt: '2026-07-09' }), filters)).toBe(false)
    expect(matchesFilters(row({ evaluatedAt: '2026-07-11' }), filters)).toBe(false)
  })

  it('мероприятие, подразделение, сотрудник, направление и метод отбирают порознь', () => {
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, event: 'ОМ-2026-015' })).toBe(false)
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, unit: 'Второе управление' })).toBe(false)
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, employee: 'employee-2' })).toBe(false)
    expect(
      matchesFilters(row(), { ...EMPTY_FILTERS, direction: 'EMPLOYEE_TO_SENIOR' }),
    ).toBe(false)
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, method: 'SYSTEM_DEFAULT' })).toBe(false)
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, event: 'ОМ-2026-014' })).toBe(true)
  })

  it('«только исправленные» отбирает по признаку цепочки, а не по значению', () => {
    expect(matchesFilters(row({ corrected: false }), { ...EMPTY_FILTERS, correctedOnly: true })).toBe(
      false,
    )
    expect(matchesFilters(row({ corrected: true }), { ...EMPTY_FILTERS, correctedOnly: true })).toBe(
      true,
    )
  })

  it('поиск идёт только по безопасным подписям', () => {
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, search: 'конгресс' })).toBe(true)
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, search: 'ерланов' })).toBe(true)
    // Строка не содержит ни комментария, ни оценщика — искать по ним нечего, и
    // это утверждение, а не совпадение: поиск не должен подтверждать наличие
    // слова в закрытом тексте.
    expect(matchesFilters(row(), { ...EMPTY_FILTERS, search: 'инструктаж' })).toBe(false)
  })
})

describe('страницы', () => {
  const rows = Array.from({ length: REGISTRY_PAGE_SIZE * 2 + 3 }, (_value, index) => index)

  it('считает количество страниц и режет по границам', () => {
    expect(pageCount(rows.length)).toBe(3)
    expect(pageOf(rows, 1)).toHaveLength(REGISTRY_PAGE_SIZE)
    expect(pageOf(rows, 3)).toEqual([REGISTRY_PAGE_SIZE * 2, REGISTRY_PAGE_SIZE * 2 + 1, REGISTRY_PAGE_SIZE * 2 + 2])
  })

  it('страница вне диапазона зажимается, а не даёт пустоту', () => {
    // Пустая страница читалась бы как «записей нет» — а они есть.
    expect(pageOf(rows, 99)).toEqual(pageOf(rows, 3))
    expect(pageOf(rows, 0)).toEqual(pageOf(rows, 1))
    expect(pageCount(0)).toBe(1)
  })
})

describe('безопасный контекст оценщика (§19.16)', () => {
  it('называет роль и способ появления записи, но не человека', () => {
    expect(safeEvaluatorContext('MANUAL', 'SENIOR_TO_EMPLOYEE', false)).toBe('Старший → сотрудник')
    expect(safeEvaluatorContext('MANUAL', 'EMPLOYEE_TO_SENIOR', false)).toBe('Сотрудник → старший')
    // Системная оценка называется отдельно: у неё оценщика нет вовсе (§19.8),
    // и роль «старший» приписала бы ей человека.
    expect(safeEvaluatorContext('SYSTEM_DEFAULT', 'SENIOR_TO_EMPLOYEE', false)).toBe(
      'Системная оценка по умолчанию',
    )
    expect(safeEvaluatorContext('MANUAL', 'SENIOR_TO_EMPLOYEE', true)).toBe(
      'Исправление уполномоченным пользователем',
    )
  })
})
