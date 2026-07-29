// Feature repository (§8.5) оперативного рейтинга: агрегат считает СЕРВЕР
// (§19.19), закрытые данные наружу не едут (§19.21), состояние недоступности
// называется честно и никогда не подменяется нулём (§19.2).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { UNAVAILABLE_RATING_FACTORS, buildSummary } from '../lib/rating'
import { policyBoundaries } from '../lib/dynamics'
import { buildRatingAnalytics } from '../lib/analytics'
import type {
  ListOperationalRatingsResponse,
  RatingAnalyticsResponse,
  RatingDynamicsResponse,
} from '../api/pending-contracts'
import { RATED_EMPLOYEES, RATING_GROUPS } from './fixtures'
import type { RatingsSlice } from './fixtures'
import { readRatingPolicy, readRatingSuppressionMinGroup } from './settingsSlice'

export class RepositoryPermissionError extends Error {}

const SLICE_NAME = 'ratings'
/**
 * §19.22 перечисляет права порознь: «просмотр агрегированного рейтинга» и
 * «просмотр рейтинга другого сотрудника» — разные пункты. Здесь заведено
 * только первое: сводка по СЕБЕ требует связи persona↔сотрудник, которой в
 * demo-режиме нет (см. `UNAVAILABLE_VIEWS`), и право под несуществующую
 * операцию ничего не охраняло бы.
 */
const VIEW_AGGREGATE_PERMISSION = 'ops.rating.view_aggregate'
/**
 * Отчёт §22.16 охраняет право РАЗДЕЛА АНАЛИТИКИ, а не право сводки: §22.26
 * перечисляет просмотр аналитики отдельным пунктом, и держатель одной только
 * сводки отчёта не получает. Право уже существует и уже роздано — новое здесь
 * не заводится.
 */
const VIEW_ANALYTICS_PERMISSION = 'ops.analytics.view'

/** §35: чего нет в ОТЧЁТЕ (не в расчёте) и почему. */
const UNAVAILABLE_ANALYTICS_VIEWS: readonly { code: string; label: string; reason: string }[] = [
  {
    code: 'FORBIDDEN_BY_2216',
    label: 'Отдельная оценка, оценщик, комментарий, доля ручных оценок, таблица лидеров, место',
    reason:
      '§22.16 перечисляет это списком запрещённого в общем отчёте. Их нет не в вёрстке, а в ответе API: отчёт оперирует агрегатами групп и полосами распределения, отдельного участника в нём не найти.',
  },
  {
    code: 'PROTOTYPE_METRICS_REMOVED',
    label: 'Показатели прототипа: «Авто-оценок», «Стандартных оценок», «Оценок ниже 6»',
    reason:
      '§22.17 требует удалить эту логику целиком. Первые две — выдуманные константы прототипа, третья прямо запрещена как количество низких оценок. Заменены распределением по полосам, где восьмёрка — стандартное выполнение.',
  },
  {
    code: 'NO_OVERALL_MEAN',
    label: 'Общее среднее по всем участникам',
    reason:
      'Вместе с опубликованными средними и размерами остальных групп общее среднее восстанавливает подавленное значение арифметикой (§22.17 «не пытайся восстановить скрытое значение из других показателей»). §22.16 его и не требует.',
  },
]

/**
 * §35: части §19, не реализованные в этом срезе. Названы вслух и с причиной —
 * иначе экран сводки читался бы как «рейтинг сделан целиком».
 */
