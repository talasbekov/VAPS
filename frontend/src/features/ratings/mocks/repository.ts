// Feature repository (§8.5) оперативного рейтинга: агрегат считает СЕРВЕР
// (§19.19), закрытые данные наружу не едут (§19.21), состояние недоступности
// называется честно и никогда не подменяется нулём (§19.2).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import { UNAVAILABLE_RATING_FACTORS, buildSummary } from '../lib/rating'
import { policyBoundaries } from '../lib/dynamics'
import { buildRatingAnalytics } from '../lib/analytics'
import {
  UNAVAILABLE_WORKSPACE_VIEWS,
  summarizeEventProgress,
  summarizeQueue,
  validateSubmission,
} from '../lib/workspace'
import { validateCorrection } from '../lib/correction'
import {
  UNAVAILABLE_REGISTRY_VIEWS,
  matchesFilters,
  pageCount,
  pageOf,
} from '../lib/registry'
import type { EvaluationRegistryRow, RegistryFilters } from '../lib/registry'
import type {
  CorrectEvaluationRequest,
  CorrectEvaluationResponse,
  CorrectionChainLink,
  EvaluationRegistryResponse,
  EvaluationWorkItemView,
  RatingEmployeeDetailResponse,
  EvaluationWorkspaceResponse,
  ListOperationalRatingsResponse,
  RatingAnalyticsResponse,
  RatingDynamicsResponse,
  SubmitEvaluationRequest,
  SubmitEvaluationResponse,
  SubmittedEvaluationDetailResponse,
  SubmittedEvaluationView,
} from '../api/pending-contracts'
import type { EvaluationCorrection, EvaluationWorkItem, EventEvaluation } from '../model/types'
import { EVALUATION_BASES, EVALUATION_EVENTS, RATED_EMPLOYEES, RATING_GROUPS } from './fixtures'
import type { RatingsSlice } from './fixtures'
import { readRatingPolicy, readRatingSuppressionMinGroup } from './settingsSlice'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string

  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

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
/**
 * §19.22 «выставление оценки» — отдельный пункт списка прав, и теперь за ним
 * стоит операция, поэтому право и заводится. Оно НЕ подразумевает права на
 * агрегат: оценщик обязан выставить оценку, не видя, как она сложится в
 * рейтинг человека, — иначе оценивание превращается в подгонку под число.
 */
const EVALUATE_PERMISSION = 'ops.rating.evaluate'
/**
 * §19.22 перечисляет «исправление оценки» и «просмотр correction chain»
 * ОТДЕЛЬНЫМИ пунктами — здесь они и заведены порознь. Разница не формальная:
 * видеть, что запись правили и почему, — контрольная функция; править —
 * распорядительная. Исправление ограничено СОБСТВЕННОЙ записью: §19.21 требует
 * для чужой ещё organization scope, event scope и срок полномочия, которых в
 * этой сборке нет (см. `UNAVAILABLE_WORKSPACE_VIEWS`).
 */
