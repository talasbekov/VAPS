// Feature repository (§8.5): асинхронная генерация отчёта (§22.21),
// immutable-артефакт (§22.22), скачивание с повторной проверкой (§22.23),
// server-side masking (§22.24).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import {
  CALCULATION_VERSION,
  MASKED_FIELDS,
  MASKING_POLICY_VERSION,
  UNAVAILABLE_ARTIFACT_FIELDS,
  UNAVAILABLE_FORMATS,
  buildReportContent,
  contentHash,
  contentSize,
  isArtifactAvailable,
  periodDays,
  selectRows,
} from '../lib/reporting'
import { readReportSourceRows } from './dutiesSlice'
import type { ServiceReportsSlice } from './fixtures'
import type {
  CreateReportJobRequest,
  DownloadArtifactResponse,
  ListReportJobsResponse,
  ListReportTypesResponse,
  ReportArtifactSummary,
} from '../api/pending-contracts'
import type { ReportArtifact, ReportJob } from '../model/types'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

const SLICE_NAME = 'serviceReports'
/** §22.26: запуск отчёта — своё право, отдельное от аналитики: смотреть
 * дашборд и выгружать поимённый расход личного состава — разные действия. */
const GENERATE_PERMISSION = 'ops.report.generate'
/** §20.32 «Sensitive export является отдельной операцией» — и отдельным
 * правом: право выгружать отчёт не даёт права выгружать скрытые поля. */
const SENSITIVE_PERMISSION = 'ops.report.export_sensitive'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function readSlice(slices: Record<string, unknown>): ServiceReportsSlice {
  const slice = slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as ServiceReportsSlice
}

/** Ступени генерации. §22.21: состояния СЕРВЕРНЫЕ; здесь моделируется только
 * ИСПОЛНИТЕЛЬ, которого в demo нет (см. шапку `ReportJobState`). */
const PROGRESS_STEP = 50

