// Feature repository (§8.5) оперативного рейтинга: агрегат считает СЕРВЕР
// (§19.19), закрытые данные наружу не едут (§19.21), состояние недоступности
// называется честно и никогда не подменяется нулём (§19.2).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { UNAVAILABLE_RATING_FACTORS, buildSummary } from '../lib/rating'
import type { ListOperationalRatingsResponse } from '../api/pending-contracts'
import { RATED_EMPLOYEES } from './fixtures'
import type { RatingsSlice } from './fixtures'
import { readRatingPolicy } from './settingsSlice'

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
    code: 'RATING_DYNAMICS',
    label: 'Динамика агрегата',
    reason:
      'График §19.20 строится по серверным точкам с версией методики на каждой; ряда точек в модели ещё нет, а соединить две редакции одной линией прямо запрещено — поэтому график не рисуется, а не рисуется приблизительно.',
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

  return { listOperationalRatings }
}
