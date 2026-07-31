// Правила рабочего пространства оценивания (§19.7-19.10, §19.14).
//
// ЗДЕСЬ ЖИВЁТ ПРОВЕРКА ФОРМЫ — И ТА ЖЕ ФУНКЦИЯ ВЫЗЫВАЕТСЯ СЕРВЕРОМ. §19.9
// требует буквально: «форма не отправляется до прохождения frontend
// validation; backend повторно выполняет ту же проверку». Две копии правила
// разошлись бы молча — первой сдалась бы серверная, потому что её никто не
// видит глазами. Поэтому правило одно, а проверок две: репозиторий зовёт
// `validateSubmission` ещё раз на СВОИХ данных (своя редакция задания, свой
// перечень оснований), не доверяя телу запроса.
//
// Чего здесь НЕТ: расчёта агрегата и любой его части. Отправка оценки меняет
// только запись оценки; агрегат по-прежнему считает сервер (§19.19).
import { RATING_DEFAULT_SCORE, RATING_SCALE_MAX, RATING_SCALE_MIN } from '../model/types'
import type {
  EvaluationBasis,
  EvaluationDirection,
  EvaluationWorkItem,
  EvaluationWorkItemStatus,
} from '../model/types'

/** Поле, рядом с которым показывается ошибка (§19.9 «ошибка показывается рядом с полем»). */
export type SubmissionField = 'score' | 'basisCode' | 'basisNote' | 'comment' | 'reason'

export interface SubmissionViolation {
  /** Код — общий для клиента и сервера: сообщение сервера не разбирается словами. */
  code:
    | 'SCORE_OUT_OF_SCALE'
    | 'SCORE_NOT_INTEGER'
    | 'BASIS_REQUIRED'
    | 'BASIS_UNKNOWN'
    | 'BASIS_NOTE_REQUIRED'
    | 'COMMENT_REQUIRED'
    /** §19.18 шаг 6 — причина исправления. Живёт в `lib/correction.ts`, но код
     * общий: канал ошибки у формы исправления тот же. */
    | 'CORRECTION_REASON_REQUIRED'
  field: SubmissionField
  message: string
}

export interface SubmissionInput {
  score: number
  basisCode: string | null
  basisNote: string | null
  comment: string | null
}

/**
 * Первое нарушение или `null`. Именно ПЕРВОЕ, а не список: порядок проверок
 * закреплён тестом, потому что человеку с оценкой 12 и пустым комментарием
 * надо сначала сказать про шкалу — требование комментария к невозможному
 * значению читается как придирка.
 */
export function validateSubmission(
  input: SubmissionInput,
  bases: readonly EvaluationBasis[],
): SubmissionViolation | null {
  if (!Number.isInteger(input.score)) {
    return {
      code: 'SCORE_NOT_INTEGER',
      field: 'score',
      message: 'Оценка выставляется целым значением шкалы.',
    }
  }
  // Ноль в шкале отсутствует (§19.9 «Не используй 0»), и он не «пустое
  // значение»: пустую форму отправить нельзя вовсе — начальное значение
  // приходит с сервера.
  if (input.score < RATING_SCALE_MIN || input.score > RATING_SCALE_MAX) {
    return {
      code: 'SCORE_OUT_OF_SCALE',
      field: 'score',
      message: `Оценка вне шкалы ${RATING_SCALE_MIN}–${RATING_SCALE_MAX}.`,
    }
  }

  const basisCode = input.basisCode ?? ''
  if (basisCode === '') {
    return { code: 'BASIS_REQUIRED', field: 'basisCode', message: 'Укажите основание оценки.' }
  }
  const basis = bases.find((item) => item.code === basisCode)
  if (basis === undefined) {
    return { code: 'BASIS_UNKNOWN', field: 'basisCode', message: 'Неизвестное основание оценки.' }
  }
  if (basis.requiresNote && (input.basisNote ?? '').trim() === '') {
    return {
      code: 'BASIS_NOTE_REQUIRED',
      field: 'basisNote',
      message: `Основание «${basis.label}» требует пояснения.`,
    }
  }

  // §19.10: основание НЕ заменяет обязательный комментарий при значении ниже 8.
  // Поэтому проверка комментария стоит ПОСЛЕ основания и не отменяется им.
  if (input.score < RATING_DEFAULT_SCORE && (input.comment ?? '').trim() === '') {
    return {
      code: 'COMMENT_REQUIRED',
      field: 'comment',
      message: `Оценка ниже ${RATING_DEFAULT_SCORE} требует комментария с конкретной причиной.`,
    }
  }

  return null
}

/**
 * Очередь смотрящего (§19.14 шапка). Считается по ЕГО заданиям: «Сводка
 * мероприятия» — другой счёт по другим данным, и охраняется она отдельным
 * правом.
 */
export interface QueueCounters {
  total: number
  submitted: number
  remaining: number
}

export function summarizeQueue(items: readonly EvaluationWorkItem[]): QueueCounters {
  const submitted = items.filter((item) => item.status === 'SUBMITTED').length
  return { total: items.length, submitted, remaining: items.length - submitted }
}

