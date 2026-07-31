// Исправление оценки (§19.18): правила формы исправления и diff «было → стало».
//
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: пересчёта агрегата. §19.18 прямо запрещает
// «пересчитывать канонический aggregate локально» — исправление меняет ЗАПИСИ,
// а число по ним считает сервер и присылает готовым.
//
// Правило комментария к оценке ниже 8 здесь не переписано: §19.18 шаг 7
// требует «повторно пройти правило комментария», то есть ТО ЖЕ правило, а не
// похожее. Поэтому `validateCorrection` зовёт `validateSubmission` и добавляет
// к ней ровно одно своё требование — причину исправления.
import { validateSubmission } from './workspace'
import type { SubmissionInput, SubmissionViolation } from './workspace'
import type { EvaluationBasis } from '../model/types'

export interface CorrectionInput extends SubmissionInput {
  /** §19.18 шаг 6: причина исправления обязательна. */
  reason: string | null
}

export function validateCorrection(
  input: CorrectionInput,
  bases: readonly EvaluationBasis[],
): SubmissionViolation | null {
  const base = validateSubmission(input, bases)
  if (base !== null) return base
  // Причина проверяется ПОСЛЕДНЕЙ: сначала должно быть корректно то, что
  // исправляют, иначе человек объясняет причину значения, которое всё равно
  // не будет принято.
  if ((input.reason ?? '').trim() === '') {
    return {
      code: 'CORRECTION_REASON_REQUIRED',
      field: 'reason',
      message: 'Укажите причину исправления оценки.',
    }
  }
  return null
}

/** Строка diff §19.18 шаг 8: что именно меняется, в терминах человека. */
export interface CorrectionDiffRow {
  field: 'score' | 'basis' | 'basisNote' | 'comment'
  label: string
  before: string
  after: string
}

const EMPTY = '—'

function text(value: string | null): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? EMPTY : trimmed
}

/**
 * Diff показывает ТОЛЬКО изменившееся. Строки «было = стало» в списке
 * изменений — шум, из-за которого настоящее изменение теряется; пустой diff при
 * этом сам по себе значим: исправлять нечего, и это видно до подтверждения.
 *
 * Оценщик, target, мероприятие и назначение в diff отсутствуют не потому, что
 * их «не показали»: §19.18 запрещает их менять, и в теле исправления их нет.
 */
export function buildCorrectionDiff(
  before: { score: number; basisLabel: string | null; basisNote: string | null; comment: string | null },
  after: { score: number; basisLabel: string | null; basisNote: string | null; comment: string | null },
): CorrectionDiffRow[] {
  const rows: CorrectionDiffRow[] = [
    {
      field: 'score',
      label: 'Оценка',
      before: String(before.score),
      after: String(after.score),
    },
    {
      field: 'basis',
      label: 'Основание',
      before: text(before.basisLabel),
      after: text(after.basisLabel),
    },
    {
      field: 'basisNote',
      label: 'Пояснение к основанию',
      before: text(before.basisNote),
      after: text(after.basisNote),
    },
    { field: 'comment', label: 'Комментарий', before: text(before.comment), after: text(after.comment) },
  ]
  return rows.filter((row) => row.before !== row.after)
}
