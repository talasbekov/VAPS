// Расчёт оперативного рейтинга (§19.19). Чистая модель: ни React, ни
// apiClient — тестируется в env node.
//
// ⚠️ Этот модуль исполняется ТОЛЬКО на стороне mock-сервера (repository).
// §19.19 перечисляет, чего frontend делать не должен: считать среднее,
// определять веса, распределять групповую оценку, округлять каноническое
// значение, исключать исправленные оценки локальной логикой, задавать период
// «90 дней» и минимальное количество оценок. Всё перечисленное живёт здесь.
import type {
  EventEvaluation,
  OperationalRatingSummary,
  RatingDataState,
  RatingPolicy,
} from '../model/types'

/**
 * §35: чего в расчёте НЕТ и почему. Причины едут клиенту вместе со сводкой —
 * иначе агрегат читался бы как «учтено всё, что бывает».
 */
export const UNAVAILABLE_RATING_FACTORS: readonly { code: string; label: string; reason: string }[] =
  [
    {
      code: 'EVALUATOR_WEIGHTS',
      label: 'Веса оценщиков',
      reason:
        'Модель весов оценщиков не заведена: §19.19 запрещает определять их на клиенте, а серверной методики весов в этой сборке нет. Все учтённые оценки равнозначны, и это сказано прямо, а не спрятано за словом «агрегат».',
    },
    {
      code: 'GROUP_EVALUATION',
      label: 'Распределение групповой оценки',
      reason:
        'Групповое оценивание (§19.13) не реализовано — распределять нечего. Показать долю групповой оценки значило бы объявить существующим механизм, которого нет.',
    },
    {
      code: 'DUTY_SHIFTS',
      label: 'Суточные дежурства',
      reason:
        'В оперативный рейтинг мероприятий суточные дежурства не включаются без отдельного подтверждённого contract (§19.1). Смены дежурств учитываются аналитикой службы и в рейтинг не переносятся.',
    },
    {
      code: 'SERVICE_HOURS',
      label: 'Фактические часы службы',
      reason:
        'Часы — не оценка (§19.2 `ServiceHoursEntry`). Повышать рейтинг за количество часов прямо запрещено, поэтому они не участвуют в расчёте ни с каким знаком.',
    },
  ]

/**
 * Оценки, учитываемые в агрегате: в периоде и НЕ вытесненные исправлением.
 * Оба правила серверные (§19.19).
 */
export function includedEvaluations(
  evaluations: readonly EventEvaluation[],
  employeeId: string,
  periodStartsAt: string,
  periodEndsAt: string,
): EventEvaluation[] {
  return evaluations.filter(
    (item) =>
      item.employeeId === employeeId &&
      item.supersededById === null &&
      item.evaluatedAt >= periodStartsAt &&
      item.evaluatedAt <= periodEndsAt,
  )
}

/** Начало периода: `periodDays` суток назад от бизнес-даты, включая её саму. */
export function periodStart(businessDate: string, periodDays: number): string {
  const start = Date.UTC(
    Number(businessDate.slice(0, 4)),
    Number(businessDate.slice(5, 7)) - 1,
    Number(businessDate.slice(8, 10)),
  ) -
    (periodDays - 1) * 86_400_000
  return new Date(start).toISOString().slice(0, 10)
}

/**
 * Каноническое значение округляется ЗДЕСЬ, на сервере, до одного знака: §19.19
 * запрещает округлять его фронту, а прислать 8.342857 и попросить экран
 * «просто напечатать» значило бы переложить округление на вёрстку.
 */
export function roundAggregate(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Сводка одного сотрудника. Порядок проверок значим: выключенная функция
 * отвечает раньше отсутствующей политики, а отсутствующая политика — раньше
 * счёта оценок. Иначе человек увидел бы «недостаточно данных» там, где данные
 * не при чём.
 */
export function buildSummary(input: {
  employeeId: string
  safeLabel: string
  evaluations: readonly EventEvaluation[]
  policy: RatingPolicy | null
  featureEnabled: boolean
  businessDate: string
  calculatedAt: string
}): OperationalRatingSummary {
  const base = {
    employeeId: input.employeeId,
    safeLabel: input.safeLabel,
    aggregateRating: null,
    evaluationsCount: 0,
    periodStartsAt: null,
    periodEndsAt: null,
    calculationPolicyVersion: input.policy?.policyVersion ?? null,
    calculatedAt: input.calculatedAt,
  }
  if (!input.featureEnabled) {
    return { ...base, calculationPolicyVersion: null, dataState: 'FEATURE_DISABLED' }
  }
  if (input.policy === null) {
    return { ...base, dataState: 'POLICY_UNDEFINED' }
  }
  const periodStartsAt = periodStart(input.businessDate, input.policy.periodDays)
  const included = includedEvaluations(
    input.evaluations,
    input.employeeId,
    periodStartsAt,
    input.businessDate,
  )
  const withPeriod = {
    ...base,
    evaluationsCount: included.length,
    periodStartsAt,
    periodEndsAt: input.businessDate,
  }
  if (included.length < input.policy.minEvaluations) {
    // Количество учтённых оценок остаётся видимым: «недостаточно» без числа не
    // отвечает на вопрос, сколько ещё нужно.
    return { ...withPeriod, dataState: 'INSUFFICIENT_DATA' }
  }
  const sum = included.reduce((acc, item) => acc + item.score, 0)
  return {
    ...withPeriod,
    aggregateRating: roundAggregate(sum / included.length),
    dataState: 'READY',
  }
}

/** Подпись состояния — формулировки §19.19/§19.3, а не пересказ кода. */
export const DATA_STATE_LABEL: Record<RatingDataState, string> = {
  READY: 'Рассчитан',
  INSUFFICIENT_DATA: 'Недостаточно данных',
  POLICY_UNDEFINED: 'Методика расчёта не определена',
  FEATURE_DISABLED: 'Оперативный рейтинг пока недоступен',
}