/**
 * Сводка по мероприятию (§19.14 вкладка «Сводка мероприятия»). Это счёт по
 * заданиям ВСЕХ оценщиков — потому вкладка и требует права: очередь человека
 * говорит о его работе, а сводка — о работе других людей.
 *
 * Отдельных оценок, оценщиков и значений в ней нет ни одного: прогресс
 * оценивания и содержание оценок — разные вещи (§19.21).
 */
export interface EventProgress {
  participants: number
  counters: QueueCounters
  byDirection: { direction: EvaluationDirection; counters: QueueCounters }[]
}

export function summarizeEventProgress(items: readonly EvaluationWorkItem[]): EventProgress {
  const directions = [...new Set(items.map((item) => item.evaluationDirection))]
  return {
    // Фактические участники — различимые target, а не число заданий: одного
    // человека могут оценивать двое, и тогда счёт заданий назвал бы его дважды.
    participants: new Set(
      items.map((item) => item.targetEmployeeId ?? item.targetGroupId ?? item.id),
    ).size,
    counters: summarizeQueue(items),
    byDirection: directions.map((direction) => ({
      direction,
      counters: summarizeQueue(items.filter((item) => item.evaluationDirection === direction)),
    })),
  }
}

export const DIRECTION_LABEL: Record<EvaluationDirection, string> = {
  SENIOR_TO_EMPLOYEE: 'Старший → сотрудник',
  SENIOR_TO_GROUP: 'Групповая оценка',
  EMPLOYEE_TO_SENIOR: 'Сотрудник → старший',
}

export const WORK_ITEM_STATUS_LABEL: Record<EvaluationWorkItemStatus, string> = {
  PENDING: 'Не отправлено',
  SUBMITTED: 'Отправлено',
}

/**
 * §35: части §19, до которых рабочее пространство сознательно не дотянулось.
 * Список едет С СЕРВЕРА вместе с ответом — как у сводки и отчёта.
 */
export const UNAVAILABLE_WORKSPACE_VIEWS: readonly {
  code: string
  label: string
  reason: string
}[] = [
  {
    code: 'REPLACED_BEFORE_START',
    label: 'Исключение заменённого до заступления',
    reason:
      '§19.33: заменённый до заступления сотрудник не должен получать итоговую оценку. Задания формирует репозиторий по фактическому составу, а снимка замен (кто был заявлен и заменён до заступления) в данных мероприятий сида нет — демонстрировать исключение не на ком. Правило действует косвенно: задание без подтверждённого участия оценку не принимает (PARTICIPATION_NOT_CONFIRMED).',
  },
  {
    code: 'GROUP_EVALUATION',
    label: 'Групповая оценка',
    reason:
      '§19.13 требует показать состав группы на момент мероприятия и фактический состав. Таких снимков нигде не записано, а без них групповая оценка была бы оценкой неизвестно кого. Копировать её каждому участнику прямо запрещено, поэтому направление объявлено, но заданий этого вида нет.',
  },
  {
    code: 'ARCHIVE_ADDENDUM',
    label: 'Архивное дополнение к исправлению',
    reason:
      '§19.18: исправление после формирования архива обязано создавать разрешённое дополнение, связанное с исходным snapshot, не переписывая его manifest. Архив мероприятия в этой сборке не формируется вовсе, поэтому дополнение не к чему привязать — а сделать вид, что оно есть, значило бы пообещать неизменность архива, которой никто не обеспечивает.',
  },
  {
    code: 'CORRECT_FOREIGN_EVALUATION',
    label: 'Исправление ЧУЖОЙ оценки',
    reason:
      '§19.21 «контролёр рейтинга» требует sensitive permission, organization scope, event scope и срок полномочия ОДНОВРЕМЕННО. Ни scope, ни срока полномочия в этой сборке нет, поэтому исправление ограничено собственной записью: право без scope пускало бы правку любой оценки в системе.',
  },
  {
    code: 'RECOGNITION_AND_REMARK',
    label: 'Фильтры «С благодарностью», «С замечанием», «Исправленные»',
    reason:
      '§19.11 запрещает выводить тип из одного лишь значения: высокая оценка не равна благодарности, низкая — взысканию. Подтверждённых сущностей поощрения и замечания в контракте нет, а придумывать backend codes нельзя.',
  },
  {
    code: 'BULK_DEFAULT',
    label: 'Кнопка «Применить 8 всем»',
    reason:
      '§19.8 называет её поимённо среди запрещённых. Восьмёрка означает стандартное выполнение без зафиксированного основания для снижения, и проставить её списком значило бы объявить это про людей, которых оценщик не смотрел.',
  },
  {
    code: 'RECEIVED_EVALUATIONS',
    label: 'Оценки, полученные смотрящим от других',
    reason:
      '§19.14 «Не показывай пользователю оценки, полученные им от других лиц». Их нет в ответе: очередь и отправленные отбираются по оценщику, а не фильтруются на экране.',
  },
]
