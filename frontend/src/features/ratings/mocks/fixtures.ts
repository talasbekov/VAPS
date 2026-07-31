// Demo-сид оперативного рейтинга (§8.7: только синтетические данные).
//
// В слайсе лежат ЗАКРЫТЫЕ оценки — наружу они не едут ни одним полем (§19.21);
// клиент получает только серверные агрегаты. Поэтому сид и выглядит «богаче»
// любого ответа API: это и есть смысл закрытых данных.
//
// Состав оцениваемых — СВОЙ, а не импорт кадрового справочника: фичи не читают
// чужие `mocks/` (ARCH-FE-013), и это тот же осознанный дубль, что ростер
// кандидатов в `security-events` (§20.3 — разные bounded context).
import type {
  EvaluationBasis,
  EvaluationCorrection,
  EvaluationWorkItem,
  EventEvaluation,
  RatingDynamicsPoint,
} from '../model/types'

export interface RatingsSlice {
  evaluations: EventEvaluation[]
  /**
   * §19.7: задания на оценивание — repository-backed состояние с устойчивыми
   * идентификаторами, переживающее refresh. Фронт их не создаёт и не
   * пересоздаёт («не создавай work item после refresh», «не генерируй
   * evaluation ID»), поэтому они и лежат в слайсе, а не собираются в ответе.
   */
  workItems: EvaluationWorkItem[]
  /**
   * §19.18: исправления — ОТДЕЛЬНЫЕ записи. Исходная оценка не переписывается и
   * не удаляется; цепочка «что чем заменено и почему» живёт здесь, а не в
   * изменённых полях оценки.
   */
  corrections: EvaluationCorrection[]
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
    evaluationDirection: 'SENIOR_TO_EMPLOYEE',
    method: 'MANUAL',
    basisCode: score < 8 ? 'TIMELY_ARRIVAL' : 'EXECUTION_OF_DUTIES',
    basisNote: null,
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

  // Оценка ДРУГОГО оценщика: без неё «в отправленных только свои» проверялось
  // бы на пустом множестве — чужой записи просто не существовало бы.
  evaluation('evaluation-11', 'employee-3', 8, '2026-07-06', {
    evaluatorUserId: 'demo-recon-officer',
  }),
  evaluation('evaluation-12', 'employee-3', 9, '2026-07-16'),

