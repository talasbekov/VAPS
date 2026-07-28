// Аналитика службы (§22.3-22.7, §22.12). Ключевое свойство раздела названо в
// §22.3 прямо: СЕРВЕР — владелец расчётов. Frontend не считает ни численность,
// ни конфликты, ни просрочку и НЕ назначает цвет по числу — он показывает
// `state` и `displayValue`, пришедшие в ответе.
//
// Предыдущая редакция экрана считала распределения в браузере из постраничных
// списков и честно подписывала их «по видимым записям». Подпись была правдой,
// но §22.3 запрещает сам приём («итог по видимой части таблицы»), поэтому
// расчёт переехал в repository целиком.

/** §22.3. Единица измерения показателя — часть КОНТРАКТА, а не догадка экрана:
 * «12» без единицы одинаково читается как 12 человек и 12 процентов. */
export type MetricUnit = 'COUNT' | 'PERCENT' | 'MINUTES' | 'HOURS' | 'SCORE' | 'TEXT'

/**
 * §22.3. Состояние показателя считает СЕРВЕР по своей политике порогов.
 *
 * `UNKNOWN` — не украшение и не «ошибка»: он означает, что показатель посчитать
 * НЕ УДАЛОСЬ (источник отсутствует). §22.4 отдельно запрещает заменять его
 * зелёным, а §35 — подменять нулём: «0 конфликтов» и «конфликты неизвестны» —
 * разные утверждения, и человек вправе их различать.
 */
export type MetricState = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'

export interface MetricValue {
  metricCode: string
  safeLabel: string
  /** `null` ровно тогда, когда значение неизвестно (см. `UNKNOWN`). */
  value: number | null
  /** Готовая к печати строка. Экран не форматирует число сам: единица, склонение
   * и «нет данных» — часть семантики показателя, а не вёрстки. */
  displayValue: string
  unit: MetricUnit
  state: MetricState
  /** §22.12: можно ли раскрыть показатель до строк. Считает сервер — от него
   * зависит, существует ли для показателя разрешённая выборка. */
  drilldownAvailable: boolean
  /** §22.3: версия ОПРЕДЕЛЕНИЯ показателя. Меняется вместе со смыслом:
   * «незакрытые дежурства» вчера и сегодня должны считаться одинаково, а если
   * методика изменилась — это обязано быть видно в снимке. */
  metricDefinitionVersion: string
}

/** §22.4 «Контракт аналитического снимка». Обёртка вокруг ЛЮБЫХ аналитических
 * данных: период, scope, актуальность и версии расчёта едут вместе с числами,
 * иначе число нельзя перепроверить. */
export interface AnalyticsSnapshot<T> {
  /** Стабильный идентификатор снимка. §22.12 требует таскать его в drill-down:
   * строки обязаны принадлежать ТОМУ ЖЕ снимку, что и раскрытый показатель. */
  snapshotId: string
  businessDate: string
  timezone: string
  period: AnalyticsPeriod
  scope: AnalyticsScope
  generatedAt: string
  /** Время последнего изменения источников; `null` — источник не читался. */
  sourceUpdatedAt: string | null
  sourceWatermark: string | null
  freshnessState: 'CURRENT' | 'STALE' | 'PARTIAL' | 'UNKNOWN'
  completenessState: 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN'
  calculationVersion: string
  policyVersion: string
  data: T
}

export interface AnalyticsPeriod {
  from: string
  to: string
  /** `null` у произвольного периода: preset — это ИМЕНОВАННЫЙ период, и
   * подставлять сюда код при ручном вводе значило бы приписать пользователю
   * выбор, которого он не делал. */
  presetCode: string | null
}

export interface AnalyticsScope {
  scopeType: string
  scopeId: string
  safeLabel: string
}

/**
 * §22.5 «Периоды загружай из API». Ни «последних 7 дней», ни «30 дней» в коде
 * экрана нет: набор пресетов и их глубина приходят из registry — ровно та же
 * причина, что у `maxPeriodDays` отчёта и интервала свежести паспорта.
 */
export interface PeriodPreset {
  presetCode: string
  safeLabel: string
  /** Смещение начала периода от бизнес-даты в днях (0 — сама бизнес-дата). */
  offsetDays: number
  /** Длительность в днях, включая день начала. */
  lengthDays: number
}

