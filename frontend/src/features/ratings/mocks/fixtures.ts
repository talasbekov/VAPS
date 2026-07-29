// Demo-сид оперативного рейтинга (§8.7: только синтетические данные).
//
// В слайсе лежат ЗАКРЫТЫЕ оценки — наружу они не едут ни одним полем (§19.21);
// клиент получает только серверные агрегаты. Поэтому сид и выглядит «богаче»
// любого ответа API: это и есть смысл закрытых данных.
//
// Состав оцениваемых — СВОЙ, а не импорт кадрового справочника: фичи не читают
// чужие `mocks/` (ARCH-FE-013), и это тот же осознанный дубль, что ростер
// кандидатов в `security-events` (§20.3 — разные bounded context).
import type { EventEvaluation } from '../model/types'

export interface RatingsSlice {
  evaluations: EventEvaluation[]
  /**
   * §19.3 «Поддержи независимые flags». Флаг лежит В ДАННЫХ, а не в сборке:
   * выключенная функция обязана давать честное состояние недоступности на
   * живом экране, а `import.meta.env` такое состояние не проверить.
   *
   * `ratingConflicts` выключен: `post.min_rating` в модели постов нет вовсе,
   * и включённый флаг обещал бы проверку, которой не существует (§35).
   */
  capabilities: { operationalRatings: boolean; ratingConflicts: boolean }
}

/** Оцениваемые. Подпись безопасная — идентификатора в ней нет (§20.29). */
export const RATED_EMPLOYEES: readonly { employeeId: string; safeLabel: string }[] = [
  { employeeId: 'employee-1', safeLabel: 'Ерланов Д.' },
  { employeeId: 'employee-2', safeLabel: 'Абишев Н.' },
  { employeeId: 'employee-3', safeLabel: 'Сейтказы М.' },
  { employeeId: 'employee-4', safeLabel: 'Нурланов Е.' },
]

function evaluation(
  id: string,
  employeeId: string,
  score: number,
  evaluatedAt: string,
  extra: Partial<EventEvaluation> = {},
): EventEvaluation {
  return {
    id,
    securityEventId: 'event-1',
    employeeId,
    evaluatorUserId: 'demo-event-planner',
    score,
    // Комментарий обязателен при оценке НИЖЕ 8 (§19.1 — прежнее правило
    // «выше 8 или ниже 6» ошибочно). В сиде он есть ровно там, где обязателен.
    comment: score < 8 ? 'Задержка на инструктаже, разобрано со старшим' : null,
    evaluatedAt,
    supersededById: null,
    ...extra,
  }
}

/**
 * Оценки. Числа НАМЕРЕННО не одинаковые и не круглые: среднее 8,0 совпало бы
 * со «стандартной оценкой 8» и скрыло бы подмену расчёта константой.
 *
 * `employee-1` — 5 оценок, включая одну ВЫТЕСНЕННУЮ исправлением: она обязана
 * не влиять на агрегат, и это проверяется тестом, а не подразумевается.
 * `employee-2` — ровно минимум оценок политики. `employee-3` — меньше минимума
 * (состояние «Недостаточно данных»). `employee-4` — оценок нет вовсе: рейтинг
 * отсутствует, а не равен нулю (§19.2).
 */
export const EVALUATIONS: readonly EventEvaluation[] = [
  evaluation('evaluation-1', 'employee-1', 9, '2026-07-02'),
  evaluation('evaluation-2', 'employee-1', 8, '2026-07-08'),
  evaluation('evaluation-3', 'employee-1', 7, '2026-07-11'),
  // Исправленная оценка и её замена: §19.1 «исправления проводить через
  // отдельную неизменяемую запись» — исходная не переписывается, а помечается.
  evaluation('evaluation-4', 'employee-1', 3, '2026-07-14', {
    supersededById: 'evaluation-5',
    comment: 'Оценка выставлена по ошибке не тому участнику',
  }),
  evaluation('evaluation-5', 'employee-1', 9, '2026-07-15'),
  evaluation('evaluation-6', 'employee-1', 10, '2026-07-17'),

  evaluation('evaluation-7', 'employee-2', 6, '2026-07-05'),
  evaluation('evaluation-8', 'employee-2', 8, '2026-07-09'),
  evaluation('evaluation-9', 'employee-2', 7, '2026-07-13'),
  evaluation('evaluation-10', 'employee-2', 9, '2026-07-18'),

  evaluation('evaluation-11', 'employee-3', 8, '2026-07-06'),
  evaluation('evaluation-12', 'employee-3', 9, '2026-07-16'),

  // Оценка ЗА ПРЕДЕЛАМИ периода расчёта: без неё период было бы нечем
  // проверить — все оценки и так попадали бы в окно.
  evaluation('evaluation-13', 'employee-4', 10, '2025-11-04'),
]

export function buildRatingsSeed(): { sliceName: string; data: RatingsSlice } {
  return {
    sliceName: 'ratings',
    data: {
      evaluations: EVALUATIONS.map((item) => ({ ...item })),
      capabilities: { operationalRatings: true, ratingConflicts: false },
    },
  }
}
