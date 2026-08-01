// Аналитика ОМ (§22.13, §22.15). Чистая модель: ни React, ни apiClient.
//
// ⚠️ Считается ЗДЕСЬ, вызывается из mock-repository — то есть с «серверной»
// стороны, как и показатели службы: §22.3 запрещает фронтенду считать итоги, и
// «итог по видимой части таблицы» стоит в том же списке.
//
// ⚠️ §22.14 «Воронка ОМ» требует строить конверсию по СЕРВЕРНЫМ transition
// events, а не по текущему массиву карточек. До Этапа 46 таких событий в
// модели не было, и воронка честно называлась недоступной; теперь журнал
// переходов ведётся (`security-events`, append-only), и воронка строится
// ТОЛЬКО по нему — см. `buildFunnel` внизу файла.
import type {
  LifecycleBucket,
  OpsBreadcrumbItem,
  OpsCell,
  OpsColumn,
  OpsEventCard,
  OpsFact,
  OpsLevel,
  OpsRow,
} from '../model/types'

/** Узкая проекция чужого слайса ОМ (см. mocks/securityEventsSlice.ts). */
export interface OpsSourcePost {
  postId: string
  sectorLabel: string
  /** Сектор привязанной версии паспорта; `null` у строки, заведённой руками. */
  sourceSectorId: string | null
  postLabel: string
  need: number
  assigned: number
  acknowledged: number
}

export interface OpsSourceEvent {
  id: string
  code: string
  title: string
  objectId: string | null
  objectName: string
  businessDate: string
  stageCode: string
  readinessPercent: number | null
  conflictsCount: number
  demandApproved: boolean
  demandNeedTotal: number
  requestedTotal: number
  allocatedTotal: number
  incidentsCount: number
  closedAt: string | null
  posts: OpsSourcePost[]
}

/** §22.13 «Используй только состояния из Lifecycle Registry». Реестр приходит
 * ИЗ ДАННЫХ: подписи стадий живут в чужой feature, и дубль строкой в коде
 * разошёлся бы с ней молча. */
export interface LifecycleStateDefinition {
  stateCode: string
  safeLabel: string
}

export const OPS_CALCULATION_VERSION = 'operations-analytics-2026.07.1'

/** Идентификатор корзины ОМ, у которых объекта в реестре НЕТ. Все такие ОМ
 * лежат вместе и названы честно: свести их по `objectName` значило бы сделать
 * ровно ту склейку по имени, которую запрещают §22.15 и A44-A46. */
export const UNBOUND_OBJECT_ID = 'object:unbound'

export const OPS_COLUMNS = {
  events: { code: 'EVENTS', safeLabel: 'ОМ' },
  demandApproved: { code: 'DEMAND_APPROVED', safeLabel: 'Потребность утверждена' },
  demandNeed: { code: 'DEMAND_NEED', safeLabel: 'Утверждённая потребность' },
  requested: { code: 'REQUESTED', safeLabel: 'Запрошено' },
  allocated: { code: 'ALLOCATED', safeLabel: 'Выделено' },
  assigned: { code: 'ASSIGNED', safeLabel: 'Назначено' },
  acknowledged: { code: 'ACKNOWLEDGED', safeLabel: 'Ознакомлено' },
  conflicts: { code: 'CONFLICTS', safeLabel: 'Конфликты' },
  incidents: { code: 'INCIDENTS', safeLabel: 'Записи об инцидентах' },
  posts: { code: 'POSTS', safeLabel: 'Постов' },
  need: { code: 'NEED', safeLabel: 'Требуется по расчёту' },
} as const

/**
 * §22.15 «Не смешивай запрошено, выделено, назначено и фактически
 * участвовало»: у каждого своя колонка со своей подписью, и ни одна из них не
 * складывается с другой. Набор колонок принадлежит УРОВНЮ — на уровне поста
 * «запрошено» неизвестно, и пустая колонка читалась бы как ноль.
 */
export function columnsFor(level: OpsLevel): OpsColumn[] {
  switch (level) {
    case 'ALL':
    case 'OBJECT':
      return [
        OPS_COLUMNS.events,
        OPS_COLUMNS.demandNeed,
        OPS_COLUMNS.requested,
        OPS_COLUMNS.allocated,
        OPS_COLUMNS.assigned,
        OPS_COLUMNS.acknowledged,
        OPS_COLUMNS.conflicts,
        OPS_COLUMNS.incidents,
      ]
    case 'EVENT':
      return [OPS_COLUMNS.posts, OPS_COLUMNS.need, OPS_COLUMNS.assigned, OPS_COLUMNS.acknowledged]
    case 'DIRECTION':
      return [OPS_COLUMNS.need, OPS_COLUMNS.assigned, OPS_COLUMNS.acknowledged]
    case 'POST':
      return [OPS_COLUMNS.assigned, OPS_COLUMNS.acknowledged]
  }
}

