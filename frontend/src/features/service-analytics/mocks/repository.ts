// Feature repository (§8.5) аналитики службы: снимок §22.4, показатели §22.3/
// §22.7, drill-down по стабильным ID §22.12.
//
// ⚠️ Здесь и только здесь считаются числа. §22.3 перечисляет расчёты, которых
// frontend делать не должен, и «итог по видимой части таблицы» стоит в том же
// списке — поэтому экран получает готовые `MetricValue` и не видит исходных
// строк вовсе, пока не попросит выборку явно (§22.12 «не передавай весь набор
// скрытых строк вместе с KPI-ответом»).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import {
  CALCULATION_VERSION,
  METRIC_CODES,
  POLICY_VERSION,
  UNAVAILABLE_HEADER_BLOCKS,
  UNAVAILABLE_METRICS,
  buildMetric,
  buildSnapshotId,
  decodeCursor,
  detectConflictShiftIds,
  encodeCursor,
  inPeriod,
  isResting,
  isUnconfirmed,
  isUnfinishedPast,
  resolvePreset,
  toDrilldownRow,
} from '../lib/analytics'
import type { AnalyticsDutyType, AnalyticsSourceShift } from '../lib/analytics'
import { readAnalyticsSource } from './dutiesSlice'
import { MAX_CUSTOM_PERIOD_DAYS } from './fixtures'
import type { ServiceAnalyticsSlice } from './fixtures'
import type {
  AnalyticsPresetsResponse,
  DrilldownQuery,
  DrilldownResponse,
  ServiceAnalyticsResponse,
} from '../api/pending-contracts'
import type { AnalyticsPeriod, AnalyticsScope, MetricValue } from '../model/types'

export class RepositoryPermissionError extends Error {}
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

const SLICE_NAME = 'serviceAnalytics'
const VIEW_PERMISSION = 'ops.analytics.view'
/** §22.26 «просмотра разрешённой персональной детализации» и «drill-down» —
 * разные пункты списка прав, и здесь они разные права. */
const DRILLDOWN_PERMISSION = 'ops.analytics.drilldown'
const PERSONAL_DETAIL_PERMISSION = 'ops.analytics.personal_detail'

const TIMEZONE = 'Asia/Almaty'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/** §8.9: RBAC demo-режима плоский. Scope один и назван честно — не «вся
 * организация по праву», а «единственная область demo-режима». */
const DEMO_SCOPE: AnalyticsScope = {
  scopeType: 'DEMO_FLAT',
  scopeId: 'demo',
  safeLabel: 'Единственная область видимости demo-режима',
}

const PERSONAL_DETAIL_REASON =
  'У вас нет права на персональную детализацию: строки показаны без сотрудника (§22.26). Сервер их не присылает — скрывать ФИО в вёрстке значило бы всё равно отдать его браузеру.'

function readSlice(slices: Record<string, unknown>): ServiceAnalyticsSlice {
  const slice = slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as ServiceAnalyticsSlice
}

function periodDays(from: string, to: string): number {
  const toUtc = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1
}