const UNAVAILABLE_VIEWS: readonly { code: string; label: string; reason: string }[] = [
  {
    code: 'OWN_RATING',
    label: 'Собственный рейтинг смотрящего',
    reason:
      'Связь persona↔сотрудник в demo-режиме не определена (§8.9: persona — это набор прав, а не карточка человека), поэтому «мой рейтинг» показать не на ком. Подставить сюда любого сотрудника значило бы приписать смотрящему чужую оценку.',
  },
  {
    code: 'EVALUATION_WORKSPACE',
    label: 'Рабочее пространство оценивания',
    reason:
      'Формы оценивания (§19.7-19.13) и исправление оценки (§19.18) — отдельная цепочка заданий, состояний и прав. Оценки в этой сборке приходят из сида; кнопки «оценить» нет, потому что операции за ней ещё нет.',
  },
  {
    code: 'SENSITIVE_EVALUATIONS',
    label: 'Отдельные оценки и оценщики',
    reason:
      'Просмотр отдельной оценки требует sensitive permission, organization scope, event scope и срока полномочия одновременно (§19.21 «контролёр рейтинга»). Ни одна операция этого среза их не отдаёт: закрытые данные не покидают сервер, а не прячутся в вёрстке.',
  },
  {
    code: 'RATING_DYNAMICS_FORECAST',
    label: 'Прогноз и сглаживание динамики',
    reason:
      'График §19.20 строится ТОЛЬКО по записанным серверным точкам. Тренд, скользящее среднее и достроенные промежуточные значения не показываются: это было бы вычисление на клиенте поверх агрегатов, а старые точки пересчитывать запрещено прямо.',
  },
]

function readSlice(slices: Record<string, unknown>): RatingsSlice {
  const slice = slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as RatingsSlice
}

