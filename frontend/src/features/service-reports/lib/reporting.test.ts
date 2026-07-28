// @vitest-environment node
// Формирование отчёта и masking policy (§22.20/§22.24) — чистая модель.
import { describe, expect, it } from 'vitest'
import {
  MASKED_FIELDS,
  buildReportContent,
  contentHash,
  contentSize,
  csvField,
  isArtifactAvailable,
  periodDays,
  selectRows,
} from './reporting'
import type { ReportSourceRow } from './reporting'
import type { ReportArtifact } from '../model/types'

const NOTE = 'Личное обстоятельство сотрудника'
const OVERRIDE = 'Некем заменить, приказ №5'

function row(overrides: Partial<ReportSourceRow> = {}): ReportSourceRow {
  return {
    businessDate: '2026-07-20',
    employeeName: 'Ерланов Д.',
    objectLabel: 'Дворец Независимости',
    postLabel: 'Сектор A · КПП-1',
    stateCode: 'PLANNED',
    note: NOTE,
    overrideReason: OVERRIDE,
    ...overrides,
  }
}

const PERIOD = { from: '2026-07-01', to: '2026-07-31' }

describe('маскирование (§22.24)', () => {
  it('обычный экспорт не содержит исключённых полей — ни значений, ни колонок', () => {
    const content = buildReportContent([row()], PERIOD, false)
    expect(content).not.toContain(NOTE)
    expect(content).not.toContain(OVERRIDE)
    // Колонки ОТСУТСТВУЮТ, а не пусты: пустая ячейка читалась бы как
    // «примечания не было».
    expect(content).not.toContain('Примечание')
    expect(content).not.toContain('Обоснование обхода')
    // Полезные поля при этом на месте — маскирование не выхолостило отчёт.
    expect(content).toContain('Ерланов Д.')
    expect(content).toContain('Сектор A · КПП-1')
  })

  it('sensitive export включает исключённые поля вместе с колонками', () => {
    const content = buildReportContent([row()], PERIOD, true)
    expect(content).toContain(NOTE)
    expect(content).toContain(OVERRIDE)
    expect(content).toContain('Примечание')
  })

  it('у каждого исключённого поля названа причина (§35)', () => {
    expect(MASKED_FIELDS.length).toBeGreaterThan(0)
    expect(MASKED_FIELDS.every((field) => field.reason.trim() !== '')).toBe(true)
  })

  it('пустой набор строк даёт заголовок, а не пустой файл', () => {
    const content = buildReportContent([], PERIOD, false)
    expect(content).toContain('Расход личного состава за период 2026-07-01 — 2026-07-31')
    expect(content.trim().split('\n')).toHaveLength(2)
  })
})

describe('CSV-экранирование', () => {
  it('поле с разделителем, кавычкой или переносом берётся в кавычки', () => {
    expect(csvField('простое')).toBe('простое')
    expect(csvField('a;b')).toBe('"a;b"')
    expect(csvField('он сказал "нет"')).toBe('"он сказал ""нет"""')
    expect(csvField('строка\nвторая')).toBe('"строка\nвторая"')
  })

  it('примечание с разделителем не разваливает строку отчёта', () => {
    const content = buildReportContent([row({ note: 'первое; второе' })], PERIOD, true)
    const dataLine = content.trim().split('\n')[2]
    // 7 колонок — значит «;» внутри примечания не был принят за разделитель.
    expect(dataLine.split(';').length).toBeGreaterThan(7)
    expect(content).toContain('"первое; второе"')
  })
})

describe('период (§22.19)', () => {
  it('границы включительные с обеих сторон', () => {
    const rows = [
      row({ businessDate: '2026-06-30' }),
      row({ businessDate: '2026-07-01' }),
      row({ businessDate: '2026-07-31' }),
      row({ businessDate: '2026-08-01' }),
    ]
    expect(selectRows(rows, PERIOD).map((entry) => entry.businessDate)).toEqual([
      '2026-07-01',
      '2026-07-31',
    ])
  })

  it('период из одного дня — один день, а не ноль', () => {
    expect(periodDays({ from: '2026-07-20', to: '2026-07-20' })).toBe(1)
    expect(periodDays(PERIOD)).toBe(31)
  })
})

describe('метаданные артефакта (§22.22)', () => {
  it('размер считается в байтах, а не в символах', () => {
    // Кириллица в UTF-8 — два байта на символ: длина строки соврала бы вдвое.
    const content = 'абв'
    expect(contentSize(content)).toBe(6)
    expect(contentSize(content)).not.toBe(content.length)
  })

  it('контрольная сумма детерминирована и различает содержимое', () => {
    expect(contentHash('одно')).toBe(contentHash('одно'))
    expect(contentHash('одно')).not.toBe(contentHash('другое'))
  })

  it('доступность считается по expiresAt артефакта, а не по фиксированному сроку', () => {
    const artifact = { expiresAt: '2026-08-10T08:00:00.000Z' } as ReportArtifact
    expect(isArtifactAvailable(artifact, '2026-08-09T08:00:00.000Z')).toBe(true)
    expect(isArtifactAvailable(artifact, '2026-08-10T08:00:00.000Z')).toBe(false)
  })
})
