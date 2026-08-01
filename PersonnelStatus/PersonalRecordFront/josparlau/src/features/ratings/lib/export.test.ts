// Экспорт оперативного рейтинга (§19.29): что попадает в файл, что не
// попадает никогда и какие заказы отклоняются до создания работы.
import { describe, expect, it } from 'vitest'
import {
  AGGREGATE_EXPORT_COLUMNS,
  UNAVAILABLE_EXPORT_FORMATS,
  UNAVAILABLE_EXPORT_SCOPES,
  buildAggregateExportContent,
  csvField,
  exportFileName,
  validateExportRequest,
} from './export'
import type { OperationalRatingSummary, RatingPolicy } from '../model/types'

const POLICY: RatingPolicy = {
  periodDays: 90,
  minEvaluations: 3,
  policyVersion: 'OPERATIONAL-RATING-test.1',
}

function summary(overrides: Partial<OperationalRatingSummary> = {}): OperationalRatingSummary {
  return {
    employeeId: 'employee-1',
    safeLabel: 'Ерланов Д.',
    aggregateRating: 8.4,
    evaluationsCount: 5,
    periodStartsAt: '2026-04-21',
    periodEndsAt: '2026-07-20',
    calculationPolicyVersion: POLICY.policyVersion,
    calculatedAt: '2026-07-20T08:00:00+05:00',
    dataState: 'READY',
    ...overrides,
  }
}

describe('validateExportRequest (§19.29)', () => {
  it('отклоняет индивидуальную выгрузку своим кодом — режим не выдаётся вовсе', () => {
    expect(validateExportRequest({ scope: 'INDIVIDUAL', format: 'CSV' })).toEqual({
      code: 'SENSITIVE_EXPORT_UNAVAILABLE',
      message: expect.stringContaining('§19.21'),
    })
  })

  it('отклоняет формат, который никто не собирает', () => {
    expect(
      validateExportRequest({ scope: 'AGGREGATE', format: 'XLSX' as never })?.code,
    ).toBe('EXPORT_FORMAT_UNAVAILABLE')
  })

  it('пропускает агрегированную выгрузку в CSV', () => {
    expect(validateExportRequest({ scope: 'AGGREGATE', format: 'CSV' })).toBeNull()
  })

  it('называет каждый недоступный формат §19.29 с причиной', () => {
    expect(UNAVAILABLE_EXPORT_FORMATS.map((item) => item.code)).toEqual(['XLSX', 'PDF'])
    for (const item of UNAVAILABLE_EXPORT_FORMATS) {
      expect(item.reason.length).toBeGreaterThan(40)
    }
    expect(UNAVAILABLE_EXPORT_SCOPES.map((item) => item.code)).toEqual(['INDIVIDUAL'])
    expect(UNAVAILABLE_EXPORT_SCOPES[0].reason).toContain('§19.21')
  })
})

describe('buildAggregateExportContent (§19.29)', () => {
  it('печатает шапку с методикой и заголовки колонок', () => {
    const content = buildAggregateExportContent([summary()], POLICY)
    const lines = content.trimEnd().split('\n')
    expect(lines[0]).toContain(POLICY.policyVersion)
    expect(lines[1]).toBe(AGGREGATE_EXPORT_COLUMNS.join(';'))
    expect(lines[2]).toBe('Ерланов Д.;8.4;5;2026-04-21;2026-07-20;OPERATIONAL-RATING-test.1;Рассчитан')
  })

  it('отсутствие агрегата печатает состоянием и пустой клеткой, а не нулём (§19.19)', () => {
    const content = buildAggregateExportContent(
      [summary({ aggregateRating: null, evaluationsCount: 1, dataState: 'INSUFFICIENT_DATA' })],
      POLICY,
    )
    const row = content.trimEnd().split('\n')[2]
    expect(row).toBe('Ерланов Д.;;1;2026-04-21;2026-07-20;OPERATIONAL-RATING-test.1;Недостаточно оценок')
    // Красная проба: подстановка нуля вместо пустой клетки роняет ассерт выше.
    expect(row.split(';')[1]).not.toBe('0')
    expect(row.split(';')[1]).not.toBe('0.0')
  })

  it('экранирует разделитель и кавычку — подпись не разрывает строку файла', () => {
    expect(csvField('Ер;ланов "Д."')).toBe('"Ер;ланов ""Д."""')
    const content = buildAggregateExportContent([summary({ safeLabel: 'Ер;ланов' })], POLICY)
    // Подпись уезжает В КАВЫЧКАХ: без них точка с запятой внутри неё сдвинула
    // бы все остальные колонки строки на одну вправо.
    expect(content.trimEnd().split('\n')[2].startsWith('"Ер;ланов";')).toBe(true)
  })

  it('имя файла собирает сервер и называет режим выгрузки', () => {
    expect(exportFileName('AGGREGATE', 'CSV', '2026-07-20')).toBe(
      'operational-rating-aggregate-2026-07-20.csv',
    )
  })
})