export function createRatingsRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  async function listOperationalRatings(
    actorUserId: string | null,
  ): Promise<ListOperationalRatingsResponse> {
    if (!hasPermission(actorUserId, VIEW_AGGREGATE_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_AGGREGATE_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение рейтинга до инициализации demo-состояния')
    }
    const slice = readSlice(envelope.slices)
    const policy = readRatingPolicy(envelope.slices)
    const featureEnabled = slice.capabilities.operationalRatings
    const businessDate = clock.businessDate()
    const calculatedAt = clock.now()

    const results = RATED_EMPLOYEES.map((employee) =>
      buildSummary({
        employeeId: employee.employeeId,
        safeLabel: employee.safeLabel,
        evaluations: slice.evaluations,
        policy,
        featureEnabled,
        businessDate,
        calculatedAt,
      }),
    )
    // Порядок задаёт СЕРВЕР и задаёт его по подписи, а не по значению агрегата:
    // сортировка по рейтингу — это таблица лидеров, прямо запрещённая §22.16.
    results.sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, 'ru'))

    return {
      results,
      // Методика не едет клиенту, когда функция выключена: она бы утверждала,
      // что расчёт по ней идёт.
      policy: featureEnabled ? policy : null,
      capabilities: { ...slice.capabilities },
      unavailableFactors: UNAVAILABLE_RATING_FACTORS.map((item) => ({ ...item })),
      unavailableViews: UNAVAILABLE_VIEWS.map((item) => ({ ...item })),
    }
  }

  /**
   * Динамика одного сотрудника (§19.20). Точки берутся из слайса КАК ЕСТЬ:
   * ни одно их поле здесь не пересчитывается — ни агрегат, ни счётчик, ни
   * версия методики. Единственная серверная работа — отбор по сотруднику,
   * порядок по периоду и границы смены методики.
   */
  async function getRatingDynamics(
    actorUserId: string | null,
    employeeId: string | null,
  ): Promise<RatingDynamicsResponse> {
    // Право то же, что у сводки: динамика — это агрегаты, а не отдельные
    // оценки. Заводить под неё отдельное право значило бы охранять им ту же
    // самую операцию чтения агрегата (§19.22).
    if (!hasPermission(actorUserId, VIEW_AGGREGATE_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_AGGREGATE_PERMISSION)
    }
    const employee =
      RATED_EMPLOYEES.find((item) => item.employeeId === employeeId) ?? RATED_EMPLOYEES[0]
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение динамики рейтинга до инициализации demo-состояния')
    }
    const slice = readSlice(envelope.slices)
    const policy = readRatingPolicy(envelope.slices)
    const featureEnabled = slice.capabilities.operationalRatings

    // Выключенная функция не отдаёт ряд: показать историю при выключенном
    // рейтинге значило бы, что функция всё-таки работает (§19.3).
    const points = featureEnabled
      ? slice.dynamicsPoints
          .filter((point) => point.employeeId === employee.employeeId)
          .map((point) => ({ ...point }))
          .sort((a, b) => a.periodStartsAt.localeCompare(b.periodStartsAt))
      : []

    return {
      employeeId: employee.employeeId,
      safeLabel: employee.safeLabel,
      points,
      boundaries: policyBoundaries(points),
      currentPolicy: featureEnabled && policy !== null ? { ...policy } : null,
      currentPolicyHasClosedPeriods:
        policy !== null && points.some((point) => point.policyVersion === policy.policyVersion),
      capabilities: { operationalRatings: featureEnabled },
      employees: RATED_EMPLOYEES.map((item) => ({ ...item })),
    }
  }

  /**
   * Отчёт аналитики рейтинга (§22.16-22.17).
   *
   * Право СВОЁ — `ops.analytics.view`, а не право сводки: §22 — это отчёт, и
   * доступ к нему решает раздел аналитики. Персона без аналитики не получает
   * отчёт, даже держа `ops.rating.view_aggregate`.
   */
  async function getRatingAnalytics(actorUserId: string | null): Promise<RatingAnalyticsResponse> {
    if (!hasPermission(actorUserId, VIEW_ANALYTICS_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_ANALYTICS_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение аналитики рейтинга до инициализации demo-состояния')
    }
    const slice = readSlice(envelope.slices)
    const policy = readRatingPolicy(envelope.slices)
    const suppressionMinGroupSize = readRatingSuppressionMinGroup(envelope.slices)
    const featureEnabled = slice.capabilities.operationalRatings
    const businessDate = clock.businessDate()
    const calculatedAt = clock.now()

    const base = {
      policy: featureEnabled ? policy : null,
      periodStartsAt: null,
      periodEndsAt: null,
      calculatedAt,
      suppressionMinGroupSize,
      figures: null,
      capabilities: { operationalRatings: featureEnabled },
      unavailableViews: UNAVAILABLE_ANALYTICS_VIEWS.map((item) => ({ ...item })),
    }
    // Порядок причин значим — как и в сводке: выключенная функция отвечает
    // раньше отсутствующей методики, а отсутствующая методика раньше
    // незаданного порога приватности.
    if (!featureEnabled) return { ...base, unpublishedReason: 'FEATURE_DISABLED' }
    if (policy === null) return { ...base, unpublishedReason: 'POLICY_UNDEFINED' }
    // Отчёт без правила приватности не публикуется ВОВСЕ: показать группы,
    // выбрав порог в коде, значило бы решить вопрос приватности за политику
    // (§22.17).
    if (suppressionMinGroupSize === null) {
      return { ...base, unpublishedReason: 'SUPPRESSION_UNDEFINED' }
    }

    const summaries = RATED_EMPLOYEES.map((employee) =>
      buildSummary({
        employeeId: employee.employeeId,
        safeLabel: employee.safeLabel,
        evaluations: slice.evaluations,
        policy,
        featureEnabled,
        businessDate,
        calculatedAt,
      }),
    )

    return {
      ...base,
      periodStartsAt: summaries[0]?.periodStartsAt ?? null,
      periodEndsAt: summaries[0]?.periodEndsAt ?? null,
      unpublishedReason: null,
      figures: buildRatingAnalytics({
        summaries,
        groups: RATING_GROUPS.map((group) => ({
          groupCode: group.groupCode,
          safeLabel: group.safeLabel,
          members: RATED_EMPLOYEES.filter((item) => item.groupCode === group.groupCode).map(
            (item) => item.employeeId,
          ),
        })),
        minGroupSize: suppressionMinGroupSize,
        // §22.16 «количество исправленных оценок в агрегированном виде» —
        // именно количество: какая оценка кем исправлена, закрыто (§19.21).
        correctedEvaluations: slice.evaluations.filter((item) => item.supersededById !== null)
          .length,
      }),
    }
  }

  return { listOperationalRatings, getRatingDynamics, getRatingAnalytics }
}
