// Story 10.5 — чистые хелперы экрана «Расход» (Task 5/7): лейблы Исх.№ и
// «взамен», имя файла (формат бэка document_release_service), defensive-разбор
// details.laggards (UUID-only by-design) и findings несходимости, бейдж
// статуса, локальные date-хелперы (осознанный дубль — boundaries банят импорт
// из daily-grid).
import { describe, expect, it } from 'vitest'

import {
  addDaysIso,
  buildFileName,
  issueErrorText,
  issueLabel,
  readConvergenceFindings,
  readLaggards,
  statusLabel,
  supersedesLabel,
  todayLocalIso,
} from './expenseReport'

describe('issueLabel / supersedesLabel', () => {
  it('issueLabel — «Исх.№ N/год»', () => {
    expect(issueLabel({ number: 247, year: 2026 })).toBe('Исх.№ 247/2026')
  })

  it('supersedesLabel — «взамен исх.№ N» (контракт 10-02 §2)', () => {
    expect(supersedesLabel({ number: 246 })).toBe('взамен исх.№ 246')
  })
})

describe('buildFileName', () => {
  it('формат бэка: расход_{business_date}_исх-{number}.docx', () => {
    expect(
      buildFileName({ business_date: '2026-07-08', number: 247 }),
    ).toBe('расход_2026-07-08_исх-247.docx')
  })
})

describe('statusLabel', () => {
  it('ISSUED → «Выпущен», SUPERSEDED → «Заменён»', () => {
    expect(statusLabel('ISSUED')).toBe('Выпущен')
    expect(statusLabel('SUPERSEDED')).toBe('Заменён')
  })

  it('незнакомая строка (дрейф контракта) — passthrough, не падение', () => {
    expect(statusLabel('DRAFT')).toBe('DRAFT')
  })
})

describe('readLaggards — defensive к unknown (зеркало readAllowed 10.3)', () => {
  it('detail.laggards бэка → список строк как есть', () => {
    expect(readLaggards({ laggards: ['u-1', 'u-2'] })).toEqual(['u-1', 'u-2'])
  })

  it('не-массив / отсутствие / мусорные элементы → пусто или отфильтровано', () => {
    expect(readLaggards({})).toEqual([])
    expect(readLaggards({ laggards: 'u-1' })).toEqual([])
    expect(readLaggards({ laggards: ['u-1', 5, null, 'u-2'] })).toEqual([
      'u-1',
      'u-2',
    ])
  })
})

describe('readConvergenceFindings — defensive к shape derive-финдингов', () => {
  it('violations + warnings → строки «reason — key: value, …»', () => {
    expect(
      readConvergenceFindings({
        violations: [
          {
            reason: 'staff_lt_list',
            division_id: 'd-1',
            staff_total: 2,
            list_total: 3,
          },
        ],
        warnings: [{ reason: 'no_staffing_record', division_id: 'd-1' }],
      }),
    ).toEqual([
      'staff_lt_list — division_id: d-1, staff_total: 2, list_total: 3',
      'no_staffing_record — division_id: d-1',
    ])
  })

  it('мусор (не-массивы, не-объекты) → пусто, не падение', () => {
    expect(readConvergenceFindings({})).toEqual([])
    expect(readConvergenceFindings({ violations: 'x', warnings: 5 })).toEqual(
      [],
    )
    expect(readConvergenceFindings({ violations: [null, 'str'] })).toEqual([])
  })

  it('finding без reason → метка «нарушение» с полями', () => {
    expect(readConvergenceFindings({ violations: [{ division_id: 'd' }] })).toEqual(
      ['нарушение — division_id: d'],
    )
  })
})

describe('issueErrorText — маппинг кодов выпуска в тексты экрана', () => {
  it('REPORT_NOT_READY_FOR_DATE → доменный текст «не сдан день»', () => {
    expect(issueErrorText('REPORT_NOT_READY_FOR_DATE', 'raw')).toContain(
      'не сдало день',
    )
  })

  it('DOCUMENT_ALREADY_ISSUED → «уже выпущен» (состояние, не тупик)', () => {
    expect(issueErrorText('DOCUMENT_ALREADY_ISSUED', 'raw')).toContain(
      'уже выпущен',
    )
  })

  it('прочие коды/null → сообщение бэка как есть', () => {
    expect(issueErrorText('REPORT_NO_DATA_FOR_DATE', 'Дата до начала данных.')).toBe(
      'Дата до начала данных.',
    )
    expect(issueErrorText(null, 'msg')).toBe('msg')
  })
})

describe('локальные date-хелперы (дубль prefill 10.2 — осознанный)', () => {
  it('todayLocalIso — YYYY-MM-DD', () => {
    expect(todayLocalIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('addDaysIso — UTC-математика, переход месяца/года', () => {
    expect(addDaysIso('2026-07-31', 1)).toBe('2026-08-01')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-07-01', -1)).toBe('2026-06-30')
  })
})
