// Правила формы оценивания (§19.9-19.10) и счётчики рабочего пространства
// (§19.14).
import { describe, expect, it } from 'vitest'
import {
  DIRECTION_LABEL,
  summarizeEventProgress,
  summarizeQueue,
  validateSubmission,
} from './workspace'
import type { EvaluationBasis, EvaluationWorkItem } from '../model/types'

const BASES: EvaluationBasis[] = [
  { code: 'DISCIPLINE', label: 'Дисциплина', requiresNote: false },
  { code: 'OTHER', label: 'Другое', requiresNote: true },
]

const VALID = { score: 9, basisCode: 'DISCIPLINE', basisNote: null, comment: null }

function workItem(overrides: Partial<EvaluationWorkItem> = {}): EvaluationWorkItem {
  return {
    id: 'work-item-1',
    securityEventId: 'event-1',
    eventRunId: 'run-1',
    assignmentId: 'assignment-1',
    evaluatorUserId: 'user-1',
    targetEmployeeId: 'employee-1',
    targetGroupId: null,
    targetSafeLabel: 'Ерланов Д.',
    targetSafeUnitLabel: 'Первое управление',
    postLabel: 'Пост 1',
    actualStartsAt: '2026-07-18T07:40:00+05:00',
    actualEndsAt: '2026-07-18T19:20:00+05:00',
    participated: true,
    evaluationDirection: 'SENIOR_TO_EMPLOYEE',
    initialScore: 8,
    status: 'PENDING',
    revision: 1,
    submittedEvaluationId: null,
    submittedAt: null,
    ...overrides,
  }
}

describe('validateSubmission (§19.9-19.10)', () => {
  it('корректная отправка не даёт нарушений', () => {
    expect(validateSubmission(VALID, BASES)).toBeNull()
  })

  it('нуля в шкале нет: он отвергается наравне с одиннадцатью', () => {
    expect(validateSubmission({ ...VALID, score: 0 }, BASES)).toMatchObject({
      code: 'SCORE_OUT_OF_SCALE',
      field: 'score',
    })
    expect(validateSubmission({ ...VALID, score: 11 }, BASES)).toMatchObject({
      code: 'SCORE_OUT_OF_SCALE',
    })
    // Границы шкалы — часть правила, а не «примерно от одного до десяти».
    // Единица требует комментария (она ниже 8), и это ДРУГОЕ правило: без
    // комментария ассерт молча проверял бы его, а не границу шкалы.
    expect(validateSubmission({ ...VALID, score: 1, comment: 'оставил пост' }, BASES)).toBeNull()
    expect(validateSubmission({ ...VALID, score: 10 }, BASES)).toBeNull()
  })

  it('дробное значение отвергается своим кодом, а не как выход за шкалу', () => {
    expect(validateSubmission({ ...VALID, score: 7.5 }, BASES)).toMatchObject({
      code: 'SCORE_NOT_INTEGER',
      field: 'score',
    })
  })

  it('основание обязательно, и незнакомый код не проходит', () => {
    expect(validateSubmission({ ...VALID, basisCode: null }, BASES)).toMatchObject({
      code: 'BASIS_REQUIRED',
      field: 'basisCode',
    })
    expect(validateSubmission({ ...VALID, basisCode: 'INVENTED' }, BASES)).toMatchObject({
      code: 'BASIS_UNKNOWN',
      field: 'basisCode',
    })
  })

  it('«Другое» требует пояснения, и пробелы им не считаются', () => {
    expect(validateSubmission({ ...VALID, basisCode: 'OTHER' }, BASES)).toMatchObject({
      code: 'BASIS_NOTE_REQUIRED',
      field: 'basisNote',
    })
    expect(
      validateSubmission({ ...VALID, basisCode: 'OTHER', basisNote: '   ' }, BASES),
    ).toMatchObject({ code: 'BASIS_NOTE_REQUIRED' })
    expect(
      validateSubmission({ ...VALID, basisCode: 'OTHER', basisNote: 'разбор инцидента' }, BASES),
    ).toBeNull()
  })

  it('оценка ниже 8 требует комментария, восьмёрка и выше — нет', () => {
    expect(validateSubmission({ ...VALID, score: 7 }, BASES)).toMatchObject({
      code: 'COMMENT_REQUIRED',
      field: 'comment',
    })
    expect(validateSubmission({ ...VALID, score: 7, comment: ' ' }, BASES)).toMatchObject({
      code: 'COMMENT_REQUIRED',
    })
    expect(
      validateSubmission({ ...VALID, score: 7, comment: 'опоздание на пост' }, BASES),
    ).toBeNull()
    expect(validateSubmission({ ...VALID, score: 8 }, BASES)).toBeNull()
  })

  it('основание НЕ заменяет обязательный комментарий (§19.10)', () => {
    // Заполненное «Другое» с пояснением — и всё равно требование комментария:
    // это два разных требования, а не одно с двумя способами исполнения.
    expect(
      validateSubmission(
        { score: 6, basisCode: 'OTHER', basisNote: 'нестандартная ситуация', comment: null },
        BASES,
      ),
    ).toMatchObject({ code: 'COMMENT_REQUIRED' })
  })

  it('порядок проверок закреплён: шкала раньше основания, основание раньше комментария', () => {
    // Всё сразу неверно — сообщение обязано быть про шкалу: требование
    // комментария к невозможному значению читается как придирка.
    expect(
      validateSubmission({ score: 42, basisCode: null, basisNote: null, comment: null }, BASES),
    ).toMatchObject({ code: 'SCORE_OUT_OF_SCALE' })
    expect(
      validateSubmission({ score: 5, basisCode: null, basisNote: null, comment: null }, BASES),
    ).toMatchObject({ code: 'BASIS_REQUIRED' })
  })
})

