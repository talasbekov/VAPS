// Demo-сид оперативного рейтинга (§8.7: только синтетические данные).
//
// В слайсе лежат ЗАКРЫТЫЕ оценки — наружу они не едут ни одним полем (§19.21);
// клиент получает только серверные агрегаты. Поэтому сид и выглядит «богаче»
// любого ответа API: это и есть смысл закрытых данных.
//
// Состав оцениваемых — СВОЙ, а не импорт кадрового справочника: фичи не читают
// чужие `mocks/` (ARCH-FE-013), и это тот же осознанный дубль, что ростер
// кандидатов в `security-events` (§20.3 — разные bounded context).
import type { EventEvaluation, RatingDynamicsPoint } from '../model/types'

export interface RatingsSlice {
  evaluations: EventEvaluation[]
  /**
   * §19.20: ряд точек динамики — ЗАПИСАННЫЕ агрегаты закрытых периодов, а не
   * производное от `evaluations`. Пересчитывать их из оценок при каждом
   * запросе значило бы применять к прошлому СЕГОДНЯШНЮЮ методику — ровно то,
   * что §19.20 запрещает («не пересчитывай старые точки»). Поэтому у точки
   * своя `policyVersion`, и она НЕ обязана совпадать с текущей.
   */
  dynamicsPoints: RatingDynamicsPoint[]
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

/**
 * Группы участников (§22.16 «аналитика рейтинга»). Свой перечень, а не импорт
 * кадровых подразделений: фичи не читают чужие `mocks/` (ARCH-FE-013), и это
 * тот же осознанный дубль, что и состав оцениваемых.
 *
 * Размеры групп подобраны так, чтобы отчёт демонстрировал ВСЕ три исхода
 * §22.17 сразу: рассчитанный агрегат, подавление малой группы и отсутствие
 * агрегата вовсе. Одинаковые группы делали бы подавление недостижимым.
 */
export const RATING_GROUPS: readonly { groupCode: string; safeLabel: string }[] = [
  { groupCode: 'division-1', safeLabel: 'Первое управление' },
  { groupCode: 'division-2', safeLabel: 'Второе управление' },
  { groupCode: 'division-3', safeLabel: 'Третье управление' },
]

/** Оцениваемые. Подпись безопасная — идентификатора в ней нет (§20.29). */
export const RATED_EMPLOYEES: readonly {
  employeeId: string
  safeLabel: string
  groupCode: string
}[] = [
  { employeeId: 'employee-1', safeLabel: 'Ерланов Д.', groupCode: 'division-1' },
  { employeeId: 'employee-2', safeLabel: 'Абишев Н.', groupCode: 'division-1' },
  { employeeId: 'employee-3', safeLabel: 'Сейтказы М.', groupCode: 'division-2' },
  { employeeId: 'employee-4', safeLabel: 'Нурланов Е.', groupCode: 'division-2' },
  { employeeId: 'employee-5', safeLabel: 'Тлеуов А.', groupCode: 'division-1' },
  { employeeId: 'employee-6', safeLabel: 'Жумабек С.', groupCode: 'division-1' },
  // Третье управление — ровно два участника с агрегатом: меньше порога
  // безопасной агрегации, и на нём держится демонстрация SUPPRESSED (§22.17).
  { employeeId: 'employee-7', safeLabel: 'Оспанов Р.', groupCode: 'division-3' },
  { employeeId: 'employee-8', safeLabel: 'Кайрат Б.', groupCode: 'division-3' },
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

  // Участники, добавленные ради аналитики §22.16: их агрегаты намеренно
  // попадают в РАЗНЫЕ полосы распределения — одинаковые значения скрыли бы
  // подмену распределения одной полосой.
  evaluation('evaluation-14', 'employee-5', 9, '2026-07-03'),
  evaluation('evaluation-15', 'employee-5', 10, '2026-07-07'),
  evaluation('evaluation-16', 'employee-5', 9, '2026-07-12'),
  evaluation('evaluation-17', 'employee-5', 9, '2026-07-16'),

  evaluation('evaluation-18', 'employee-6', 7, '2026-07-04'),
  evaluation('evaluation-19', 'employee-6', 6, '2026-07-08'),
  evaluation('evaluation-20', 'employee-6', 7, '2026-07-12'),
  evaluation('evaluation-21', 'employee-6', 7, '2026-07-17'),

  evaluation('evaluation-22', 'employee-7', 8, '2026-07-02'),
  evaluation('evaluation-23', 'employee-7', 8, '2026-07-09'),
  evaluation('evaluation-24', 'employee-7', 8, '2026-07-14'),
  evaluation('evaluation-25', 'employee-7', 8, '2026-07-18'),

  evaluation('evaluation-26', 'employee-8', 9, '2026-07-05'),
  evaluation('evaluation-27', 'employee-8', 10, '2026-07-10'),
  evaluation('evaluation-28', 'employee-8', 9, '2026-07-15'),
  evaluation('evaluation-29', 'employee-8', 8, '2026-07-19'),
]

/**
 * Редакции методики, под которыми ЗАКРЫВАЛИСЬ периоды (§19.20). Обе — прошлые:
 * текущая редакция раздела «Настроек» (`sectionVersions.RATING_POLICY`) здесь
 * НЕ повторяется и повториться не может — она вступила в силу на ОТКРЫТОМ
 * периоде и ни одного периода ещё не закрывала. Подписать ею старую точку
 * значило бы соврать о том, по какой методике получено число; пересчитать
 * старую точку под неё — прямо запрещено (§19.20).
 */
const POLICY_V1 = 'OPERATIONAL-RATING-2026.01.1'
const POLICY_V2 = 'OPERATIONAL-RATING-2026.05.1'

/** Календарные границы закрытых периодов. Период — месяц: он закрывается один
 * раз и больше не меняется, поэтому его агрегат и можно записать. */
const CLOSED_PERIODS: readonly {
  period: string
  periodStartsAt: string
  periodEndsAt: string
  policyVersion: string
}[] = [
  {
    period: '2026-03',
    periodStartsAt: '2026-03-01',
    periodEndsAt: '2026-03-31',
    policyVersion: POLICY_V1,
  },
  {
    period: '2026-04',
    periodStartsAt: '2026-04-01',
    periodEndsAt: '2026-04-30',
    policyVersion: POLICY_V1,
  },
  {
    period: '2026-05',
    periodStartsAt: '2026-05-01',
    periodEndsAt: '2026-05-31',
    policyVersion: POLICY_V2,
  },
  {
    period: '2026-06',
    periodStartsAt: '2026-06-01',
    periodEndsAt: '2026-06-30',
    policyVersion: POLICY_V2,
  },
]

/**
 * Значения точек по сотрудникам. `null` — за период агрегата НЕТ (оценок было
 * меньше минимума): §19.19 запрещает показывать такую точку нулём, а §19.20 —
 * соединять через неё соседей одной линией.
 *
 * Числа подобраны так, чтобы ряд ломался по обеим причинам сразу, а не по
 * одной: у `employee-1` пропуск приходится ровно на смену методики, у
 * `employee-3` пропуски стоят по краям, у `employee-4` агрегата не было
 * никогда — рейтинг отсутствует, а не равен нулю (§19.2).
 */
const DYNAMICS_VALUES: readonly {
  employeeId: string
  values: readonly (readonly [number | null, number])[]
}[] = [
  {
    employeeId: 'employee-1',
    values: [
      [8.1, 6],
      [7.9, 5],
      [null, 2],
      [8.6, 7],
    ],
  },
  {
    employeeId: 'employee-2',
    values: [
      [7.2, 4],
      [7.6, 5],
      [7.4, 4],
      [7.9, 6],
    ],
  },
  {
    employeeId: 'employee-3',
    values: [
      [null, 1],
      [8.3, 4],
      [8.0, 5],
      [null, 3],
    ],
  },
  {
    employeeId: 'employee-4',
    values: [
      [null, 0],
      [null, 0],
      [null, 0],
      [null, 0],
    ],
  },
]

/** Ряд точек динамики (§19.20) — по одной записи на «сотрудник × закрытый период». */
export const DYNAMICS_POINTS: readonly RatingDynamicsPoint[] = DYNAMICS_VALUES.flatMap((row) =>
  CLOSED_PERIODS.map((closed, index) => {
    const [aggregateRating, evaluationsCount] = row.values[index]
    return {
      employeeId: row.employeeId,
      period: closed.period,
      periodStartsAt: closed.periodStartsAt,
      periodEndsAt: closed.periodEndsAt,
      aggregateRating,
      evaluationsCount,
      policyVersion: closed.policyVersion,
      dataState: aggregateRating === null ? ('INSUFFICIENT_DATA' as const) : ('READY' as const),
      // Точка фиксируется на следующие сутки после закрытия периода: закрытый
      // период считается один раз, и время расчёта — часть записи.
      recordedAt: `${closed.periodEndsAt}T23:59:00+05:00`,
    }
  }),
)

export function buildRatingsSeed(): { sliceName: string; data: RatingsSlice } {
  return {
    sliceName: 'ratings',
    data: {
      evaluations: EVALUATIONS.map((item) => ({ ...item })),
      dynamicsPoints: DYNAMICS_POINTS.map((item) => ({ ...item })),
      capabilities: { operationalRatings: true, ratingConflicts: false },
    },
  }
}