const CORRECT_PERMISSION = 'ops.rating.correct'
const VIEW_CHAIN_PERMISSION = 'ops.rating.view_correction_chain'

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

  /**
   * Проекция задания наружу. Собирается ПОЛЕМ ЗА ПОЛЕМ, а не «всё, кроме
   * оценщика»: при появлении нового закрытого поля перечисление оставит его
   * дома, а исключающий список молча отдал бы его клиенту.
   */
  function toWorkItemView(item: EvaluationWorkItem): EvaluationWorkItemView {
    return {
      id: item.id,
      securityEventId: item.securityEventId,
      eventRunId: item.eventRunId,
      assignmentId: item.assignmentId,
      targetEmployeeId: item.targetEmployeeId,
      targetGroupId: item.targetGroupId,
      targetSafeLabel: item.targetSafeLabel,
      targetSafeUnitLabel: item.targetSafeUnitLabel,
      postLabel: item.postLabel,
      actualStartsAt: item.actualStartsAt,
      actualEndsAt: item.actualEndsAt,
      participated: item.participated,
      evaluationDirection: item.evaluationDirection,
      initialScore: item.initialScore,
      status: item.status,
      revision: item.revision,
      submittedEvaluationId: item.submittedEvaluationId,
      submittedAt: item.submittedAt,
    }
  }

  function basisLabel(code: string | null): string | null {
    if (code === null) return null
    return EVALUATION_BASES.find((item) => item.code === code)?.label ?? code
  }

  /**
   * Своя отправленная оценка. Собирается ТОЛЬКО для записи, автором которой
   * является запрашивающий: проверка на `evaluatorUserId` стоит здесь, а не в
   * вёрстке, потому что чужой комментарий не должен доехать до браузера вовсе.
   */
  function toSubmittedView(
    item: EvaluationWorkItem,
    evaluations: readonly EventEvaluation[],
    actorUserId: string | null,
  ): SubmittedEvaluationView | null {
    if (item.submittedEvaluationId === null || item.submittedAt === null) return null
    const evaluation = evaluations.find((entry) => entry.id === item.submittedEvaluationId)
    if (evaluation === undefined) return null
    if (evaluation.evaluatorUserId !== actorUserId) return null
    return {
      workItemId: item.id,
      evaluationId: evaluation.id,
      targetSafeLabel: item.targetSafeLabel,
      postLabel: item.postLabel,
      evaluationDirection: evaluation.evaluationDirection,
      method: evaluation.method,
      score: evaluation.score,
      basisLabel: basisLabel(evaluation.basisCode),
      basisNote: evaluation.basisNote,
      comment: evaluation.comment,
      submittedAt: item.submittedAt,
      revision: item.revision,
    }
  }

  /**
   * Рабочее пространство оценивания (§19.14).
   *
   * Очередь отбирается ПО ОЦЕНЩИКУ на сервере: §19.14 «не показывай
   * пользователю оценки, полученные им от других лиц» выполняется тем, что
   * чужие задания и чужие оценки в ответ не попадают, а не тем, что экран их
   * не рисует.
   */
  async function getEvaluationWorkspace(
    actorUserId: string | null,
    eventId: string | null,
  ): Promise<EvaluationWorkspaceResponse> {
    if (!hasPermission(actorUserId, EVALUATE_PERMISSION)) {
      throw new RepositoryPermissionError(EVALUATE_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение заданий оценивания до инициализации demo-состояния')
    }
    const slice = readSlice(envelope.slices)
    const policy = readRatingPolicy(envelope.slices)
    const featureEnabled = slice.capabilities.operationalRatings

    const base = {
      bases: EVALUATION_BASES.map((item) => ({ ...item })),
      policy,
      loadedAt: clock.now(),
      capabilities: { operationalRatings: featureEnabled },
      unavailableViews: UNAVAILABLE_WORKSPACE_VIEWS.map((item) => ({ ...item })),
    }
    // Выключенная функция не отдаёт ни одного задания: показать очередь и не
    // дать отправить оценку значило бы позвать на работу, которой нет (§19.3).
    if (!featureEnabled) {
      return {
        ...base,
        events: [],
        selectedEvent: null,
        pending: [],
        submitted: [],
        queue: { total: 0, submitted: 0, remaining: 0 },
        eventProgress: null,
        unavailableReason: 'FEATURE_DISABLED',
      }
    }

    const mine = slice.workItems.filter((item) => item.evaluatorUserId === actorUserId)
    const events = EVALUATION_EVENTS.filter((event) =>
      mine.some((item) => item.securityEventId === event.securityEventId),
    ).map((event) => ({
      securityEventId: event.securityEventId,
      number: event.number,
      title: event.title,
      objectLabel: event.objectLabel,
      actualStartsAt: event.actualStartsAt,
      actualEndsAt: event.actualEndsAt,
      stateLabel: event.stateLabel,
    }))
    const selectedEvent =
      events.find((event) => event.securityEventId === eventId) ?? events[0] ?? null
    const scoped =
      selectedEvent === null
        ? []
        : mine.filter((item) => item.securityEventId === selectedEvent.securityEventId)
    // Порядок задаёт СЕРВЕР и задаёт его по подписи участника: очередь,
    // отсортированная по начальной оценке, была бы подсказкой «кого снижать».
    const ordered = [...scoped].sort((a, b) => a.targetSafeLabel.localeCompare(b.targetSafeLabel, 'ru'))

    return {
      ...base,
      events,
      selectedEvent,
      pending: ordered.filter((item) => item.status === 'PENDING').map(toWorkItemView),
      submitted: ordered
        .filter((item) => item.status === 'SUBMITTED')
        .map((item) => toSubmittedView(item, slice.evaluations, actorUserId))
        .filter((item): item is SubmittedEvaluationView => item !== null),
      queue: summarizeQueue(scoped),
      // Сводка мероприятия — работа ВСЕХ оценщиков, поэтому и охраняется
      // отдельным правом (§19.14). Без права её нет в ответе, а не скрыта.
      eventProgress:
        selectedEvent !== null && hasPermission(actorUserId, VIEW_AGGREGATE_PERMISSION)
          ? summarizeEventProgress(
              slice.workItems.filter(
                (item) => item.securityEventId === selectedEvent.securityEventId,
              ),
            )
          : null,
      unavailableReason: null,
    }
  }

  /**
   * Отправка оценки по заданию (§19.7-19.10).
   *
   * Оценщик берётся из учётной записи, target/мероприятие/направление — из
   * ЗАДАНИЯ: тело запроса не несёт ни одного из этих полей и подменить их не
   * может. Проверка формы выполняется ЗАНОВО той же функцией, что и на клиенте
   * (§19.9 «backend повторно выполняет ту же проверку»).
   */
  async function submitEvaluation(
    actorUserId: string | null,
    workItemId: string,
    body: SubmitEvaluationRequest,
  ): Promise<SubmitEvaluationResponse> {
    if (!hasPermission(actorUserId, EVALUATE_PERMISSION)) {
      throw new RepositoryPermissionError(EVALUATE_PERMISSION)
    }
    let response: SubmitEvaluationResponse | null = null
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const item = slice.workItems.find((entry) => entry.id === workItemId)
      // Чужое задание — 404, а не 403: отказ по праву подтвердил бы, что
      // задание с таким идентификатором существует и кем-то оценивается.
      if (item === undefined || item.evaluatorUserId !== actorUserId) {
        throw new RepositoryNotFoundError(workItemId)
      }
      if (!slice.capabilities.operationalRatings) {
        throw new RepositoryBusinessRuleError(
          'RATING_DISABLED',
          'Оперативный рейтинг выключен: оценки не принимаются.',
        )
      }
      if (item.status !== 'PENDING') {
        throw new RepositoryBusinessRuleError(
          'EVALUATION_ALREADY_SUBMITTED',
          'Оценка по этому заданию уже отправлена. Исправление — отдельная операция (§19.18).',
        )
      }
      if (item.targetEmployeeId === null) {
        throw new RepositoryBusinessRuleError(
          'GROUP_EVALUATION_UNSUPPORTED',
          'Групповая оценка не поддерживается: состав группы на момент мероприятия не записан.',
        )
      }
      // Редакция задания: человек отправляет ту версию, которую видел. Совпадение
      // проверяется ДО правил формы — иначе про устаревшую строку сначала
      // сообщили бы о комментарии, а потом всё равно отвергли.
      if (item.revision !== body.revision) {
        throw new RepositoryBusinessRuleError(
          'EVALUATION_REVISION_MISMATCH',
          'Задание изменилось: обновите страницу и повторите.',
        )
      }
      const violation = validateSubmission(body, EVALUATION_BASES)
      if (violation !== null) {
        throw new RepositoryBusinessRuleError(violation.code, violation.message)
      }

      const now = clock.now()
      const evaluation: EventEvaluation = {
        // Идентификатор генерирует СЕРВЕР (§19.7 «не генерируй evaluation ID»),
        // и он устойчив между перезагрузками, как в остальных repositories.
        id: `evaluation-${current.revision + 1}-${slice.evaluations.length + 1}`,
        securityEventId: item.securityEventId,
        employeeId: item.targetEmployeeId,
        evaluatorUserId: actorUserId,
        score: body.score,
        comment: (body.comment ?? '').trim() === '' ? null : (body.comment ?? '').trim(),
        evaluationDirection: item.evaluationDirection,
        method: 'MANUAL',
        basisCode: body.basisCode,
        basisNote: (body.basisNote ?? '').trim() === '' ? null : (body.basisNote ?? '').trim(),
        evaluatedAt: clock.businessDate(),
        supersededById: null,
      }
      const nextItem: EvaluationWorkItem = {
        ...item,
        status: 'SUBMITTED',
        revision: item.revision + 1,
        submittedEvaluationId: evaluation.id,
        submittedAt: now,
      }
      const workItems = slice.workItems.map((entry) => (entry.id === item.id ? nextItem : entry))
      const evaluations = [...slice.evaluations, evaluation]
      const submitted = toSubmittedView(nextItem, evaluations, actorUserId)
      if (submitted === null) {
        throw new Error('mock-runtime: отправленная оценка не собралась в проекцию')
      }
      response = {
        workItem: toWorkItemView(nextItem),
        submitted,
        queue: summarizeQueue(
          workItems.filter(
            (entry) =>
              entry.evaluatorUserId === actorUserId &&
              entry.securityEventId === item.securityEventId,
          ),
        ),
      }
      return { ...current.slices, [SLICE_NAME]: { ...slice, workItems, evaluations } }
    })
    if (response === null) throw new Error('mock-runtime: отправка оценки не вернула результат')
    return response
  }

  /**
   * Цепочка исправлений записи (§19.17 correction chain). Строится ОТ КОРНЯ
   * вперёд по ссылкам `supersededById`, а не сортировкой по времени: время
   * говорит, когда записи появились, а цепочка — что чем замещено.
   */
  function buildChain(
    evaluations: readonly EventEvaluation[],
    corrections: readonly EvaluationCorrection[],
    currentId: string,
  ): CorrectionChainLink[] {
    // Корень — запись, которую никто не замещал.
    let root = evaluations.find((item) => item.id === currentId)
    if (root === undefined) return []
    let guard = 0
    for (;;) {
      const previous = evaluations.find((item) => item.supersededById === root?.id)
      if (previous === undefined || guard > 50) break
      root = previous
      guard += 1
    }

    const links: CorrectionChainLink[] = []
    let node: EventEvaluation | undefined = root
    while (node !== undefined && links.length <= 50) {
      const correction = corrections.find((item) => item.originalEvaluationId === node?.id)
      links.push({
        correctionId: correction?.id ?? null,
        evaluationId: node.id,
        score: node.score,
        basisLabel: basisLabel(node.basisCode),
        basisNote: node.basisNote,
        comment: node.comment,
        // Старое значение остаётся видимым вместе с причиной замещения:
        // §19.18 «нельзя скрыть старое значение».
        supersededReason: correction?.reason ?? null,
        supersededAt: correction?.correctedAt ?? null,
        current: node.supersededById === null,
      })
      const nextId: string | null = node.supersededById
      node = nextId === null ? undefined : evaluations.find((item) => item.id === nextId)
    }
    return links
  }

  /**
   * Карточка отправленной оценки (§19.17) — только СВОЕЙ.
   *
   * Отдельная операция от рабочего пространства, потому что §19.18 шаг 3
   * требует ПЕРЕЗАГРУЗИТЬ актуальную редакцию задания перед исправлением:
   * взять её из списка, прочитанного минуту назад, значит исправлять запись,
   * которой, возможно, уже нет в том виде.
   */
  async function getSubmittedEvaluationDetail(
    actorUserId: string | null,
    workItemId: string,
  ): Promise<SubmittedEvaluationDetailResponse> {
    if (!hasPermission(actorUserId, EVALUATE_PERMISSION)) {
      throw new RepositoryPermissionError(EVALUATE_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение карточки оценки до инициализации demo-состояния')
    }
    const slice = readSlice(envelope.slices)
    const item = slice.workItems.find((entry) => entry.id === workItemId)
    if (item === undefined || item.evaluatorUserId !== actorUserId) {
      throw new RepositoryNotFoundError(workItemId)
    }
    const submitted = toSubmittedView(item, slice.evaluations, actorUserId)
    if (submitted === null) throw new RepositoryNotFoundError(workItemId)

    return {
      workItem: toWorkItemView(item),
      submitted,
      // Цепочка — СВОЁ право (§19.22): видеть, что запись правили, — контрольная
      // функция, отдельная от права её править.
      chain: hasPermission(actorUserId, VIEW_CHAIN_PERMISSION)
        ? buildChain(slice.evaluations, slice.corrections, submitted.evaluationId)
        : null,
      bases: EVALUATION_BASES.map((basis) => ({ ...basis })),
      // Право решает СЕРВЕР и присылает готовым: кнопка, выключенная только на
      // клиенте, ограничением доступа не является.
      canCorrect:
        hasPermission(actorUserId, CORRECT_PERMISSION) && slice.capabilities.operationalRatings,
      loadedAt: clock.now(),
    }
  }

  /**
   * Исправление оценки (§19.18).
   *
   * Исходная запись НЕ переписывается и не удаляется: создаётся замещающая
   * оценка, исходная помечается ссылкой, а связь между ними и причина ложатся
   * отдельной записью `EvaluationCorrection`. Агрегат после этого считает
   * сервер — вытесненные записи он исключает сам (§19.19).
   */
  async function correctEvaluation(
    actorUserId: string | null,
    workItemId: string,
    body: CorrectEvaluationRequest,
  ): Promise<CorrectEvaluationResponse> {
    if (!hasPermission(actorUserId, CORRECT_PERMISSION)) {
      throw new RepositoryPermissionError(CORRECT_PERMISSION)
    }
    let response: CorrectEvaluationResponse | null = null
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const item = slice.workItems.find((entry) => entry.id === workItemId)
      // Чужая запись — 404: исправлять её нельзя вовсе (§19.21 требует scope и
      // срока полномочия, которых нет), и отказ по праву подтвердил бы её
      // существование.
      if (item === undefined || item.evaluatorUserId !== actorUserId) {
        throw new RepositoryNotFoundError(workItemId)
      }
      if (!slice.capabilities.operationalRatings) {
        throw new RepositoryBusinessRuleError(
          'RATING_DISABLED',
          'Оперативный рейтинг выключен: исправления не принимаются.',
        )
      }
      const originalId = item.submittedEvaluationId
      if (item.status !== 'SUBMITTED' || originalId === null) {
        throw new RepositoryBusinessRuleError(
          'EVALUATION_NOT_SUBMITTED',
          'Исправлять нечего: оценка по заданию ещё не отправлена.',
        )
      }
      if (item.revision !== body.revision) {
        throw new RepositoryBusinessRuleError(
          'EVALUATION_REVISION_MISMATCH',
          'Задание изменилось: обновите страницу и повторите.',
        )
      }
      const original = slice.evaluations.find((entry) => entry.id === originalId)
      if (original === undefined) throw new RepositoryNotFoundError(originalId)
      const violation = validateCorrection(body, EVALUATION_BASES)
      if (violation !== null) {
        throw new RepositoryBusinessRuleError(violation.code, violation.message)
      }

      const now = clock.now()
      const replacement: EventEvaluation = {
        ...original,
        id: `evaluation-${current.revision + 1}-${slice.evaluations.length + 1}`,
        score: body.score,
        basisCode: body.basisCode,
        basisNote: (body.basisNote ?? '').trim() === '' ? null : (body.basisNote ?? '').trim(),
        comment: (body.comment ?? '').trim() === '' ? null : (body.comment ?? '').trim(),
        // Оценщик, target, мероприятие и направление наследуются от исходной
        // записи — §19.18 запрещает их менять, и `...original` это гарантирует
        // структурно, а не аккуратностью перечисления.
        evaluatedAt: original.evaluatedAt,
        supersededById: null,
      }
      const correction: EvaluationCorrection = {
        id: `correction-${current.revision + 1}-${slice.corrections.length + 1}`,
        originalEvaluationId: original.id,
        replacementEvaluationId: replacement.id,
        reason: body.reason.trim(),
        correctedBy: actorUserId ?? '',
        correctedAt: now,
        revision: item.revision,
      }
      const evaluations = slice.evaluations
        .map((entry) =>
          // Исходная запись остаётся в истории — меняется ровно одна ссылка.
          entry.id === original.id ? { ...entry, supersededById: replacement.id } : entry,
        )
        .concat(replacement)
      const nextItem: EvaluationWorkItem = {
        ...item,
        revision: item.revision + 1,
        submittedEvaluationId: replacement.id,
        submittedAt: now,
      }
      const workItems = slice.workItems.map((entry) => (entry.id === item.id ? nextItem : entry))
      const corrections = [...slice.corrections, correction]
      const submitted = toSubmittedView(nextItem, evaluations, actorUserId)
      if (submitted === null) {
        throw new Error('mock-runtime: исправленная оценка не собралась в проекцию')
      }
      response = {
        workItem: toWorkItemView(nextItem),
        submitted,
        chain: hasPermission(actorUserId, VIEW_CHAIN_PERMISSION)
          ? buildChain(evaluations, corrections, replacement.id)
          : null,
      }
      return {
        ...current.slices,
        [SLICE_NAME]: { ...slice, workItems, evaluations, corrections },
      }
    })
    if (response === null) throw new Error('mock-runtime: исправление не вернуло результат')
    return response
  }

  /**
   * Реестр итоговых оценок (§19.15-19.16).
   *
   * Строка собирается ПОЛЕМ ЗА ПОЛЕМ из закрытой записи, и ни score, ни
   * комментарий, ни основание, ни оценщик в неё не попадают: §19.16 требует
   * скрыть их от держателя права на агрегат, а §19.21 — обеспечивать это API.
   * Отбор и страница считаются здесь же: отдать всё и отфильтровать в браузере
   * значило бы сначала привезти туда строки вне разрешённого периода.
   */
  async function listEvaluationRegistry(
    actorUserId: string | null,
    filters: RegistryFilters,
  ): Promise<EvaluationRegistryResponse> {
    if (!hasPermission(actorUserId, VIEW_AGGREGATE_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_AGGREGATE_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение реестра оценок до инициализации demo-состояния')
    }
    const slice = readSlice(envelope.slices)
    const policy = readRatingPolicy(envelope.slices)
    const featureEnabled = slice.capabilities.operationalRatings
    const businessDate = clock.businessDate()
    const calculatedAt = clock.now()

    const summaries = new Map(
      RATED_EMPLOYEES.map((employee) => [
        employee.employeeId,
        buildSummary({
          employeeId: employee.employeeId,
          safeLabel: employee.safeLabel,
          evaluations: slice.evaluations,
          policy,
          featureEnabled,
          businessDate,
          calculatedAt,
        }),
      ]),
    )

    const rows: EvaluationRegistryRow[] = featureEnabled
      ? slice.evaluations.map((evaluation) => {
          const employee = RATED_EMPLOYEES.find(
            (item) => item.employeeId === evaluation.employeeId,
          )
          const group = RATING_GROUPS.find((item) => item.groupCode === employee?.groupCode)
          const event = EVALUATION_EVENTS.find(
            (item) => item.securityEventId === evaluation.securityEventId,
          )
          const workItem = slice.workItems.find(
            (item) => item.submittedEvaluationId === evaluation.id,
          )
          const summary = summaries.get(evaluation.employeeId)
          return {
            // Идентификатор СТРОКИ, а не оценки: по идентификатору закрытой
            // записи её можно было бы спрашивать поимённо.
            rowId: `row-${evaluation.id}`,
            employeeId: evaluation.employeeId,
            employeeSafeLabel: employee?.safeLabel ?? '—',
            unitSafeLabel: group?.safeLabel ?? '—',
            eventNumber: event?.number ?? '—',
            eventTitle: event?.title ?? '—',
            objectLabel: event?.objectLabel ?? '—',
            postLabel: workItem?.postLabel ?? null,
            // `null`, а не `false`: отсутствие сведений об участии и
            // зафиксированное неучастие — разные утверждения.
            participated: workItem?.participated ?? null,
            evaluationDirection: evaluation.evaluationDirection,
            method: evaluation.method,
            evaluatedAt: evaluation.evaluatedAt,
            // Признак исправления — по цепочке (запись вытеснена ИЛИ сама
            // является заменой), а не сравнением старого и нового значения
            // во фронте (§19.11).
            corrected:
              evaluation.supersededById !== null ||
              slice.corrections.some((item) => item.replacementEvaluationId === evaluation.id),
            aggregateRating: summary?.aggregateRating ?? null,
            aggregateState: summary?.dataState ?? 'INSUFFICIENT_DATA',
          }
        })
      : []

    const filtered = rows.filter((row) => matchesFilters(row, filters))
    // Порядок задаёт сервер: сначала свежие записи, при равной дате — по
    // подписи участника. Сортировка по агрегату была бы таблицей лидеров,
    // запрещённой §22.16, здесь ровно так же, как в сводке.
    filtered.sort(
      (a, b) =>
        b.evaluatedAt.localeCompare(a.evaluatedAt) ||
        a.employeeSafeLabel.localeCompare(b.employeeSafeLabel, 'ru'),
    )

    return {
      results: pageOf(filtered, filters.page),
      total: filtered.length,
      page: Math.min(Math.max(1, filters.page), pageCount(filtered.length)),
      pageCount: pageCount(filtered.length),
      // Значения фильтров даёт СЕРВЕР: собрать их из полученных строк значило бы
      // показать только тех, кто уже попал в текущую страницу, а автодополнение
      // §19.15 не должно раскрывать и тех, кто вне scope.
      options: {
        events: EVALUATION_EVENTS.map((event) => ({
          value: event.number,
          label: `${event.number} — ${event.title}`,
        })),
        units: RATING_GROUPS.map((group) => ({
          value: group.safeLabel,
          label: group.safeLabel,
        })),
        employees: RATED_EMPLOYEES.map((employee) => ({
          value: employee.employeeId,
          label: employee.safeLabel,
        })),
      },
      policy: featureEnabled ? policy : null,
      capabilities: { operationalRatings: featureEnabled },
      // Sensitive-колонок нет ни у кого: право под них не заведено, потому что
      // §19.21 требует к нему scope и срок полномочия (см. §35-блок).
      columns: { sensitiveDetails: false },
      unavailableViews: UNAVAILABLE_REGISTRY_VIEWS.map((item) => ({ ...item })),
    }
  }

  /**
   * Карточка сотрудника при праве только на агрегат (§19.17, вторая ветка).
   * Отдельных оценок и оценщиков в ней нет ни одного поля — только агрегат,
   * период, версия методики и записанные точки динамики.
   */
  async function getRatingEmployeeDetail(
    actorUserId: string | null,
    employeeId: string | null,
  ): Promise<RatingEmployeeDetailResponse> {
    if (!hasPermission(actorUserId, VIEW_AGGREGATE_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_AGGREGATE_PERMISSION)
    }
    const employee = RATED_EMPLOYEES.find((item) => item.employeeId === employeeId)
    if (employee === undefined) throw new RepositoryNotFoundError(employeeId ?? '')
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение карточки агрегата до инициализации demo-состояния')
    }
    const slice = readSlice(envelope.slices)
    const policy = readRatingPolicy(envelope.slices)
    const featureEnabled = slice.capabilities.operationalRatings
    const group = RATING_GROUPS.find((item) => item.groupCode === employee.groupCode)

    return {
      employeeId: employee.employeeId,
      safeLabel: employee.safeLabel,
      unitSafeLabel: group?.safeLabel ?? '—',
      summary: buildSummary({
        employeeId: employee.employeeId,
        safeLabel: employee.safeLabel,
        evaluations: slice.evaluations,
        policy,
        featureEnabled,
        businessDate: clock.businessDate(),
        calculatedAt: clock.now(),
      }),
      points: featureEnabled
        ? slice.dynamicsPoints
            .filter((point) => point.employeeId === employee.employeeId)
            .map((point) => ({ ...point }))
            .sort((a, b) => a.periodStartsAt.localeCompare(b.periodStartsAt))
        : [],
      unavailableViews: UNAVAILABLE_REGISTRY_VIEWS.map((item) => ({ ...item })),
    }
  }

  return {
    listOperationalRatings,
    getRatingDynamics,
    getRatingAnalytics,
    getEvaluationWorkspace,
    submitEvaluation,
    getSubmittedEvaluationDetail,
    correctEvaluation,
    listEvaluationRegistry,
    getRatingEmployeeDetail,
  }
}