describe('счётчики рабочего пространства (§19.14)', () => {
  it('очередь считает отправленное и оставшееся, а не только всего', () => {
    expect(
      summarizeQueue([
        workItem({ id: 'a' }),
        workItem({ id: 'b', status: 'SUBMITTED' }),
        workItem({ id: 'c' }),
      ]),
    ).toEqual({ total: 3, submitted: 1, remaining: 2 })
  })

  it('участники считаются по target, а не по числу заданий', () => {
    // Одного человека оценивают двое — он один участник, а не два.
    const progress = summarizeEventProgress([
      workItem({ id: 'a', evaluatorUserId: 'user-1', targetEmployeeId: 'employee-1' }),
      workItem({ id: 'b', evaluatorUserId: 'user-2', targetEmployeeId: 'employee-1' }),
      workItem({ id: 'c', evaluatorUserId: 'user-1', targetEmployeeId: 'employee-2' }),
    ])
    expect(progress.participants).toBe(2)
    expect(progress.counters.total).toBe(3)
  })

  it('прогресс разложен по направлениям и в нём нет ни одного значения оценки', () => {
    const progress = summarizeEventProgress([
      workItem({ id: 'a', evaluationDirection: 'SENIOR_TO_EMPLOYEE', status: 'SUBMITTED' }),
      workItem({ id: 'b', evaluationDirection: 'SENIOR_TO_EMPLOYEE' }),
      workItem({ id: 'c', evaluationDirection: 'EMPLOYEE_TO_SENIOR' }),
    ])
    expect(progress.byDirection).toEqual([
      { direction: 'SENIOR_TO_EMPLOYEE', counters: { total: 2, submitted: 1, remaining: 1 } },
      { direction: 'EMPLOYEE_TO_SENIOR', counters: { total: 1, submitted: 0, remaining: 1 } },
    ])
    // Ассерт по ВСЕМУ JSON: «оценок нет» проверяется отсутствием полей score /
    // comment / evaluator, а не тем, что мы их не читали.
    const json = JSON.stringify(progress)
    expect(json).not.toContain('score')
    expect(json).not.toContain('comment')
    expect(json).not.toContain('valuator')
  })
})

describe('подписи направлений (§19.16 «безопасный контекст»)', () => {
  it('контекст называет роль, а не человека', () => {
    expect(DIRECTION_LABEL.SENIOR_TO_EMPLOYEE).toBe('Старший → сотрудник')
    expect(DIRECTION_LABEL.EMPLOYEE_TO_SENIOR).toBe('Сотрудник → старший')
    expect(DIRECTION_LABEL.SENIOR_TO_GROUP).toBe('Групповая оценка')
  })
})