function cell(code: string, value: number): OpsCell {
  return { code, value, unavailableReason: null }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * Идентификатор направления. Собирается СЕРВЕРОМ и всегда содержит id ОМ:
 * одинаково названный сектор в двух мероприятиях — ДВА разных направления, и
 * склеивать их по названию нельзя (§22.15).
 *
 * `sourceSectorId` используется, когда строка расчёта импортирована из
 * паспорта. Когда её завели руками, связи с сектором паспорта НЕТ — и мы её не
 * изображаем: идентификатор помечен `local:`, а подпись говорит об этом вслух.
 */
export function directionId(eventId: string, post: OpsSourcePost): string {
  return post.sourceSectorId === null
    ? `${eventId}::local:${post.sectorLabel}`
    : `${eventId}::${post.sourceSectorId}`
}

function directionLabel(post: OpsSourcePost): string {
  return post.sourceSectorId === null
    ? `Сектор ${post.sectorLabel} (расчёт ОМ, без связи с паспортом)`
    : `Сектор ${post.sectorLabel}`
}

function eventCells(events: OpsSourceEvent[]): OpsCell[] {
  const posts = events.flatMap((event) => event.posts)
  return [
    cell(OPS_COLUMNS.events.code, events.length),
    cell(
      OPS_COLUMNS.demandNeed.code,
      // Только УТВЕРЖДЁННАЯ потребность (§22.13 называет её отдельным
      // измерением): черновые строки — ещё не обязательство.
      sum(events.filter((event) => event.demandApproved).map((event) => event.demandNeedTotal)),
    ),
    cell(OPS_COLUMNS.requested.code, sum(events.map((event) => event.requestedTotal))),
    cell(OPS_COLUMNS.allocated.code, sum(events.map((event) => event.allocatedTotal))),
    cell(OPS_COLUMNS.assigned.code, sum(posts.map((post) => post.assigned))),
    cell(OPS_COLUMNS.acknowledged.code, sum(posts.map((post) => post.acknowledged))),
    cell(OPS_COLUMNS.conflicts.code, sum(events.map((event) => event.conflictsCount))),
    cell(OPS_COLUMNS.incidents.code, sum(events.map((event) => event.incidentsCount))),
  ]
}

/** §22.13 распределение по lifecycle + коды вне реестра ОТДЕЛЬНО. */
export function lifecycleDistribution(
  events: readonly OpsSourceEvent[],
  registry: readonly LifecycleStateDefinition[],
): { buckets: LifecycleBucket[]; unknownCodes: string[] } {
  const counts = new Map<string, number>()
  for (const event of events) {
    counts.set(event.stageCode, (counts.get(event.stageCode) ?? 0) + 1)
  }
  const buckets = registry.map((state) => ({
    stateCode: state.stateCode,
    safeLabel: state.safeLabel,
    count: counts.get(state.stateCode) ?? 0,
  }))
  const known = new Set(registry.map((state) => state.stateCode))
  const unknownCodes = [...counts.keys()].filter((code) => !known.has(code)).sort()
  return { buckets, unknownCodes }
}

export function objectRows(events: readonly OpsSourceEvent[]): OpsRow[] {
  const groups = new Map<string, OpsSourceEvent[]>()
  for (const event of events) {
    const key = event.objectId ?? UNBOUND_OBJECT_ID
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  return [...groups.entries()]
    .map(([objectId, group]) => ({
      rowId: objectId,
      safeLabel:
        objectId === UNBOUND_OBJECT_ID
          ? 'Объект вне реестра (связь по названию не выводится)'
          : group[0].objectName,
      childLevel: 'OBJECT' as const,
      cells: eventCells(group),
    }))
    .sort((a, b) => a.safeLabel.localeCompare(b.safeLabel))
}

export function eventRows(events: readonly OpsSourceEvent[]): OpsRow[] {
  return [...events]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.code.localeCompare(b.code))
    .map((event) => ({
      rowId: event.id,
      safeLabel: `${event.code} · ${event.title}`,
      childLevel: 'EVENT' as const,
      cells: eventCells([event]),
    }))
}

export function directionRows(event: OpsSourceEvent): OpsRow[] {
  const groups = new Map<string, OpsSourcePost[]>()
  for (const post of event.posts) {
    const key = directionId(event.id, post)
    groups.set(key, [...(groups.get(key) ?? []), post])
  }
  return [...groups.entries()]
    .map(([id, posts]) => ({
      rowId: id,
      safeLabel: directionLabel(posts[0]),
      childLevel: 'DIRECTION' as const,
      cells: [
        cell(OPS_COLUMNS.posts.code, posts.length),
        cell(OPS_COLUMNS.need.code, sum(posts.map((post) => post.need))),
        cell(OPS_COLUMNS.assigned.code, sum(posts.map((post) => post.assigned))),
        cell(OPS_COLUMNS.acknowledged.code, sum(posts.map((post) => post.acknowledged))),
      ],
    }))
    .sort((a, b) => a.safeLabel.localeCompare(b.safeLabel))
}

export function postRows(event: OpsSourceEvent, direction: string): OpsRow[] {
  return event.posts
    .filter((post) => directionId(event.id, post) === direction)
    .map((post) => ({
      rowId: post.postId,
      safeLabel: post.postLabel,
      childLevel: 'POST' as const,
      cells: [
        cell(OPS_COLUMNS.need.code, post.need),
        cell(OPS_COLUMNS.assigned.code, post.assigned),
        cell(OPS_COLUMNS.acknowledged.code, post.acknowledged),
      ],
    }))
}

/** Последний уровень §22.15 — АГРЕГИРОВАННЫЕ данные участия, не список людей:
 * поимённая детализация требует своего права (§22.26) и здесь не выдаётся. */
export function participationRows(post: OpsSourcePost): OpsRow[] {
  return [
    {
      rowId: post.postId,
      safeLabel: 'Участие по посту (агрегированно)',
      childLevel: null,
      cells: [
        cell(OPS_COLUMNS.assigned.code, post.assigned),
        cell(OPS_COLUMNS.acknowledged.code, post.acknowledged),
      ],
    },
  ]
}

function fact(
  code: string,
  safeLabel: string,
  displayValue: string,
  unavailableReason: string | null = null,
): OpsFact {
  return { code, safeLabel, displayValue, unavailableReason }
}

/**
 * §22.15 карточка уровня ОМ. Из ПЯТНАДЦАТИ названных полей модель даёт
 * двенадцать; `revision`, «фактически участвовало» и «готовность к закрытию»
 * приходят С ПРИЧИНОЙ, а не нулём и не пустой строкой (§35): пустое поле
 * читается как «данных нет», молчание — как «учтено».
 */
export function buildEventCard(
  event: OpsSourceEvent,
  registry: readonly LifecycleStateDefinition[],
): OpsEventCard {
  const state = registry.find((item) => item.stateCode === event.stageCode)
  const assigned = sum(event.posts.map((post) => post.assigned))
  const acknowledged = sum(event.posts.map((post) => post.acknowledged))
  return {
    eventId: event.id,
    code: event.code,
    safeLabel: event.title,
    facts: [
      fact('CODE', 'Код', event.code),
      fact(
        'OBJECT',
        'Объект',
        event.objectId === null
          ? `${event.objectName} — объекта нет в реестре`
          : event.objectName,
      ),
      fact('PERIOD', 'Период', event.businessDate),
      fact(
        'LIFECYCLE',
        'Состояние жизненного цикла',
        state?.safeLabel ??
          `${event.stageCode} — состояния нет в Lifecycle Registry`,
      ),
      fact(
        'REVISION',
        'Revision',
        'нет данных',
        'Формальной редакции у ОМ в модели нет: изменения пишутся в саму карточку, версии не нумеруются. Показать «1» значило бы придумать номер.',
      ),
      fact(
        'READINESS',
        'Готовность',
        event.readinessPercent === null ? 'нет данных' : `${event.readinessPercent}%`,
      ),
      fact(
        'DEMAND',
        'Утверждённая потребность',
        event.demandApproved ? String(event.demandNeedTotal) : 'потребность не утверждена',
      ),
      fact('REQUESTED', 'Запрошено', String(event.requestedTotal)),
      fact('ALLOCATED', 'Выделено', String(event.allocatedTotal)),
      fact('ASSIGNED', 'Назначено', String(assigned)),
      fact(
        'ACTUAL',
        'Фактически участвовало',
        'нет данных',
        'Факта участия в ОМ модель не ведёт: отмечается только ознакомление, а заступление и завершение есть у дежурств, но не у мероприятий. Приравнять факт к назначению значило бы записать в участники того, кто мог не выйти.',
      ),
      fact('ACKNOWLEDGED', 'Ознакомлено', String(acknowledged)),
      fact('CONFLICTS', 'Конфликты', String(event.conflictsCount)),
      fact('INCIDENTS', 'Записи об инцидентах', String(event.incidentsCount)),
      fact(
        'CLOSURE_READY',
        'Готовность к закрытию',
        event.closedAt === null ? 'мероприятие не закрыто' : 'закрыто',
        'Правила «можно ли закрыть» в модели нет — есть только факт закрытия. Вывести готовность из заполненности итогов значило бы придумать проверку, которой сервер не делает.',
      ),
    ],
  }
}

export function breadcrumbFor(
  level: OpsLevel,
  parts: {
    objectId?: string
    objectLabel?: string
    eventId?: string
    eventLabel?: string
    directionId?: string
    directionLabel?: string
    postId?: string
    postLabel?: string
  },
): OpsBreadcrumbItem[] {
  const trail: OpsBreadcrumbItem[] = [{ level: 'ALL', id: null, safeLabel: 'Все ОМ' }]
  if (level === 'ALL') return trail
  trail.push({ level: 'OBJECT', id: parts.objectId ?? null, safeLabel: parts.objectLabel ?? '' })
  if (level === 'OBJECT') return trail
  trail.push({ level: 'EVENT', id: parts.eventId ?? null, safeLabel: parts.eventLabel ?? '' })
  if (level === 'EVENT') return trail
  trail.push({
    level: 'DIRECTION',
    id: parts.directionId ?? null,
    safeLabel: parts.directionLabel ?? '',
  })
  if (level === 'DIRECTION') return trail
  trail.push({ level: 'POST', id: parts.postId ?? null, safeLabel: parts.postLabel ?? '' })
  return trail
}

/** §35: измерения §22.13/§22.14, которых модель ОМ не даёт. */
export const UNAVAILABLE_OPS_MEASURES = [
  {
    code: 'OVERDUE_ACTIONS',
    label: 'Просроченные действия',
    reason:
      'Сроков у действий ОМ модель не хранит: у мероприятия есть дата проведения, но нет ни плановых сроков этапов, ни дедлайнов согласования. Просрочка без срока — не измерение.',
  },
  {
    code: 'CANCELLED_COUNT',
    label: 'Количество отменённых ОМ (§22.14)',
    reason:
      'Состояний «отменено» и «приостановлено» у мероприятия нет: отменить ОМ через UI нельзя, и журнал переходов такого события не содержит. Показать ноль значило бы утверждать, что отмен не было, — а мы утверждаем лишь, что их негде записать.',
  },
  {
    code: 'OPEN_INCIDENTS',
    label: 'Открытые инциденты',
    reason:
      'Записи журнала штаба типа «инцидент» не имеют состояния «открыт/закрыт» — их можно посчитать, но нельзя разделить. Показывать все записи как открытые значило бы объявить незакрытым то, что могло быть разобрано.',
  },
  {
    code: 'ACTUAL_PARTICIPATION',
    label: 'Фактическое участие',
    reason:
      'Факт участия в ОМ не фиксируется: отмечается только ознакомление. Приравнять факт к назначению — записать в участники того, кто мог не выйти.',
  },
] as const

// ─── §22.14 Воронка ОМ ──────────────────────────────────────────────────────
//
// ⚠️ Строится ТОЛЬКО по журналу переходов. Массив карточек сюда не передаётся
// вовсе — кроме одного показателя, который по определению читается из текущего
// состояния («находящихся на этапе»), и он назван так, чтобы его нельзя было
// перепутать с «достигшими».

/** Событие перехода в проекции аналитики (см. mocks/securityEventsSlice.ts). */
export interface OpsSourceTransition {
  eventId: string
  fromStage: string | null
  toStage: string
  kind: 'FORWARD' | 'RETURN'
  occurredAt: string
}

/**
 * §22.14 «Различай…» — ШЕСТЬ разных показателей. Держатся раздельно и никогда
 * не складываются: у них разные единицы (ОМ, переходы, часы) и разный смысл.
 */
export const FUNNEL_MEASURES = {
  reached: { code: 'REACHED', safeLabel: 'ОМ, достигших этапа', unit: 'ОМ' },
  current: { code: 'CURRENT', safeLabel: 'ОМ, находящихся на этапе', unit: 'ОМ' },
  transitions: { code: 'TRANSITIONS', safeLabel: 'Переходов', unit: 'переходов' },
  returns: { code: 'RETURNS', safeLabel: 'Возвратов', unit: 'переходов' },
  averageHours: { code: 'AVERAGE_HOURS', safeLabel: 'Среднее время этапа', unit: 'ч' },
  medianHours: { code: 'MEDIAN_HOURS', safeLabel: 'Медиана времени этапа', unit: 'ч' },
} as const

export interface FunnelStageRow {
  stateCode: string
  safeLabel: string
  /** Значения ПО КОДУ показателя. `null` — значение не посчитано (нет ни
   * одного завершённого интервала), и это не ноль часов. */
  values: Record<string, number | null>
}

export interface FunnelData {
  stages: FunnelStageRow[]
  measures: { code: string; safeLabel: string; unit: string }[]
  /** §22.14: ОМ, исключённые из конверсии, и почему. Пустой список с ЯВНОЙ
   * причиной — тоже утверждение: «исключать нечего», а не «мы не проверяли». */
  excludedEventIds: string[]
  exclusionNote: string
  /** Сколько событий перехода легло в основу — без него воронку нельзя
   * отличить от нарисованной по карточкам. */
  transitionCount: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10
}

/**
 * §22.14. Интервал этапа = от входа в стадию до СЛЕДУЮЩЕГО перехода того же
 * ОМ. Незакрытый интервал (ОМ стоит на этапе сейчас) в среднее НЕ попадает:
 * иначе среднее падало бы тем сильнее, чем дольше мероприятие висит.
 */
export function buildFunnel(
  transitions: readonly OpsSourceTransition[],
  events: readonly OpsSourceEvent[],
  registry: readonly LifecycleStateDefinition[],
): FunnelData {
  const byEvent = new Map<string, OpsSourceTransition[]>()
  for (const transition of transitions) {
    byEvent.set(transition.eventId, [...(byEvent.get(transition.eventId) ?? []), transition])
  }
  for (const list of byEvent.values()) {
    list.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  }

  const currentByStage = new Map<string, number>()
  for (const event of events) {
    currentByStage.set(event.stageCode, (currentByStage.get(event.stageCode) ?? 0) + 1)
  }

  const stages = registry.map((state) => {
    const arrivals = transitions.filter((item) => item.toStage === state.stateCode)
    const durations: number[] = []
    for (const list of byEvent.values()) {
      list.forEach((transition, index) => {
        if (transition.toStage !== state.stateCode) return
        const next = list[index + 1]
        if (next === undefined) return
        const hours =
          (new Date(next.occurredAt).getTime() - new Date(transition.occurredAt).getTime()) /
          3_600_000
        if (hours >= 0) durations.push(Math.round(hours * 10) / 10)
      })
    }
    const average =
      durations.length === 0
        ? null
        : Math.round((durations.reduce((total, item) => total + item, 0) / durations.length) * 10) /
          10

    return {
      stateCode: state.stateCode,
      safeLabel: state.safeLabel,
      values: {
        // «Достигших» считаем по РАЗНЫМ ОМ: мероприятие, вернувшееся и снова
        // дошедшее до этапа, достигло его один раз, но переходов сделало два.
        [FUNNEL_MEASURES.reached.code]: new Set(arrivals.map((item) => item.eventId)).size,
        [FUNNEL_MEASURES.current.code]: currentByStage.get(state.stateCode) ?? 0,
        [FUNNEL_MEASURES.transitions.code]: arrivals.length,
        [FUNNEL_MEASURES.returns.code]: arrivals.filter((item) => item.kind === 'RETURN').length,
        // §22.14 «Среднее и медиана отображаются только при наличии готовых
        // серверных значений»: нет ни одного закрытого интервала — `null`.
        [FUNNEL_MEASURES.averageHours.code]: average,
        [FUNNEL_MEASURES.medianHours.code]: median(durations),
      },
    }
  })

  return {
    stages,
    measures: Object.values(FUNNEL_MEASURES).map((measure) => ({ ...measure })),
    // §22.14 «Отменённые и приостановленные ОМ не должны искусственно
    // уменьшать или увеличивать конверсию». Таких состояний в модели нет
    // вовсе — и это сказано вслух, а не изображено пустым фильтром.
    excludedEventIds: [],
    exclusionNote:
      'Состояний «отменено» и «приостановлено» в модели ОМ нет: исключать из конверсии нечего. Появятся — исключение обязано считаться здесь, а не на экране.',
    transitionCount: transitions.length,
  }
}
