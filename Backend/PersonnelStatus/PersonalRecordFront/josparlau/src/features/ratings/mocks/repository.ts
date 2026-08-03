// Feature repository (§8.5) оперативного рейтинга: агрегат считает СЕРВЕР
// (§19.19), закрытые данные наружу не едут (§19.21), состояние недоступности
// называется честно и никогда не подменяется нулём (§19.2).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import {
  RepositoryBusinessRuleError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from '../../../shared/testing/mock-runtime/repository-errors'
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
  RATING_EXPORT_FORMATS,
  UNAVAILABLE_EXPORT_FORMATS,
  UNAVAILABLE_EXPORT_SCOPES,
  buildAggregateExportContent,
  exportFileName,
  validateExportRequest,
} from '../lib/export'
import {
  UNAVAILABLE_REGISTRY_VIEWS,
  matchesFilters,
  pageCount,
  pageOf,
} from '../lib/registry'
import type { EvaluationRegistryRow, RegistryFilters } from '../lib/registry'
import type {
  CancelRatingExportResponse,
  CorrectEvaluationRequest,
  CorrectEvaluationResponse,
  CreateRatingExportRequest,
  CreateRatingExportResponse,
  DownloadRatingExportResponse,
  ListRatingExportsResponse,
  CorrectionChainLink,
  EvaluationRegistryResponse,
  EvaluationWorkItemView,
  RatingAuditResponse,
  RatingNotificationsResponse,
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
import type {
  EvaluationCorrection,
  EvaluationWorkItem,
  EventEvaluation,
  OperationalRatingSummary,
  RatingExportArtifact,
  RatingExportJob,
  RatingAuditEntry,
  RatingAuditEventCode,
  RatingNotification,
} from '../model/types'
import { EVALUATION_BASES, EVALUATION_EVENTS, RATED_EMPLOYEES, RATING_GROUPS } from './fixtures'
import type { RatingsSlice } from './fixtures'
import { readRatingPolicy, readRatingSuppressionMinGroup } from './settingsSlice'
import { readSecurityEventClosure } from './securityEventsSlice'

// Ошибки — канонические классы shared/testing/mock-runtime (ревью Этапа 73:
// копии таксономии в каждой фиче разъезжались бы формой 409-конверта, которую
// читает общий ConflictDialog). Re-export сохраняет существующие импорты.
export {
  RepositoryBusinessRuleError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from '../../../shared/testing/mock-runtime/repository-errors'

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
/**
 * §19.22 «просмотр rating audit» — свой пункт списка прав. Журнал показывает
 * действия ЛЮДЕЙ (кто отправлял, кто исправлял, кому отказали), и это
 * контрольная функция, отдельная и от оценивания, и от чтения агрегатов.
 */
const VIEW_AUDIT_PERMISSION = 'ops.rating.view_audit'
/**
 * §19.29 «только при наличии соответствующего permission» — своё право на
 * выгрузку. Правом чтения агрегата его охранять нельзя: файл переживает экран,
 * уходит из системы и требует audit-записи, а просмотр — нет.
 *
 * ОТДЕЛЬНОГО права на sensitive export не заведено НАМЕРЕННО: индивидуальная
 * выгрузка не выдаётся вовсе (§19.21 — нет ни scope, ни срока полномочия), а
 * право под неотданную операцию у эталонного администратора с wildcard
 * немедленно открыло бы её (см. `UNAVAILABLE_EXPORT_SCOPES`).
 */
const EXPORT_PERMISSION = 'ops.rating.export'

/** §35: чего нет в журнале и почему. */
const UNAVAILABLE_AUDIT_VIEWS: readonly { code: string; label: string; reason: string }[] = [
  {
    code: 'AUDIT_SENSITIVE_VALUES',
    label: 'Старое и новое значение оценки, комментарии, оценщик',
    reason:
      '§19.27 отдаёт их отдельной audit privacy permission, а §19.21 требует к ней тот же scope и срок полномочия, что и к sensitive-просмотру. Ни того, ни другого в сборке нет, поэтому значений нет в записи журнала вовсе — иначе «обычный пользователь раскрывал бы закрытые оценки через общий экран аудита» (§19.27).',
  },
  {
    code: 'AUDIT_EXPORT',
    label: 'Экспорт журнала',
    reason:
      '§19.29 требует отдельного права на экспорт и собственной audit-записи о нём. Выгрузка §19.29 сделана для АГРЕГИРОВАННОЙ СВОДКИ; журнал — другой раздел с другим правом (`ops.rating.view_audit`), и своего генератора у него нет. Кнопка здесь обещала бы файл, которого никто не собирает.',
  },
]

const AUDIT_PAGE_SIZE = 20

/** §35: уведомления §19.28, которых нет, и почему. */
const UNAVAILABLE_NOTIFICATION_VIEWS: readonly { code: string; label: string; reason: string }[] = [
  {
    code: 'AGGREGATE_UPDATED_NOTICE',
    label: 'Уведомление «Итоговая сводка оперативного рейтинга обновлена»',
    reason:
      '§19.28 называет его допустимым, но адресатов у него нет: перечня людей с правом на агрегат в сборке не существует (права резолвятся для запрашивающего, а не перечисляются). Разослать «всем» значило бы придумать список получателей, а адресовать себе — сделать вид, что уведомление работает.',
  },
  {
    code: 'EMPLOYEE_NOTICE',
    label: 'Уведомления оцениваемому сотруднику',
    reason:
      'Связь persona↔сотрудник в demo-режиме не определена (§8.9), поэтому доставить уведомление «вашу оценку исправили» некому. Отправить его оценщику вместо участника значило бы адресовать чужое сообщение.',
  },
]

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
   * Запись журнала (§19.27). Собирается ПОЛЕМ ЗА ПОЛЕМ и по построению не
   * может нести значение оценки или комментарий: их просто нет среди
   * параметров — это дешевле, чем помнить про фильтрацию на каждом вызове.
   */
  function auditEntry(
    current: { revision: number },
    index: number,
    input: {
      actorUserId: string | null
      eventCode: RatingAuditEventCode
      outcome: 'SUCCESS' | 'REJECTED'
      reasonCode?: string | null
      item?: EvaluationWorkItem
      evaluationId?: string | null
      correctionId?: string | null
      requestId?: string | null
      revision?: number | null
    },
  ): RatingAuditEntry {
    return {
      id: `rating-audit-${current.revision + 1}-${index}`,
      occurredAt: clock.now(),
      actorUserId: input.actorUserId,
      eventCode: input.eventCode,
      outcome: input.outcome,
      reasonCode: input.reasonCode ?? null,
      securityEventId: input.item?.securityEventId ?? null,
      eventRunId: input.item?.eventRunId ?? null,
      assignmentId: input.item?.assignmentId ?? null,
      evaluationId: input.evaluationId ?? null,
      correctionId: input.correctionId ?? null,
      requestId: input.requestId ?? null,
      revision: input.revision ?? input.item?.revision ?? null,
    }
  }

  /**
   * Запись об ОТКАЗЕ идёт СВОЕЙ транзакцией. Внутри отклонённой мутации она
   * исчезла бы вместе с откатом: отказ на то и отказ, что состояние не
   * меняется, — а журнал обязан его помнить (§19.27 «отклонённое исправление»,
   * «попытка снижения без комментария», «запрещённая попытка просмотра»).
   */
  async function recordRejection(input: {
    actorUserId: string | null
    eventCode: RatingAuditEventCode
    reasonCode: string
    workItemId?: string
    requestId?: string | null
  }): Promise<void> {
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const item = slice.workItems.find((entry) => entry.id === input.workItemId)
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          auditEntries: [
            ...slice.auditEntries,
            auditEntry(current, slice.auditEntries.length + 1, {
              actorUserId: input.actorUserId,
              eventCode: input.eventCode,
              outcome: 'REJECTED',
              reasonCode: input.reasonCode,
              item,
              requestId: input.requestId ?? null,
            }),
          ],
        },
      }
    })
  }

  /**
   * Журнал оценивания (§19.27). Право СВОЁ: контроль над действиями людей —
   * не то же, что участие в них.
   */
  async function listRatingAudit(
    actorUserId: string | null,
    page: number,
  ): Promise<RatingAuditResponse> {
    if (!hasPermission(actorUserId, VIEW_AUDIT_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_AUDIT_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение журнала рейтинга до инициализации demo-состояния')
    }
    const slice = readSlice(envelope.slices)
    // Порядок — от свежего к старому: журнал читают, чтобы увидеть последнее.
    const ordered = [...slice.auditEntries].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt),
    )
    const pageCount = Math.max(1, Math.ceil(ordered.length / AUDIT_PAGE_SIZE))
    const safePage = Math.min(Math.max(1, page), pageCount)
    return {
      results: ordered
        .slice((safePage - 1) * AUDIT_PAGE_SIZE, safePage * AUDIT_PAGE_SIZE)
        .map((item) => ({ ...item })),
      total: ordered.length,
      page: safePage,
      pageCount,
      unavailableViews: UNAVAILABLE_AUDIT_VIEWS.map((item) => ({ ...item })),
    }
  }

  /**
   * Уведомление (§19.28). Текст НЕ хранится — только код: готовая строка
   * однажды была бы собрана из закрытых полей и не замечена, а в фиксированную
   * формулировку экрана подставлять нечего.
   */
  function notification(
    current: { revision: number },
    index: number,
    input: {
      recipientUserId: string
      code: RatingNotification['code']
      deepLink: string
      securityEventId: string | null
    },
  ): RatingNotification {
    return {
      id: `rating-notification-${current.revision + 1}-${index}`,
      createdAt: clock.now(),
      recipientUserId: input.recipientUserId,
      code: input.code,
      deepLink: input.deepLink,
      securityEventId: input.securityEventId,
    }
  }

  /**
   * Свои уведомления (§19.28). Отбор по адресату делает СЕРВЕР: чужие в ответ
   * не попадают, поэтому и отдельного права «видеть чужие» нет — охранять им
   * нечего.
   */
  async function listRatingNotifications(
    actorUserId: string | null,
  ): Promise<RatingNotificationsResponse> {
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение уведомлений рейтинга до инициализации состояния')
    }
    const slice = readSlice(envelope.slices)
    return {
      results: slice.notifications
        .filter((item) => item.recipientUserId === actorUserId)
        .map((item) => ({ ...item }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      unavailableViews: UNAVAILABLE_NOTIFICATION_VIEWS.map((item) => ({ ...item })),
    }
  }

  /**
   * Подробности конфликта (§19.25): актуальная редакция и ДЕЙСТВУЮЩИЕ значения
   * записи. Без них экран может сказать только «повторите» — а промпт требует
   * показать человеку diff, то есть то, что изменилось, пока он заполнял форму.
   */
  function conflictDetails(
    item: EvaluationWorkItem,
    evaluations: readonly EventEvaluation[],
  ): Record<string, unknown> {
    const current =
      item.submittedEvaluationId === null
        ? undefined
        : evaluations.find((entry) => entry.id === item.submittedEvaluationId)
    return {
      currentRevision: item.revision,
      currentScore: current?.score ?? null,
      currentBasisLabel: basisLabel(current?.basisCode ?? null),
      currentComment: current?.comment ?? null,
      currentEvaluationId: current?.id ?? null,
    }
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
      await recordRejection({
        actorUserId,
        eventCode: 'EVALUATION_ACCESS_DENIED',
        reasonCode: 'PERMISSION_DENIED',
        workItemId,
        requestId: body.idempotencyKey,
      })
      throw new RepositoryPermissionError(EVALUATE_PERMISSION)
    }
    let response: SubmitEvaluationResponse | null = null
    const mutation = runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      // §19.26: повтор с тем же ключом возвращает ПРЕЖНИЙ результат и не
      // создаёт второй оценки. Проверка стоит до всех прочих: повторный запрос
      // после таймаута приходит на задание, которое уже не `PENDING`, и без неё
      // человек получил бы «уже отправлено» вместо своего же результата.
      const done = slice.idempotency.find(
        (entry) => entry.key === body.idempotencyKey && entry.operation === 'submit',
      )
      if (done !== undefined) {
        const repeated = slice.workItems.find((entry) => entry.id === done.workItemId)
        const view = repeated === undefined ? null : toSubmittedView(repeated, slice.evaluations, actorUserId)
        if (repeated !== undefined && view !== null) {
          response = {
            workItem: toWorkItemView(repeated),
            submitted: view,
            queue: summarizeQueue(
              slice.workItems.filter(
                (entry) =>
                  entry.evaluatorUserId === actorUserId &&
                  entry.securityEventId === repeated.securityEventId,
              ),
            ),
          }
          return current.slices
        }
      }
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
      // §19.23: закрытое мероприятие обычная rating mutation не изменяет —
      // поздняя ОЦЕНКА оформлялась бы «разрешённым дополнением», которого в
      // контракте нет. Замок стоит ДО состояния задания и правил формы — иначе
      // причина отказа зависела бы от того, что именно человек ввёл. `null` —
      // мероприятия нет в реестре ОМ (исторические задания сида): замок
      // неприменим. ИСПРАВЛЕНИЕ (§19.34) замка НЕ получает: оно и так не
      // меняет ни исходную запись, ни архивный снимок — создаётся связанное
      // замещение, ровно как требует сценарий «позднее исправление».
      const closure = readSecurityEventClosure(current.slices, item.securityEventId)
      if (closure !== null && closure.closed) {
        throw new RepositoryBusinessRuleError(
          'EVALUATION_ARCHIVE_LOCKED',
          'Мероприятие закрыто, архив сформирован: оценка оформляется только разрешённым дополнением, которого в контракте нет.',
        )
      }
      if (item.status !== 'PENDING') {
        throw new RepositoryBusinessRuleError(
          'EVALUATION_ALREADY_SUBMITTED',
          'Оценка по этому заданию уже отправлена. Исправление — отдельная операция (§19.18).',
        )
      }
      // §19.33/§19.35 «оценивается фактический участник»: задание с
      // неподтверждённым участием показывается (факт участия — часть контекста,
      // §19.9), но ОЦЕНКУ не принимает. Формулировка — каноническая §19.30.
      if (!item.participated) {
        throw new RepositoryBusinessRuleError(
          'PARTICIPATION_NOT_CONFIRMED',
          'Фактическое участие сотрудника не подтверждено.',
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
        throw new RepositoryConflictError(
          'EVALUATION_REVISION_MISMATCH',
          'Задание изменилось: сравните значения и решите, что отправлять.',
          conflictDetails(item, slice.evaluations),
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
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          workItems,
          evaluations,
          notifications: [
            ...slice.notifications,
            // §19.28 «уведомления создаются только после commit»: запись живёт в
            // ТОЙ ЖЕ транзакции, что и оценка, — отдельная могла бы пережить
            // неудавшийся коммит и сообщить о том, чего не произошло.
            notification(current, slice.notifications.length + 1, {
              recipientUserId: actorUserId ?? '',
              code: 'EVALUATION_SUBMITTED',
              deepLink: `/ratings/workspace?event=${item.securityEventId}`,
              securityEventId: item.securityEventId,
            }),
          ],
          auditEntries: [
            ...slice.auditEntries,
            auditEntry(current, slice.auditEntries.length + 1, {
              actorUserId,
              eventCode: 'EVALUATION_SUBMITTED',
              outcome: 'SUCCESS',
              item: nextItem,
              evaluationId: evaluation.id,
              requestId: body.idempotencyKey,
            }),
            // §19.27 требует отдельного события «изменение значения
            // относительно начального»: отправка восьмёрки и снижение до
            // четвёрки — разные факты, и общая запись их не различила бы.
            ...(evaluation.score === item.initialScore
              ? []
              : [
                  auditEntry(current, slice.auditEntries.length + 2, {
                    actorUserId,
                    eventCode: 'EVALUATION_SCORE_CHANGED_FROM_INITIAL',
                    outcome: 'SUCCESS',
                    item: nextItem,
                    evaluationId: evaluation.id,
                    requestId: body.idempotencyKey,
                  }),
                ]),
          ],
          idempotency: [
            ...slice.idempotency,
            {
              key: body.idempotencyKey,
              operation: 'submit',
              workItemId: item.id,
              // В записи только идентификаторы: снимок ответа нёс бы закрытый
              // комментарий целиком.
              evaluationId: evaluation.id,
            },
          ],
        },
      }
    })
    try {
      await mutation
    } catch (error) {
      // Отказ пишется СВОЕЙ транзакцией: внутри отклонённой он откатился бы
      // вместе с ней. Попытка снижения без комментария названа своим событием —
      // §19.27 перечисляет её отдельно от прочих отказов формы.
      if (error instanceof RepositoryBusinessRuleError || error instanceof RepositoryConflictError) {
        await recordRejection({
          actorUserId,
          eventCode:
            error.errorCode === 'COMMENT_REQUIRED'
              ? 'EVALUATION_LOW_SCORE_WITHOUT_COMMENT'
              : 'EVALUATION_ACCESS_DENIED',
          reasonCode: error.errorCode,
          workItemId,
          requestId: body.idempotencyKey,
        })
      }
      throw error
    }
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
      // §19.27 «запрещённая попытка просмотра sensitive evaluation»: наружу
      // по-прежнему 404 (существование записи не подтверждаем), но в журнале
      // попытка остаётся — иначе контролировать было бы нечего.
      await recordRejection({
        actorUserId,
        eventCode: 'EVALUATION_ACCESS_DENIED',
        reasonCode: 'FOREIGN_EVALUATION',
        workItemId,
      })
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
      await recordRejection({
        actorUserId,
        eventCode: 'EVALUATION_ACCESS_DENIED',
        reasonCode: 'PERMISSION_DENIED',
        workItemId,
        requestId: body.idempotencyKey,
      })
      throw new RepositoryPermissionError(CORRECT_PERMISSION)
    }
    let response: CorrectEvaluationResponse | null = null
    const mutation = runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const done = slice.idempotency.find(
        (entry) => entry.key === body.idempotencyKey && entry.operation === 'correct',
      )
      if (done !== undefined) {
        const repeated = slice.workItems.find((entry) => entry.id === done.workItemId)
        const view = repeated === undefined ? null : toSubmittedView(repeated, slice.evaluations, actorUserId)
        if (repeated !== undefined && view !== null) {
          response = {
            workItem: toWorkItemView(repeated),
            submitted: view,
            chain: hasPermission(actorUserId, VIEW_CHAIN_PERMISSION)
              ? buildChain(slice.evaluations, slice.corrections, done.evaluationId)
              : null,
          }
          return current.slices
        }
      }
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
        throw new RepositoryConflictError(
          'EVALUATION_REVISION_MISMATCH',
          'Запись изменилась: сравните значения и решите, что отправлять.',
          conflictDetails(item, slice.evaluations),
        )
      }
      const original = slice.evaluations.find((entry) => entry.id === originalId)
      if (original === undefined) throw new RepositoryNotFoundError(originalId)
      // §19.25 перечисляет «evaluation already corrected» ОТДЕЛЬНЫМ конфликтом:
      // редакция могла совпасть, а запись уже быть вытесненной — тогда человек
      // правит не ту строку, и сказать это надо прямо.
      if (original.supersededById !== null) {
        throw new RepositoryConflictError(
          'EVALUATION_ALREADY_CORRECTED',
          'Эта запись уже исправлена: откройте действующую и повторите.',
          conflictDetails(item, slice.evaluations),
        )
      }
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
        [SLICE_NAME]: {
          ...slice,
          workItems,
          evaluations,
          corrections,
          notifications: [
            ...slice.notifications,
            // Адресат — АВТОР исходной записи, а не тот, кто исправил: §19.28
            // «оценка была исправлена уполномоченным пользователем» сообщает
            // человеку о ЕГО записи. В сборке исправление ограничено своей
            // записью, поэтому автор и актор совпадают, — но адресность взята
            // из записи, а не из того, кто нажал кнопку.
            notification(current, slice.notifications.length + 1, {
              recipientUserId: original.evaluatorUserId ?? actorUserId ?? '',
              code: 'EVALUATION_CORRECTED',
              deepLink: `/ratings/workspace?event=${item.securityEventId}`,
              securityEventId: item.securityEventId,
            }),
          ],
          auditEntries: [
            ...slice.auditEntries,
            auditEntry(current, slice.auditEntries.length + 1, {
              actorUserId,
              eventCode: 'EVALUATION_CORRECTED',
              outcome: 'SUCCESS',
              item: nextItem,
              evaluationId: replacement.id,
              correctionId: correction.id,
              requestId: body.idempotencyKey,
            }),
          ],
          idempotency: [
            ...slice.idempotency,
            {
              key: body.idempotencyKey,
              operation: 'correct',
              workItemId: item.id,
              evaluationId: replacement.id,
            },
          ],
        },
      }
    })
    try {
      await mutation
    } catch (error) {
      if (error instanceof RepositoryBusinessRuleError || error instanceof RepositoryConflictError) {
        await recordRejection({
          actorUserId,
          eventCode: 'EVALUATION_CORRECTION_REJECTED',
          reasonCode: error.errorCode,
          workItemId,
          requestId: body.idempotencyKey,
        })
      }
      throw error
    }
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

  /**
   * Агрегированные сводки всех участников — тем же расчётом, что и экран
   * (§19.19 считает СЕРВЕР). Выгрузка обязана совпадать с тем, что человек
   * видел: собрать её отдельной формулой значило бы завести вторую методику,
   * о которой никакая `policyVersion` не сообщает.
   */
  function buildAllSummaries(
    slice: RatingsSlice,
    policy: ReturnType<typeof readRatingPolicy>,
  ): OperationalRatingSummary[] {
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
    // Порядок тот же, что в сводке: по подписи. Сортировка по значению —
    // таблица лидеров, запрещённая §22.16, и в файле она жила бы дольше экрана.
    results.sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, 'ru'))
    return results
  }

  /**
   * §19.29, продвижение работы экспорта. Ступень выполняется на ЧТЕНИИ:
   * фонового исполнителя в demo нет (§8.8). Упрощён ИСПОЛНИТЕЛЬ, а не модель
   * состояний — состояния лежат в слайсе и меняются только здесь.
   *
   * Файл собирается РОВНО на переходе в `READY` и больше не пересобирается:
   * иначе содержимое менялось бы от опроса, и «тот же файл» у двух скачиваний
   * оказался бы разным.
   */
  function advanceExport(
    slice: RatingsSlice,
    job: RatingExportJob,
    sourceSlices: Record<string, unknown>,
  ): { job: RatingExportJob; artifact: RatingExportArtifact | null } {
    if (job.state === 'READY' || job.state === 'FAILED' || job.state === 'CANCELLED') {
      return { job, artifact: null }
    }
    if (job.state === 'QUEUED') {
      return { job: { ...job, state: 'GENERATING' }, artifact: null }
    }
    // Выключенная за время сборки функция — СОСТОЯНИЕ работы, а не исключение
    // наружу: одна неудачная выгрузка иначе роняла бы чтение всего списка, и
    // человек не увидел бы ни готовых файлов, ни причины (§19.3 + §19.30).
    if (!slice.capabilities.operationalRatings) {
      return {
        job: {
          ...job,
          state: 'FAILED',
          finishedAt: clock.now(),
          failureCode: 'RATING_DISABLED',
          safeFailureMessage:
            'Оперативный рейтинг выключен: сводки, по которой собирается файл, не существует.',
        },
        artifact: null,
      }
    }
    const policy = readRatingPolicy(sourceSlices)
    const summaries = buildAllSummaries(slice, policy)
    const generatedAt = clock.now()
    const artifact: RatingExportArtifact = {
      artifactId: `rating-export-artifact-${job.exportJobId}`,
      exportJobId: job.exportJobId,
      scope: job.scope,
      format: job.format,
      fileName: exportFileName(job.scope, job.format, clock.businessDate()),
      generatedAt,
      // Методика замораживается В ФАЙЛЕ: её могли сменить после выгрузки, и
      // сравнивать значения разных редакций как однородные нельзя (§19.20).
      policyVersion: policy?.policyVersion ?? null,
      rowCount: summaries.length,
      content: buildAggregateExportContent(summaries, policy),
    }
    return {
      job: { ...job, state: 'READY', finishedAt: generatedAt, artifactId: artifact.artifactId },
      artifact,
    }
  }

  /**
   * Свои работы экспорта (§19.29). Чужие в ответ не попадают: сам факт
   * выгрузки — действие человека, и показывать его соседям незачем; контроль
   * над ним ведёт журнал (§19.27), у которого своё право.
   */
  async function listRatingExports(
    actorUserId: string | null,
  ): Promise<ListRatingExportsResponse> {
    if (!hasPermission(actorUserId, EXPORT_PERMISSION)) {
      throw new RepositoryPermissionError(EXPORT_PERMISSION)
    }
    let response!: ListRatingExportsResponse
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const artifacts = [...slice.exportArtifacts]
      // Продвигаются ВСЕ работы, а не только видимые смотрящему: ступень
      // выполняется на чтении, и чужая работа иначе застревала бы навсегда.
      const jobs = slice.exportJobs.map((job) => {
        const stepped = advanceExport(slice, job, current.slices)
        if (stepped.artifact !== null) artifacts.push(stepped.artifact)
        return stepped.job
      })
      const mine = jobs.filter((job) => job.createdBy === (actorUserId ?? ''))
      const mineIds = new Set(mine.map((job) => job.exportJobId))

      response = {
        results: [...mine]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((job) => ({ ...job })),
        // Содержимое в список НЕ едет: файл выдаётся отдельной операцией.
        artifacts: artifacts
          .filter((artifact) => mineIds.has(artifact.exportJobId))
          .map((artifact) => {
            // Содержимое вырезается КОПИЕЙ, а не destructuring-омитом:
            // `varsIgnorePattern` в конфиге нет, и `_content` красит гейт.
            const summary = { ...artifact }
            delete (summary as Partial<RatingExportArtifact>).content
            return summary as Omit<RatingExportArtifact, 'content'>
          }),
        formats: [...RATING_EXPORT_FORMATS],
        unavailableFormats: UNAVAILABLE_EXPORT_FORMATS.map((item) => ({ ...item })),
        unavailableScopes: UNAVAILABLE_EXPORT_SCOPES.map((item) => ({ ...item })),
        capabilities: { operationalRatings: slice.capabilities.operationalRatings },
        serverTime: clock.now(),
      }
      return {
        ...current.slices,
        [SLICE_NAME]: { ...slice, exportJobs: jobs, exportArtifacts: artifacts },
      }
    })
    return response
  }

  /**
   * Заказ выгрузки (§19.29).
   *
   * Работа создаётся в `QUEUED` и НИКАКОЙ ссылки на файл не несёт: §19.29
   * «Не добавляй фиктивную ссылку на файл», «файл считается готовым только
   * после ответа repository». Audit-запись живёт в ТОЙ ЖЕ транзакции, что и
   * работа: отдельная пережила бы неудавшийся коммит и сообщила бы о выгрузке,
   * которой не заказывали.
   */
  async function createRatingExport(
    actorUserId: string | null,
    body: CreateRatingExportRequest,
  ): Promise<CreateRatingExportResponse> {
    if (!hasPermission(actorUserId, EXPORT_PERMISSION)) {
      await recordRejection({
        actorUserId,
        eventCode: 'RATING_EXPORT_REJECTED',
        reasonCode: 'PERMISSION_DENIED',
        requestId: body.idempotencyKey,
      })
      throw new RepositoryPermissionError(EXPORT_PERMISSION)
    }
    // Проверка режима и формата — ДО транзакции и независимо от прав
    // смотрящего: индивидуальная выгрузка не выдаётся никому, включая
    // эталонного администратора с wildcard (§19.21 — нет ни scope, ни срока
    // полномочия). Отказ фиксируется своей записью, как и прочие отказы §19.27.
    const violation = validateExportRequest({ scope: body.scope, format: body.format })
    if (violation !== null) {
      await recordRejection({
        actorUserId,
        eventCode: 'RATING_EXPORT_REJECTED',
        reasonCode: violation.code,
        requestId: body.idempotencyKey,
      })
      throw new RepositoryBusinessRuleError(violation.code, violation.message)
    }

    let response: CreateRatingExportResponse | null = null
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      // §19.26: повтор с тем же ключом возвращает ПРЕЖНЮЮ работу. Без этого
      // повторное нажатие после таймаута заводило бы вторую выгрузку — и
      // вторую запись в журнале о том, что данные покидали систему дважды.
      const repeated = slice.exportJobs.find((job) => job.idempotencyKey === body.idempotencyKey)
      if (repeated !== undefined) {
        response = { job: { ...repeated } }
        return current.slices
      }
      const job: RatingExportJob = {
        // Идентификатор генерирует СЕРВЕР и он устойчив между перезагрузками.
        exportJobId: `rating-export-${current.revision + 1}-${slice.exportJobs.length + 1}`,
        scope: body.scope,
        format: body.format,
        state: 'QUEUED',
        createdAt: clock.now(),
        createdBy: actorUserId ?? '',
        finishedAt: null,
        failureCode: null,
        safeFailureMessage: null,
        artifactId: null,
        idempotencyKey: body.idempotencyKey,
      }
      response = { job: { ...job } }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          exportJobs: [...slice.exportJobs, job],
          auditEntries: [
            ...slice.auditEntries,
            auditEntry(current, slice.auditEntries.length + 1, {
              actorUserId,
              eventCode: 'RATING_EXPORT_REQUESTED',
              outcome: 'SUCCESS',
              requestId: body.idempotencyKey,
            }),
          ],
        },
      }
    })
    if (response === null) throw new Error('mock-runtime: заказ выгрузки не вернул результат')
    return response
  }

  /**
   * Отмена выгрузки (§19.29 `CANCELLED`). Отменить можно ТОЛЬКО незавершённую
   * работу: у готовой отмена ничего не отменяет — файл уже собран, а состояние
   * `CANCELLED` на нём означало бы, что его не существует.
   */
  async function cancelRatingExport(
    actorUserId: string | null,
    exportJobId: string,
  ): Promise<CancelRatingExportResponse> {
    if (!hasPermission(actorUserId, EXPORT_PERMISSION)) {
      throw new RepositoryPermissionError(EXPORT_PERMISSION)
    }
    let response: CancelRatingExportResponse | null = null
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const job = slice.exportJobs.find((entry) => entry.exportJobId === exportJobId)
      // Чужая работа — 404, а не 403: отказ по праву подтвердил бы, что
      // выгрузка с таким идентификатором существует и кем-то заказана.
      if (job === undefined || job.createdBy !== (actorUserId ?? '')) {
        throw new RepositoryNotFoundError(exportJobId)
      }
      if (job.state !== 'QUEUED' && job.state !== 'GENERATING') {
        throw new RepositoryBusinessRuleError(
          'EXPORT_NOT_CANCELLABLE',
          'Работа уже завершена: отменять нечего.',
        )
      }
      const cancelled: RatingExportJob = { ...job, state: 'CANCELLED', finishedAt: clock.now() }
      response = { job: { ...cancelled } }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          exportJobs: slice.exportJobs.map((entry) =>
            entry.exportJobId === job.exportJobId ? cancelled : entry,
          ),
        },
      }
    })
    if (response === null) throw new Error('mock-runtime: отмена выгрузки не вернула результат')
    return response
  }

  /**
   * Выдача файла (§19.29). ОТДЕЛЬНАЯ операция, повторно проверяющая право,
   * владельца и состояние: пришедший по ссылке не считается допущенным потому,
   * что ссылка у него есть.
   *
   * Запись в журнал — о ВЫДАЧЕ, а не о заказе: §19.29 требует audit за
   * выгрузку, и главный вопрос контроля — что покинуло систему, а не что было
   * поставлено в очередь и отменено.
   */
  async function downloadRatingExport(
    actorUserId: string | null,
    artifactId: string,
  ): Promise<DownloadRatingExportResponse> {
    if (!hasPermission(actorUserId, EXPORT_PERMISSION)) {
      await recordRejection({
        actorUserId,
        eventCode: 'RATING_EXPORT_REJECTED',
        reasonCode: 'PERMISSION_DENIED',
      })
      throw new RepositoryPermissionError(EXPORT_PERMISSION)
    }
    let response: DownloadRatingExportResponse | null = null
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const artifact = slice.exportArtifacts.find((entry) => entry.artifactId === artifactId)
      const job =
        artifact === undefined
          ? undefined
          : slice.exportJobs.find((entry) => entry.exportJobId === artifact.exportJobId)
      if (artifact === undefined || job === undefined || job.createdBy !== (actorUserId ?? '')) {
        throw new RepositoryNotFoundError(artifactId)
      }
      // Состояние работы перепроверяется ЗАНОВО: файл отменённой или упавшей
      // работы выдавать нечем, даже если артефакт когда-то успел собраться.
      if (job.state !== 'READY') {
        throw new RepositoryBusinessRuleError(
          'EXPORT_NOT_READY',
          'Файл не выдан: работа не в состоянии «Готов».',
        )
      }
      response = { fileName: artifact.fileName, content: artifact.content }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          auditEntries: [
            ...slice.auditEntries,
            auditEntry(current, slice.auditEntries.length + 1, {
              actorUserId,
              eventCode: 'RATING_EXPORT_DOWNLOADED',
              outcome: 'SUCCESS',
              requestId: job.idempotencyKey,
            }),
          ],
        },
      }
    })
    if (response === null) throw new Error('mock-runtime: выдача файла не вернула результат')
    return response
  }

  return {
    listOperationalRatings,
    listRatingExports,
    createRatingExport,
    cancelRatingExport,
    downloadRatingExport,
    getRatingDynamics,
    getRatingAnalytics,
    getEvaluationWorkspace,
    submitEvaluation,
    getSubmittedEvaluationDetail,
    correctEvaluation,
    listRatingAudit,
    listRatingNotifications,
    listEvaluationRegistry,
    getRatingEmployeeDetail,
  }
}