export function createServiceAnalyticsRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  /**
   * §22.5. Период считает СЕРВЕР: экран присылает код пресета либо даты, но не
   * то и другое — «текущая неделя» не должна означать разные интервалы у
   * разных вкладок.
   */
  function resolvePeriod(
    slice: ServiceAnalyticsSlice,
    businessDate: string,
    request: { presetCode: string | null; from?: string; to?: string },
  ): AnalyticsPeriod {
    if (request.presetCode !== null) {
      const preset = slice.periodPresets.find((item) => item.presetCode === request.presetCode)
      if (preset === undefined) {
        throw new RepositoryBusinessRuleError('UNKNOWN_PERIOD_PRESET', 'Неизвестный период.')
      }
      const { from, to } = resolvePreset(preset, businessDate)
      return { from, to, presetCode: preset.presetCode }
    }

    const from = request.from ?? ''
    const to = request.to ?? ''
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new RepositoryBusinessRuleError(
        'INVALID_PERIOD',
        'Укажите период в формате ГГГГ-ММ-ДД.',
      )
    }
    if (from > to) {
      throw new RepositoryBusinessRuleError('INVALID_PERIOD', 'Начало периода позже его конца.')
    }
    // §22.5 «При произвольном периоде проверяй допустимый диапазон через server
    // validation» — предел лежит в данных, не в форме.
    if (periodDays(from, to) > MAX_CUSTOM_PERIOD_DAYS) {
      throw new RepositoryBusinessRuleError(
        'PERIOD_TOO_LONG',
        `Период аналитики не может превышать ${MAX_CUSTOM_PERIOD_DAYS} дней.`,
      )
    }
    return { from, to, presetCode: null }
  }

  /**
   * Выборки, стоящие за показателями. Возвращаются ИДЕНТИФИКАТОРЫ смен:
   * §22.12 требует переходов по стабильным ID, и число показателя получается
   * длиной выборки — а не считается отдельно, иначе KPI и его расшифровка
   * разошлись бы при первой же правке одного из двух мест.
   */
  function buildSelections(
    source: { shifts: AnalyticsSourceShift[]; dutyTypes: AnalyticsDutyType[] },
    period: AnalyticsPeriod,
    businessDate: string,
  ): Map<string, string[]> {
    const inRange = source.shifts.filter((shift) => inPeriod(shift.businessDate, period.from, period.to))
    const typeByCode = new Map(source.dutyTypes.map((type) => [type.dutyTypeCode, type]))
    const conflicts = detectConflictShiftIds(inRange, source.dutyTypes)

    return new Map<string, string[]>([
      [METRIC_CODES.onDuty, inRange.filter((s) => s.stateCode === 'ACTIVE').map((s) => s.id)],
      [
        METRIC_CODES.planned,
        inRange
          .filter((s) => s.stateCode === 'PLANNED' || s.stateCode === 'ACKNOWLEDGED')
          .map((s) => s.id),
      ],
      [
        METRIC_CODES.rest,
        // Отдых считается по ВСЕМУ набору смен, а не только по попавшим в
        // период: дежурство перед началом периода продолжает давать отдых
        // внутри него (тот же вывод, что стык месяцев в матрице §21.30).
        source.shifts
          .filter((s) => isResting(s, typeByCode.get(s.dutyTypeCode), businessDate))
          .map((s) => s.id),
      ],
      [
        METRIC_CODES.unfinished,
        inRange.filter((s) => isUnfinishedPast(s, businessDate)).map((s) => s.id),
      ],
      [METRIC_CODES.hardConflicts, conflicts.hard],
      [METRIC_CODES.softConflicts, conflicts.soft],
      [METRIC_CODES.unconfirmed, inRange.filter(isUnconfirmed).map((s) => s.id)],
    ])
  }

  async function listPresets(actorUserId: string | null): Promise<AnalyticsPresetsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope.slices)
    return {
      results: slice?.periodPresets ?? [],
      maxCustomPeriodDays: MAX_CUSTOM_PERIOD_DAYS,
      defaultPresetCode: slice?.periodPresets[0]?.presetCode ?? 'TODAY',
    }
  }

  async function getServiceAnalytics(
    actorUserId: string | null,
    request: { presetCode: string | null; from?: string; to?: string },
  ): Promise<ServiceAnalyticsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new RepositoryBusinessRuleError('SNAPSHOT_UNAVAILABLE', 'Снимок недоступен.')
    }
    const slice = readSlice(envelope.slices)
    const businessDate = clock.businessDate()
    const period = resolvePeriod(slice, businessDate, request)
    const source = readAnalyticsSource(envelope.slices)

    let metrics: MetricValue[]
    if (source === null) {
      // §22.4/§35: отсутствие источника даёт UNKNOWN и `value: null`, а НЕ ноль.
      // Ноль читался бы как «конфликтов нет» — это утверждение, которого мы
      // сделать не можем.
      metrics = slice.metricDefinitions.map((definition) => buildMetric(definition, null))
    } else {
      const selections = buildSelections(source, period, businessDate)
      metrics = slice.metricDefinitions.map((definition) =>
        buildMetric(definition, selections.get(definition.metricCode)?.length ?? null),
      )
    }

    const sourceUpdatedAt =
      source === null || source.shifts.length === 0
        ? null
        : source.shifts.reduce((latest, shift) => (shift.updatedAt > latest ? shift.updatedAt : latest), '')

    const drilldownAllowed = hasPermission(actorUserId, DRILLDOWN_PERMISSION)
    return {
      snapshotId: buildSnapshotId({
        revision: envelope.revision,
        from: period.from,
        to: period.to,
        scopeId: DEMO_SCOPE.scopeId,
      }),
      businessDate,
      timezone: TIMEZONE,
      period,
      scope: DEMO_SCOPE,
      generatedAt: clock.now(),
      sourceUpdatedAt: sourceUpdatedAt === '' ? null : sourceUpdatedAt,
      // Водяного знака источника в demo-срезе нет — поле есть в контракте
      // §22.4, и врать в него нечем.
      sourceWatermark: null,
      freshnessState: source === null ? 'UNKNOWN' : 'CURRENT',
      completenessState: source === null ? 'INCOMPLETE' : 'COMPLETE',
      calculationVersion: CALCULATION_VERSION,
      policyVersion: POLICY_VERSION,
      data: {
        metrics,
        unavailableMetrics: UNAVAILABLE_METRICS.map((metric) => ({ ...metric })),
      },
      unavailableHeaderBlocks: UNAVAILABLE_HEADER_BLOCKS.map((block) => ({ ...block })),
      drilldownAllowed,
      drilldownDeniedReason: drilldownAllowed
        ? null
        : 'Раскрытие показателя до строк — отдельное право (§22.26): дашборд показывает агрегаты, выборка показывает людей и смены.',
    }
  }

  /**
   * §22.12 drill-down. Право проверяется ЗАНОВО и своё: переход со своего же
   * дашборда доступа не подтверждает (тот же принцип, что §22.27).
   */
  async function getDrilldown(
    actorUserId: string | null,
    query: DrilldownQuery,
  ): Promise<DrilldownResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    if (!hasPermission(actorUserId, DRILLDOWN_PERMISSION)) {
      throw new RepositoryPermissionError(DRILLDOWN_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new RepositoryBusinessRuleError('SNAPSHOT_UNAVAILABLE', 'Снимок недоступен.')
    }
    const slice = readSlice(envelope.slices)
    const businessDate = clock.businessDate()
    const period = resolvePeriod(slice, businessDate, {
      presetCode: query.presetCode,
      from: query.from,
      to: query.to,
    })
    const snapshotId = buildSnapshotId({
      revision: envelope.revision,
      from: period.from,
      to: period.to,
      scopeId: DEMO_SCOPE.scopeId,
    })
    // §22.12 «сохранять snapshotId»: строки обязаны принадлежать тому же
    // снимку. Данные могли измениться между показом KPI и раскрытием — тогда
    // выборка относится к другому мгновению, и молча подменять её нельзя.
    if (query.snapshotId !== snapshotId) {
      throw new RepositoryBusinessRuleError(
        'SNAPSHOT_OUTDATED',
        'Данные изменились с момента показа показателя. Обновите аналитику и раскройте показатель заново.',
      )
    }

    const source = readAnalyticsSource(envelope.slices)
    if (source === null) {
      throw new RepositoryBusinessRuleError(
        'CALCULATION_UNAVAILABLE',
        'Источник данных недоступен — показатель не рассчитан, раскрывать нечего.',
      )
    }
    const selections = buildSelections(source, period, businessDate)
    const ids = selections.get(query.metricCode)
    if (ids === undefined) {
      throw new RepositoryBusinessRuleError('UNKNOWN_METRIC', 'Неизвестный показатель.')
    }

    const byId = new Map(source.shifts.map((shift) => [shift.id, shift]))
    const personalDetailAllowed = hasPermission(actorUserId, PERSONAL_DETAIL_PERMISSION)
    const offset = decodeCursor(query.cursor)
    const pageIds = ids.slice(offset, offset + slice.drilldownPageSize)
    const rows = pageIds
      .map((id) => byId.get(id))
      .filter((shift): shift is AnalyticsSourceShift => shift !== undefined)
      .map((shift) => toDrilldownRow(shift, personalDetailAllowed))
    const nextOffset = offset + slice.drilldownPageSize

    return {
      snapshotId,
      businessDate,
      timezone: TIMEZONE,
      period,
      scope: DEMO_SCOPE,
      generatedAt: clock.now(),
      sourceUpdatedAt: null,
      sourceWatermark: null,
      freshnessState: 'CURRENT',
      completenessState: 'COMPLETE',
      calculationVersion: CALCULATION_VERSION,
      policyVersion: POLICY_VERSION,
      data: {
        metricCode: query.metricCode,
        rows,
        nextCursor: nextOffset < ids.length ? encodeCursor(nextOffset) : null,
        totalCount: ids.length,
        personalDetailSuppressed: !personalDetailAllowed,
        personalDetailReason: personalDetailAllowed ? null : PERSONAL_DETAIL_REASON,
      },
    }
  }

  return { listPresets, getServiceAnalytics, getDrilldown }
}
