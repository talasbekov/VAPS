// @vitest-environment node
// Формирование отчёта и masking policy (§22.20/§22.24) — чистая модель.
import { describe, expect, it } from 'vitest'
import {
  MASKED_FIELDS,
  artifactSeriesKey,
  buildJobActions,
  buildReportContent,
  contentHash,
  contentSize,
  csvField,
  findReusableArtifact,
  isArtifactAvailable,
  nextRevision,
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

/** Артефакт серии: только поля, которые участвуют в нумерации и пригодности. */
function artifact(overrides: Partial<ReportArtifact> = {}): ReportArtifact {
  return {
    artifactId: 'artifact-1',
    reportJobId: 'report-job-1',
    reportTypeCode: 'PERSONNEL_EXPENSE',
    safeTitle: 'Расход личного состава',
    format: 'CSV',
    revision: 1,
    generatedAt: '2026-07-20T08:00:00.000Z',
    generatedBy: 'operator',
    parameterSnapshot: PERIOD,
    calculationVersion: 'expense-2026.07.1',
    maskingPolicyVersion: 'masking-2026.07.1',
    retentionPolicyVersion: 'report-limits-2026.07.1',
    sensitive: false,
    fileSize: 10,
    hash: 'deadbeef',
    expiresAt: '2026-08-10T08:00:00.000Z',
    content: '',
    ...overrides,
  }
}

const SERIES = artifactSeriesKey({
  reportTypeCode: 'PERSONNEL_EXPENSE',
  parameters: PERIOD,
  sensitive: false,
})

describe('редакции серии (§22.25)', () => {
  it('первая редакция серии — первая, следующая продолжает НАИБОЛЬШУЮ', () => {
    expect(nextRevision([], SERIES)).toBe(1)
    expect(nextRevision([artifact()], SERIES)).toBe(2)
    expect(nextRevision([artifact({ revision: 4 })], SERIES)).toBe(5)
  })

  it('исчезнувшая по сроку редакция не освобождает свой номер', () => {
    // Счёт по КОЛИЧЕСТВУ дал бы здесь снова 2 — два разных файла с одним
    // номером редакции, и «редакция 2» перестала бы что-либо значить.
    const artifacts = [artifact({ revision: 2, artifactId: 'artifact-2' })]
    expect(nextRevision(artifacts, SERIES)).toBe(3)
  })

  it('режим выгрузки — часть серии: обычный и чувствительный отчёт не общая нумерация', () => {
    const sensitiveSeries = artifactSeriesKey({
      reportTypeCode: 'PERSONNEL_EXPENSE',
      parameters: PERIOD,
      sensitive: true,
    })
    expect(nextRevision([artifact()], sensitiveSeries)).toBe(1)
    expect(
      nextRevision([artifact()], artifactSeriesKey({
        reportTypeCode: 'PERSONNEL_EXPENSE',
        parameters: { from: '2026-08-01', to: '2026-08-31' },
        sensitive: false,
      })),
    ).toBe(1)
  })
})

describe('пригодный артефакт для повтора (§22.25)', () => {
  const NOW = '2026-07-25T08:00:00.000Z'

  it('берётся последняя редакция серии', () => {
    const found = findReusableArtifact(
      [artifact(), artifact({ artifactId: 'artifact-2', revision: 2 })],
      SERIES,
      NOW,
    )
    expect(found?.artifactId).toBe('artifact-2')
  })

  it('истёкший артефакт непригоден — повтор обязан собрать заново', () => {
    expect(
      findReusableArtifact([artifact({ expiresAt: '2026-07-24T08:00:00.000Z' })], SERIES, NOW),
    ).toBeNull()
  })

  it('артефакт чужой серии не подходит под повтор', () => {
    expect(findReusableArtifact([artifact({ sensitive: true })], SERIES, NOW)).toBeNull()
  })
})

describe('действия строки истории (§22.25)', () => {
  function codes(
    state: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
    available: boolean | null,
    parametersVisible = true,
  ) {
    const actions = buildJobActions({
      job: { state, artifactId: available === null ? null : 'artifact-1' },
      artifact: available === null ? null : { available },
      parametersVisible,
    })
    return Object.fromEntries(actions.map((action) => [action.code, action]))
  }

  it('готовая работа с доступным артефактом даёт скачивание и новую редакцию', () => {
    const actions = codes('COMPLETED', true)
    expect(actions.DOWNLOAD.available).toBe(true)
    expect(actions.NEW_REVISION.available).toBe(true)
    expect(actions.RETRY.available).toBe(true)
    expect(actions.VIEW_ERROR.available).toBe(false)
  })

  it('истёкший артефакт закрывает скачивание, но не повтор', () => {
    const actions = codes('COMPLETED', false)
    expect(actions.DOWNLOAD.available).toBe(false)
    expect(actions.DOWNLOAD.reason).toMatch(/Срок хранения/)
    expect(actions.RETRY.available).toBe(true)
  })

  it('у упавшей работы есть ошибка и повтор, но не редакция и не файл', () => {
    const actions = codes('FAILED', null)
    expect(actions.VIEW_ERROR.available).toBe(true)
    expect(actions.RETRY.available).toBe(true)
    expect(actions.NEW_REVISION.available).toBe(false)
    expect(actions.DOWNLOAD.available).toBe(false)
    // Причина отказа — про ошибку работы, а не про «артефакт ещё не готов»:
    // упавшая работа файла не получит никогда.
    expect(actions.DOWNLOAD.reason).toMatch(/ошибкой/)
  })

  it('незавершённая работа не повторяется и не скачивается, но параметры видны', () => {
    for (const state of ['PENDING', 'PROCESSING'] as const) {
      const actions = codes(state, null)
      expect(actions.RETRY.available).toBe(false)
      expect(actions.NEW_REVISION.available).toBe(false)
      expect(actions.DOWNLOAD.available).toBe(false)
      expect(actions.OPEN_PARAMETERS.available).toBe(true)
    }
  })

  it('чужой запуск без права закрывает и параметры, и файл — разными причинами (§22.26)', () => {
    const actions = codes('COMPLETED', true, false)
    expect(actions.OPEN_PARAMETERS.available).toBe(false)
    expect(actions.OPEN_PARAMETERS.reason).toMatch(/чужой запуск/)
    // Файл закрыт НЕ «сроком хранения» и не «состоянием»: артефакт готов и
    // доступен — причина именно в том, что запуск чужой.
    expect(actions.DOWNLOAD.available).toBe(false)
    expect(actions.DOWNLOAD.reason).toMatch(/первой строке/)
    // Повтор при этом остаётся доступен: он ничего не показывает — параметры
    // сервер берёт из исходной работы сам.
    expect(actions.RETRY.available).toBe(true)
  })

  it('каждый отказ назван причиной, а доступное действие причины не несёт', () => {
    // Проверяются ОБА состояния набора: у работающей отказов большинство, у
    // готовой — большинство доступно. Один набор оставил бы половину правила
    // непроверенной.
    for (const state of ['PROCESSING', 'COMPLETED'] as const) {
      const actions = buildJobActions({
        job: { state, artifactId: state === 'COMPLETED' ? 'artifact-1' : null },
        artifact: state === 'COMPLETED' ? { available: true } : null,
        parametersVisible: true,
      })
      expect(actions.some((action) => !action.available)).toBe(true)
      for (const action of actions) {
        if (action.available) expect(action.reason).toBeNull()
        else expect(action.reason?.trim()).toBeTruthy()
      }
    }
  })
})