/** Определение показателя. Пороги — В ДАННЫХ: захардкоженная «критичность от
 * трёх» повторила бы ошибку «паспорт старше 90 дней» (§21.7). */
export interface MetricDefinition {
  metricCode: string
  safeLabel: string
  unit: MetricUnit
  /** `null` — у показателя нет порога, он всегда `NORMAL` (например, справочное
   * количество запланированных смен): выдуманный порог сделал бы обычное
   * состояние тревожным. */
  warningFrom: number | null
  criticalFrom: number | null
  drilldownAvailable: boolean
}

/** §22.7 данные снимка службы. */
export interface ServiceAnalyticsData {
  metrics: MetricValue[]
  /** §35: показатели §22.7, которых demo-срез не даёт, с причиной по каждому. */
  unavailableMetrics: UnavailableMetric[]
}

export interface UnavailableMetric {
  code: string
  label: string
  reason: string
}

/**
 * §22.12 строка разрешённой выборки. `rowId` — СТАБИЛЬНЫЙ идентификатор
 * сущности (смены), а не номер строки: §22.12 требует переходов по стабильным
 * ID, а порядковый номер меняется от сортировки и страницы.
 */
export interface DrilldownRow {
  rowId: string
  businessDate: string
  objectLabel: string
  stateLabel: string
  /**
   * §22.26 «просмотра разрешённой персональной детализации» — своё право.
   * `null` вместе с `personalDetailSuppressed`: сотрудник вырезается СЕРВЕРОМ,
   * а не прячется вёрсткой (§22.30 «privacy suppressed»).
   */
  employeeLabel: string | null
}

/**
 * §22.11 элемент блока «Требует внимания». Форма — из промпта дословно.
 *
 * ⚠️ Каждое поле здесь ПРИХОДИТ С СЕРВЕРА, включая текст: §22.11 запрещает
 * фронтенду формировать собственные обвинительные выводы, и «собрать» элемент
 * из уже показанных KPI значило бы выдать перестановку чисел экрана за
 * серверное наблюдение. Поэтому у элемента СВОИ `policyVersion` и `detectedAt`
 * — по ним видно, какой политикой и когда сделано наблюдение, а версия
 * политики порогов показателей (`POLICY_VERSION`) к нему отношения не имеет.
 */
export interface AttentionItem {
  attentionId: string
  categoryCode: string
  severity: AttentionSeverity
  /** Одна из РАЗРЕШЁННЫХ §22.11 формулировок — не свободный текст. */
  safeTitle: string
  safeDescription: string
  /** `null`, когда считать нечего: «источник не обновлён» — утверждение о
   * состоянии источника, а не о количестве чего-либо. Ноль читался бы как
   * «ноль случаев», то есть как отсутствие наблюдения. */
  count: number | null
  scopeLabel: string | null
  /** §22.12/§22.27: куда ведёт наблюдение. Маршрут ПОВТОРНО проверит право —
   * `targetPermission` называется здесь, чтобы экран не рисовал заведомо
   * закрытый переход, а не вместо проверки на месте. */
  targetRoute: string | null
  targetPermission: string | null
  detectedAt: string
  policyVersion: string
}

export type AttentionSeverity = 'CRITICAL' | 'WARNING' | 'INFO'

export interface AttentionData {
  items: AttentionItem[]
  /**
   * Пустой список и неработающий детектор — РАЗНЫЕ утверждения, и §35 требует
   * их различать: «ни один детектор не сработал» — наблюдение, «детекторы не
   * отработали» — его отсутствие. Молча вернуть пустоту значило бы сказать
   * «всё в порядке» от имени сервера, который ничего не проверял.
   */
  detectionState: 'COMPLETE' | 'UNAVAILABLE'
  detectionUnavailableReason: string | null
  /** §35: наблюдения §22.11, которых demo-срез не даёт, с причиной. */
  unavailableDetectors: UnavailableMetric[]
}

export interface DrilldownPage {
  metricCode: string
  rows: DrilldownRow[]
  /** `null` — страниц больше нет. Курсор непрозрачен для экрана: его выдаёт и
   * разбирает сервер. */
  nextCursor: string | null
  totalCount: number
  /** §22.26/§22.30: вырезана ли персональная детализация и почему. */
  personalDetailSuppressed: boolean
  personalDetailReason: string | null
}