export function createServiceReportsRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  async function listReportTypes(actorUserId: string | null): Promise<ListReportTypesResponse> {
    if (!hasPermission(actorUserId, GENERATE_PERMISSION)) {
      throw new RepositoryPermissionError(GENERATE_PERMISSION)
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope.slices)
    return {
      results: slice?.reportTypes ?? [],
      retentionPolicy: slice?.retentionPolicy ?? { retentionDays: 0, policyVersion: 'unknown' },
      maskedFields: [...MASKED_FIELDS],
      unavailableFormats: [...UNAVAILABLE_FORMATS],
      unavailableArtifactFields: [...UNAVAILABLE_ARTIFACT_FIELDS],
      canExportSensitive: hasPermission(actorUserId, SENSITIVE_PERMISSION),
    }
  }

  /**
   * §22.24 «безопасная проекция»: из артефакта наружу едут МЕТАДАННЫЕ, но не
   * содержимое и не ссылка на файл. Доступность считается сервером по своему
   * времени — экран не пересчитывает срок хранения своими часами.
   */
  function summarize(artifact: ReportArtifact, nowIso: string): ReportArtifactSummary {
    const available = isArtifactAvailable(artifact, nowIso)
    return {
      artifactId: artifact.artifactId,
      reportJobId: artifact.reportJobId,
      safeTitle: artifact.safeTitle,
      format: artifact.format,
      revision: artifact.revision,
      generatedAt: artifact.generatedAt,
      generatedBy: artifact.generatedBy,
      parameterSnapshot: artifact.parameterSnapshot,
      calculationVersion: artifact.calculationVersion,
      maskingPolicyVersion: artifact.maskingPolicyVersion,
      sensitive: artifact.sensitive,
      fileSize: artifact.fileSize,
      hash: artifact.hash,
      expiresAt: artifact.expiresAt,
      available,
      unavailableReason: available ? null : 'EXPIRED',
    }
  }

  /**
   * §22.21, продвижение работы. Ступень выполняется на ЧТЕНИИ, потому что
   * фонового исполнителя в demo нет; это упрощение исполнителя, а не модель
   * состояний — состояния лежат в слайсе и меняются только сервером.
   *
   * Артефакт формируется РОВНО на переходе в COMPLETED и больше не меняется
   * (§22.22 immutable): повторное чтение завершённой работы ничего не
   * пересчитывает, иначе «неизменяемый» артефакт менялся бы от опроса.
   */
  function advance(
    slice: ServiceReportsSlice,
    job: ReportJob,
    sourceSlices: Record<string, unknown>,
  ): { job: ReportJob; artifact: ReportArtifact | null } {
    if (job.state === 'COMPLETED' || job.state === 'FAILED') {
      return { job, artifact: null }
    }
    if (job.state === 'PENDING') {
      return {
        job: { ...job, state: 'PROCESSING', progressPercent: PROGRESS_STEP },
        artifact: null,
      }
    }

    const rows = selectRows(readReportSourceRows(sourceSlices), job.parameters)
    const content = buildReportContent(rows, job.parameters, job.sensitive)
    const generatedAt = clock.now()
    const expiresAt = new Date(
      Date.parse(generatedAt) + slice.retentionPolicy.retentionDays * 86_400_000,
    ).toISOString()
    const artifact: ReportArtifact = {
      artifactId: `artifact-${job.reportJobId}`,
      reportJobId: job.reportJobId,
      reportTypeCode: job.reportTypeCode,
      safeTitle:
        slice.reportTypes.find((type) => type.reportTypeCode === job.reportTypeCode)?.safeTitle ??
        job.reportTypeCode,
      format: job.format,
      // Первая редакция артефакта работы. Повторный запуск — ДРУГАЯ работа со
      // своим артефактом, а не вторая редакция этого.
      revision: 1,
      generatedAt,
      generatedBy: job.createdBy.userId,
      parameterSnapshot: job.parameters,
      calculationVersion: CALCULATION_VERSION,
      maskingPolicyVersion: MASKING_POLICY_VERSION,
      sensitive: job.sensitive,
      fileSize: contentSize(content),
      hash: contentHash(content),
      expiresAt,
      content,
    }
    return {
      job: {
        ...job,
        state: 'COMPLETED',
        progressPercent: 100,
        completedAt: generatedAt,
        artifactId: artifact.artifactId,
      },
      artifact,
    }
  }

  async function listReportJobs(actorUserId: string | null): Promise<ListReportJobsResponse> {
    if (!hasPermission(actorUserId, GENERATE_PERMISSION)) {
      throw new RepositoryPermissionError(GENERATE_PERMISSION)
    }
    let response!: ListReportJobsResponse
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const artifacts = [...slice.artifacts]
      const jobs = slice.jobs.map((job) => {
        const stepped = advance(slice, job, current.slices)
        if (stepped.artifact !== null) artifacts.push(stepped.artifact)
        return stepped.job
      })
      const now = clock.now()
      response = {
        results: [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        artifacts: artifacts.map((artifact) => summarize(artifact, now)),
        serverTime: now,
      }
      return {
        ...current.slices,
        [SLICE_NAME]: { ...slice, jobs, artifacts } satisfies ServiceReportsSlice,
      }
    })
    return response
  }

  /**
   * §22.21 создание работы. Порядок проверок: право → sensitive-право →
   * параметры. Право на sensitive проверяется ДО валидации периода намеренно:
   * «неверный период» у того, кому вообще нельзя выгружать скрытые поля, —
   * подмена причины отказа.
   */
  async function createReportJob(
    request: CreateReportJobRequest,
    actorUserId: string | null,
  ): Promise<ReportJob> {
    if (!hasPermission(actorUserId, GENERATE_PERMISSION)) {
      throw new RepositoryPermissionError(GENERATE_PERMISSION)
    }
    if (request.sensitive && !hasPermission(actorUserId, SENSITIVE_PERMISSION)) {
      throw new RepositoryPermissionError(SENSITIVE_PERMISSION)
    }
    if (!DATE_RE.test(request.from) || !DATE_RE.test(request.to)) {
      throw new RepositoryBusinessRuleError(
        'INVALID_PERIOD',
        'Укажите период в формате ГГГГ-ММ-ДД.',
      )
    }
    if (request.from > request.to) {
      throw new RepositoryBusinessRuleError(
        'INVALID_PERIOD',
        'Начало периода позже его конца.',
      )
    }
    if (request.idempotencyKey.trim() === '') {
      throw new RepositoryBusinessRuleError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Запуск отчёта требует ключа идемпотентности.',
      )
    }

    let created!: ReportJob
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const reportType = slice.reportTypes.find(
        (type) => type.reportTypeCode === request.reportTypeCode,
      )
      if (reportType === undefined) {
        throw new RepositoryBusinessRuleError('UNKNOWN_REPORT_TYPE', 'Неизвестный тип отчёта.')
      }
      if (!reportType.formats.includes(request.format)) {
        throw new RepositoryBusinessRuleError(
          'UNSUPPORTED_FORMAT',
          'Этот формат для отчёта не формируется.',
        )
      }
      const parameters = { from: request.from, to: request.to }
      if (periodDays(parameters) > reportType.maxPeriodDays) {
        throw new RepositoryBusinessRuleError(
          'PERIOD_TOO_LONG',
          `Период отчёта не может превышать ${reportType.maxPeriodDays} дней.`,
        )
      }

      // §22.21 идемпотентность: тот же ключ возвращает ТУ ЖЕ работу, а не
      // создаёт вторую. Без этого повторный клик (или ретрай сети) давал бы
      // два артефакта на одну просьбу.
      const existing = slice.jobs.find((job) => job.idempotencyKey === request.idempotencyKey)
      if (existing !== undefined) {
        created = existing
        return current.slices
      }

      created = {
        reportJobId: `report-job-${current.revision + 1}-${slice.jobs.length + 1}`,
        reportTypeCode: request.reportTypeCode,
        format: request.format,
        // Работа создаётся В ОЖИДАНИИ, а не готовой: §22.21 «success показывай
        // только после COMPLETED и получения artifactId».
        state: 'PENDING',
        progressPercent: null,
        createdAt: clock.now(),
        createdBy: { userId: actorUserId ?? '', safeLabel: actorUserId ?? '' },
        completedAt: null,
        failureCode: null,
        safeFailureMessage: null,
        artifactId: null,
        idempotencyKey: request.idempotencyKey,
        sensitive: request.sensitive,
        parameters,
      }
      return {
        ...current.slices,
        [SLICE_NAME]: { ...slice, jobs: [...slice.jobs, created] } satisfies ServiceReportsSlice,
      }
    })
    return created
  }

  /**
   * §22.23 «Скачивание выполняется отдельной серверной операцией», при которой
   * repository ПОВТОРНО проверяет пользователя, право, состояние артефакта,
   * срок хранения и masking policy.
   *
   * Отдаётся ПОТОК (содержимое), а не ссылка: постоянной ссылки не существует
   * вовсе, поэтому ей неоткуда утечь в HTML, list endpoint, Tooltip,
   * `aria-label`, telemetry, localStorage или URL страницы.
   */
  async function downloadArtifact(
    artifactId: string,
    actorUserId: string | null,
  ): Promise<DownloadArtifactResponse> {
    if (!hasPermission(actorUserId, GENERATE_PERMISSION)) {
      throw new RepositoryPermissionError(GENERATE_PERMISSION)
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope.slices)
    const artifact = slice?.artifacts.find((entry) => entry.artifactId === artifactId)
    if (artifact === undefined || slice === null) {
      throw new RepositoryNotFoundError(artifactId)
    }
    // Право на sensitive проверяется СНОВА, на скачивании: право могли отозвать
    // после генерации, а артефакт остался.
    if (artifact.sensitive && !hasPermission(actorUserId, SENSITIVE_PERMISSION)) {
      throw new RepositoryPermissionError(SENSITIVE_PERMISSION)
    }
    if (!isArtifactAvailable(artifact, clock.now())) {
      throw new RepositoryBusinessRuleError(
        'ARTIFACT_EXPIRED',
        'Срок хранения артефакта истёк.',
      )
    }
    return {
      fileName: `${artifact.reportTypeCode.toLowerCase()}-${artifact.parameterSnapshot.from}_${artifact.parameterSnapshot.to}.csv`,
      content: artifact.content,
    }
  }

  return { listReportTypes, listReportJobs, createReportJob, downloadArtifact }
}