  // Оценка ЗА ПРЕДЕЛАМИ периода расчёта: без неё период было бы нечем
  // проверить — все оценки и так попадали бы в окно.
  //
  // Она же — СИСТЕМНАЯ оценка по умолчанию (§19.8): политика зафиксировала
  // восьмёрку участнику, которого никто не оценивал. Оценщика у неё нет
  // (`evaluatorUserId: null`) — приписать её человеку значило бы сказать, что
  // он этого участника смотрел. Задания она не порождает и в очередь не
  // попадает: задание — это работа, а системная восьмёрка её отсутствие.
  evaluation('evaluation-13', 'employee-4', 8, '2025-11-04', {
    evaluatorUserId: null,
    method: 'SYSTEM_DEFAULT',
    basisCode: null,
  }),

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

/**
 * Мероприятия, по которым есть задания (§19.14 шапка). Свой перечень — фичи не
 * читают чужие `mocks/` (ARCH-FE-013), тот же осознанный дубль, что и состав
 * оцениваемых. Мероприятий ДВА намеренно: с одним переключатель мероприятия
 * был бы декорацией, а отбор заданий по мероприятию — непроверяемым.
 */
export const EVALUATION_EVENTS: readonly {
  securityEventId: string
  eventRunId: string
  number: string
  title: string
  objectLabel: string
  actualStartsAt: string
  actualEndsAt: string
  stateLabel: string
}[] = [
  {
    securityEventId: 'event-1',
    eventRunId: 'run-1',
    number: 'ОМ-2026-014',
    title: 'Международный форум',
    objectLabel: 'Конгресс-холл',
    actualStartsAt: '2026-07-18T07:40:00+05:00',
    actualEndsAt: '2026-07-18T19:20:00+05:00',
    stateLabel: 'Завершено',
  },
  {
    securityEventId: 'event-2',
    eventRunId: 'run-2',
    number: 'ОМ-2026-015',
    title: 'Рабочая поездка',
    objectLabel: 'Аэропорт',
    actualStartsAt: '2026-07-20T05:10:00+05:00',
    actualEndsAt: '2026-07-20T12:05:00+05:00',
    stateLabel: 'Завершено',
  },
]

/**
 * Основания оценки (§19.10). Перечень отдаёт СЕРВЕР — «основание не должно
 * быть произвольным frontend-only справочником». Коды здесь свои, потому что
 * backend Smart Josparlau не существует (`backend-contract-pending`), и это
 * сказано вслух, а не выдано за подтверждённые коды.
 */
export const EVALUATION_BASES: readonly EvaluationBasis[] = [
  { code: 'EXECUTION_OF_DUTIES', label: 'Исполнение обязанностей', requiresNote: false },
  { code: 'TIMELY_ARRIVAL', label: 'Своевременное прибытие', requiresNote: false },
  { code: 'DISCIPLINE', label: 'Дисциплина', requiresNote: false },
  { code: 'POST_KNOWLEDGE', label: 'Знание задач поста', requiresNote: false },
  { code: 'ORDERS_EXECUTION', label: 'Исполнение указаний', requiresNote: false },
  { code: 'INTERACTION', label: 'Взаимодействие', requiresNote: false },
  { code: 'NON_STANDARD_SITUATION', label: 'Действия в нестандартной ситуации', requiresNote: false },
  // §19.10: «если выбрано „Другое“, требуй пояснение согласно policy».
  { code: 'OTHER', label: 'Другое', requiresNote: true },
]

function workItem(
  id: string,
  overrides: Partial<EvaluationWorkItem> & {
    securityEventId: string
    evaluatorUserId: string
    targetEmployeeId: string
    postLabel: string
  },
): EvaluationWorkItem {
  const event = EVALUATION_EVENTS.find(
    (item) => item.securityEventId === overrides.securityEventId,
  )
  if (event === undefined) throw new Error(`fixtures: неизвестное мероприятие ${id}`)
  const target = RATED_EMPLOYEES.find((item) => item.employeeId === overrides.targetEmployeeId)
  if (target === undefined) throw new Error(`fixtures: неизвестный участник ${id}`)
  const group = RATING_GROUPS.find((item) => item.groupCode === target.groupCode)
  return {
    id,
    eventRunId: event.eventRunId,
    assignmentId: `assignment-${id}`,
    targetGroupId: null,
    targetSafeLabel: target.safeLabel,
    targetSafeUnitLabel: group?.safeLabel ?? '—',
    actualStartsAt: event.actualStartsAt,
    actualEndsAt: event.actualEndsAt,
    participated: true,
    evaluationDirection: 'SENIOR_TO_EMPLOYEE',
    // Начальное значение даёт СЕРВЕР (§19.8): в форме его не подставляют.
    initialScore: 8,
    status: 'PENDING',
    revision: 1,
    submittedEvaluationId: null,
    submittedAt: null,
    ...overrides,
  }
}

/**
 * Задания на оценивание (§19.7).
 *
 * Состав подобран так, чтобы правила §19.14 были ПРОВЕРЯЕМЫ, а не
 * подразумевались: у одного оценщика задания в двух мероприятиях (отбор по
 * мероприятию), одно уже отправлено (вкладка «Отправленные мной» не пуста с
 * первого запуска), одно направлено снизу вверх (`EMPLOYEE_TO_SENIOR`), у
 * одного участника отмечено НЕучастие (факт участия — не то же, что наличие
 * задания), и есть задания ЧУЖОГО оценщика (иначе отбор по оценщику был бы
 * вакуумным: чужого задания просто не существовало бы).
 */
export const WORK_ITEMS: readonly EvaluationWorkItem[] = [
  workItem('work-item-1', {
    securityEventId: 'event-1',
    evaluatorUserId: 'demo-event-planner',
    targetEmployeeId: 'employee-1',
    postLabel: 'Пост 1 — главный вход',
  }),
  workItem('work-item-2', {
    securityEventId: 'event-1',
    evaluatorUserId: 'demo-event-planner',
    targetEmployeeId: 'employee-2',
    postLabel: 'Пост 2 — зона делегаций',
    // Участник заявлен, но не присутствовал: §19.9 требует показывать факт
    // участия отдельно, а не выводить его из наличия задания.
    participated: false,
  }),
  workItem('work-item-3', {
    securityEventId: 'event-1',
    evaluatorUserId: 'demo-event-planner',
    targetEmployeeId: 'employee-5',
    postLabel: 'Старший смены',
    evaluationDirection: 'EMPLOYEE_TO_SENIOR',
  }),
  // Отправленное задание. Оценка, которую оно породило, лежит в `EVALUATIONS`
  // (`evaluation-6`): связь идёт от задания к записи, а не наоборот.
  workItem('work-item-4', {
    securityEventId: 'event-1',
    evaluatorUserId: 'demo-event-planner',
    targetEmployeeId: 'employee-6',
    postLabel: 'Пост 3 — периметр',
    status: 'SUBMITTED',
    revision: 2,
    submittedEvaluationId: 'evaluation-21',
    submittedAt: '2026-07-18T20:05:00+05:00',
  }),
  // Задание с УЖЕ исправленной оценкой: его отправленная запись —
  // `evaluation-5`, замещающая `evaluation-4` (см. `CORRECTIONS`). Без него
  // цепочку исправлений неоткуда было бы открыть на экране.
  workItem('work-item-9', {
    securityEventId: 'event-1',
    evaluatorUserId: 'demo-event-planner',
    targetEmployeeId: 'employee-1',
    postLabel: 'Пост 1 — главный вход (повторная смена)',
    status: 'SUBMITTED',
    revision: 3,
    submittedEvaluationId: 'evaluation-5',
    submittedAt: '2026-07-15T09:20:00+05:00',
  }),
  workItem('work-item-5', {
    securityEventId: 'event-2',
    evaluatorUserId: 'demo-event-planner',
    targetEmployeeId: 'employee-7',
    postLabel: 'Пост 1 — накопитель',
  }),
  // Чужие задания: они не должны попадать ни в очередь, ни в отправленные
  // другого человека (§19.14), зато обязаны попадать в сводку мероприятия —
  // она считает работу ВСЕХ оценщиков.
  workItem('work-item-6', {
    securityEventId: 'event-1',
    evaluatorUserId: 'demo-recon-officer',
    targetEmployeeId: 'employee-8',
    postLabel: 'Пост 4 — стоянка',
  }),
  // Задание администратора-эталона: у него wildcard, поэтому только на нём
  // демонстрируется вкладка «Сводка мероприятия» ЖИВЬЁМ (§19.14). Организатор
  // ОМ права на агрегат не имеет — вкладки у него нет, и это разделение
  // недемонстрируемо, если у обеих persona одинаковые права.
  workItem('work-item-8', {
    securityEventId: 'event-1',
    evaluatorUserId: 'demo-admin',
    targetEmployeeId: 'employee-4',
    postLabel: 'Пост 6 — пресс-центр',
  }),
  workItem('work-item-7', {
    securityEventId: 'event-1',
    evaluatorUserId: 'demo-recon-officer',
    targetEmployeeId: 'employee-3',
    postLabel: 'Пост 5 — служебный вход',
    status: 'SUBMITTED',
    revision: 2,
    submittedEvaluationId: 'evaluation-11',
    submittedAt: '2026-07-18T20:40:00+05:00',
  }),
]

/**
 * Исправления (§19.18). В сиде есть УЖЕ исправленная оценка (`evaluation-4` →
 * `evaluation-5`): без неё correction chain на экране была бы пустой с первого
 * запуска, а «цепочка показывается» проверялось бы на отсутствующих данных.
 */
export const CORRECTIONS: readonly EvaluationCorrection[] = [
  {
    id: 'correction-1',
    originalEvaluationId: 'evaluation-4',
    replacementEvaluationId: 'evaluation-5',
    reason: 'Оценка выставлена по ошибке не тому участнику',
    correctedBy: 'demo-event-planner',
    correctedAt: '2026-07-15T09:20:00+05:00',
    revision: 1,
  },
]

export function buildRatingsSeed(): { sliceName: string; data: RatingsSlice } {
  return {
    sliceName: 'ratings',
    data: {
      evaluations: EVALUATIONS.map((item) => ({ ...item })),
      workItems: WORK_ITEMS.map((item) => ({ ...item })),
      corrections: CORRECTIONS.map((item) => ({ ...item })),
      dynamicsPoints: DYNAMICS_POINTS.map((item) => ({ ...item })),
      capabilities: { operationalRatings: true, ratingConflicts: false },
    },
  }
}
