// Правила исправления оценки (§19.18): причина обязательна, правило
// комментария повторяется, diff показывает только изменившееся.
import { describe, expect, it } from 'vitest'
import { buildCorrectionDiff, validateCorrection } from './correction'
import type { EvaluationBasis } from '../model/types'

const BASES: EvaluationBasis[] = [
  { code: 'DISCIPLINE', label: 'Дисциплина', requiresNote: false },
  { code: 'OTHER', label: 'Другое', requiresNote: true },
]

const VALID = {
  score: 9,
  basisCode: 'DISCIPLINE',
  basisNote: null,
  comment: null,
  reason: 'Оценка выставлена не тому участнику',
}

describe('validateCorrection (§19.18)', () => {
  it('корректное исправление не даёт нарушений', () => {
    expect(validateCorrection(VALID, BASES)).toBeNull()
  })

  it('причина исправления обязательна, и пробелы ею не считаются', () => {
    expect(validateCorrection({ ...VALID, reason: '' }, BASES)).toMatchObject({
      code: 'CORRECTION_REASON_REQUIRED',
      field: 'reason',
    })
    expect(validateCorrection({ ...VALID, reason: '   ' }, BASES)).toMatchObject({
      code: 'CORRECTION_REASON_REQUIRED',
    })
    expect(validateCorrection({ ...VALID, reason: null }, BASES)).toMatchObject({
      code: 'CORRECTION_REASON_REQUIRED',
    })
  })

  it('правило комментария к оценке ниже 8 повторяется (§19.18 шаг 7)', () => {
    // Причина исправления заполнена — и всё равно нужен комментарий: это
    // РАЗНЫЕ требования, объяснить исправление не значит объяснить оценку.
    expect(validateCorrection({ ...VALID, score: 5 }, BASES)).toMatchObject({
      code: 'COMMENT_REQUIRED',
      field: 'comment',
    })
    expect(
      validateCorrection({ ...VALID, score: 5, comment: 'опоздание на пост' }, BASES),
    ).toBeNull()
  })

  it('причина проверяется ПОСЛЕ значений: сначала должно быть верно то, что исправляют', () => {
    expect(
      validateCorrection({ ...VALID, score: 0, reason: '' }, BASES),
    ).toMatchObject({ code: 'SCORE_OUT_OF_SCALE' })
    expect(
      validateCorrection({ ...VALID, basisCode: 'OTHER', basisNote: null, reason: '' }, BASES),
    ).toMatchObject({ code: 'BASIS_NOTE_REQUIRED' })
  })
})

describe('buildCorrectionDiff (§19.18 шаг 8)', () => {
  const BEFORE = {
    score: 7,
    basisLabel: 'Дисциплина',
    basisNote: null,
    comment: 'Задержка на инструктаже',
  }

  it('показывает только изменившееся, а неизменное не печатает', () => {
    const rows = buildCorrectionDiff(BEFORE, { ...BEFORE, score: 9 })
    expect(rows).toEqual([{ field: 'score', label: 'Оценка', before: '7', after: '9' }])
  })

  it('пустой diff — тоже ответ: исправлять нечего', () => {
    expect(buildCorrectionDiff(BEFORE, { ...BEFORE })).toEqual([])
  })

  it('появление и исчезновение значения печатаются прочерком, а не пустотой', () => {
    const rows = buildCorrectionDiff(BEFORE, { ...BEFORE, comment: null, basisNote: 'разбор' })
    expect(rows).toEqual([
      { field: 'basisNote', label: 'Пояснение к основанию', before: '—', after: 'разбор' },
      { field: 'comment', label: 'Комментарий', before: 'Задержка на инструктаже', after: '—' },
    ])
  })

  it('оценщика, target и мероприятия в diff нет — их запрещено менять', () => {
    const json = JSON.stringify(buildCorrectionDiff(BEFORE, { ...BEFORE, score: 9 }))
    expect(json).not.toContain('valuator')
    expect(json).not.toContain('target')
    expect(json).not.toContain('vent')
  })
})
