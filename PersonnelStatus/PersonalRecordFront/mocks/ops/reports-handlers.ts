// Мок-слой отчётного реестра службы (§22.18-22.25, §20.32): асинхронная
// генерация (§22.21), immutable-артефакт (§22.22), скачивание с повторной
// проверкой (§22.23), server-side masking (§22.24). Источник строк — стор
// плана дежурств; пределы периода и срок хранения — раздел REPORT_LIMITS
// общего стора «Настроек»: правка там меняет исход запуска здесь.
//
// Демо-персона хоста — demo-admin с wildcard: право на запуск, sensitive
// export и параметры чужого запуска есть. Контракты вырезания (parameters:
// null + parametersRedactedReason) сохранены — форма ответа не упрощена.
import { http, HttpResponse } from "msw";
import {
  ASSEMBLY_FAILURE,
  REPORT_ARTIFACT_DOWNLOAD_PATH_PATTERN,
  REPORT_CALCULATION_VERSION,
  MASKED_FIELDS,
  MASKING_POLICY_VERSION,
  REPORT_JOBS_PATH,
  REPORT_JOB_DETAIL_PATH_PATTERN,
  REPORT_JOB_NEW_REVISION_PATH_PATTERN,
  REPORT_JOB_RETRY_PATH_PATTERN,
  REPORT_TYPES_PATH,
  UNAVAILABLE_ARTIFACT_FIELDS,
  UNAVAILABLE_FORMATS,
  UNAVAILABLE_HISTORY_COLUMNS,
  UNAVAILABLE_JOB_CARD_BLOCKS,
  artifactSeriesKey,
  buildJobActions,
  buildReportContent,
  contentHash,
  contentSize,
  findReusableArtifact,
  isArtifactAvailable,
  nextRevision,
  reportPeriodDays,
  selectRows,
} from "@/entities/service-report";
import type {
  CreateReportJobRequest,
  ListReportJobsResponse,
  ReportArtifact,
  ReportArtifactSummary,
  ReportFormat,
  ReportJob,
  ReportJobDetailResponse,
  ReportJobState,
  ReportJobView,
  ReportSourceRow,
  RerunReportJobResponse,
} from "@/entities/service-report";
import { readReportLimits } from "./settings-store";
import { readDutyShiftsStore } from "./duties-handlers";

const STORE_KEY = "ops-mock-service-reports";

/** Актор мок-стенда — та же учётка, что в настройках и рейтинге. */
const ACTOR = "demo-admin";

/** Ступень генерации: PENDING → PROCESSING(50%) → COMPLETED/FAILED. */
const PROGRESS_STEP = 50;

interface StoredReportType {
  reportTypeCode: string;
  safeTitle: string;
  description: string;
  formats: ReportFormat[];
}

interface ReportsState {
  jobs: ReportJob[];
  artifacts: ReportArtifact[];
  reportTypes: StoredReportType[];
  seq: number;
}

/** §22.19: один тип — тот, под который есть РЕАЛЬНЫЕ данные (смены дежурств).
 * Второй выдуманный тип был бы пустой строкой в реестре. */
const REPORT_TYPES: readonly StoredReportType[] = [
  {
    reportTypeCode: "PERSONNEL_EXPENSE",
    safeTitle: "Расход личного состава",
    description:
      "Смены дежурств за период: дата, сотрудник, объект, пост из снимка паспорта, состояние.",
    formats: ["CSV"],
  },
];

function buildSeed(): ReportsState {
  // Ни работ, ни артефактов: отчёт — действие человека, и «уже сформирован»
  // из сида читался бы как чья-то реальная выгрузка, которой не было.
  return {
    jobs: [],
    artifacts: [],
    reportTypes: REPORT_TYPES.map((type) => ({ ...type })),
    seq: 0,
  };
}

let state: ReportsState | null = null;

function getState(): ReportsState {
  if (state === null) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      state = raw === null ? buildSeed() : (JSON.parse(raw) as ReportsState);
    } catch {
      state = buildSeed();
    }
  }
  return state;
}

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // квота/приватный режим
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(prefix: string): string {
  const s = getState();
  s.seq += 1;
  return `${prefix}-${s.seq}-${Date.now()}`;
}

function errorEnvelope(errorCode: string, message: string, status: number) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details: {},
      request_id: null,
      timestamp: nowIso(),
    },
    { status }
  );
}

function notFound(entityId: string) {
  return errorEnvelope("ENTITY_NOT_FOUND", "Запись не найдена.", 404);
}

const NO_PERIOD_LIMIT_REASON =
  "Предел периода для этого типа отчёта не задан политикой — отчёт не формируется. Задайте его в разделе «Настройки» → «Пределы отчётности».";
const NO_RETENTION_REASON =
  "Срок хранения файлов не задан политикой — отчёт не формируется: у файла не было бы срока доступности.";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Строки источника — узкая проекция стора дежурств. Пост — из СНИМКА
 * привязки паспорта: отчёт показывает зафиксированное при планировании. */
function readSourceRows(): ReportSourceRow[] {
  return readDutyShiftsStore().map((shift) => {
    const binding = shift.passportBinding;
    const sector = binding === null ? "" : binding.sectorName;
    const post = binding === null ? "" : binding.postName;
    return {
      businessDate: shift.businessDate,
      employeeName: shift.employeeName,
      objectLabel: shift.target.safeLabel,
      postLabel: sector === "" && post === "" ? null : `${sector} · ${post}`,
      stateCode: shift.stateCode,
      note: shift.note,
      overrideReason: shift.overrideReason,
    };
  });
}

/** Работа в ответе сервера. Демо-персона видит параметры всех запусков
 * (wildcard-право §22.26) — контракт вырезания сохранён формой полей. */
function projectJob(job: ReportJob): ReportJobView {
  return {
    ...job,
    parameters: job.parameters,
    idempotencyKey: job.idempotencyKey,
    parametersRedactedReason: null,
  };
}

function summarize(artifact: ReportArtifact, now: string): ReportArtifactSummary {
  const available = isArtifactAvailable(artifact, now);
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
    unavailableReason: available ? null : "EXPIRED",
  };
}

/**
 * §22.21: продвижение работы на ЧТЕНИИ (фонового исполнителя в demo нет).
 * Артефакт формируется РОВНО на переходе в COMPLETED и больше не меняется
 * (§22.22 immutable). Срок хранения берётся ДЕЙСТВУЮЩИЙ на момент сборки и
 * замораживается в артефакте.
 */
function advance(
  s: ReportsState,
  job: ReportJob,
  existingArtifacts: readonly ReportArtifact[]
): { job: ReportJob; artifact: ReportArtifact | null } {
  if (job.state === "COMPLETED" || job.state === "FAILED") {
    return { job, artifact: null };
  }
  if (job.state === "PENDING") {
    return {
      job: { ...job, state: "PROCESSING", progressPercent: PROGRESS_STEP },
      artifact: null,
    };
  }

  const retention = readReportLimits();
  if (retention.retentionDays === null || retention.policyVersion === null) {
    // Сбой политики — тоже СОСТОЯНИЕ работы: без срока файл был бы вечным.
    return {
      job: {
        ...job,
        state: "FAILED",
        progressPercent: null,
        completedAt: nowIso(),
        failureCode: "RETENTION_UNAVAILABLE",
        safeFailureMessage: NO_RETENTION_REASON,
      },
      artifact: null,
    };
  }

  let content: string;
  try {
    const rows = selectRows(readSourceRows(), job.parameters);
    content = buildReportContent(rows, job.parameters, job.sensitive);
  } catch {
    // §22.21: сбой сборки — состояние работы, а не исключение наружу; текст
    // исключения клиенту не едет (§22.22 safeFailureMessage).
    return {
      job: {
        ...job,
        state: "FAILED",
        progressPercent: null,
        completedAt: nowIso(),
        failureCode: ASSEMBLY_FAILURE.code,
        safeFailureMessage: ASSEMBLY_FAILURE.message,
      },
      artifact: null,
    };
  }
  const generatedAt = nowIso();
  const expiresAt = new Date(
    Date.parse(generatedAt) + retention.retentionDays * 86_400_000
  ).toISOString();
  const artifact: ReportArtifact = {
    artifactId: `artifact-${job.reportJobId}`,
    reportJobId: job.reportJobId,
    reportTypeCode: job.reportTypeCode,
    safeTitle:
      s.reportTypes.find((type) => type.reportTypeCode === job.reportTypeCode)
        ?.safeTitle ?? job.reportTypeCode,
    format: job.format,
    // §22.25: редакция считается по СЕРИИ (тип + период + режим), а не по
    // работе — «Новая revision» обязана давать 2 там, где уже есть 1.
    revision: nextRevision(
      existingArtifacts,
      artifactSeriesKey({
        reportTypeCode: job.reportTypeCode,
        parameters: job.parameters,
        sensitive: job.sensitive,
      })
    ),
    generatedAt,
    generatedBy: job.createdBy.userId,
    parameterSnapshot: job.parameters,
    calculationVersion: REPORT_CALCULATION_VERSION,
    maskingPolicyVersion: MASKING_POLICY_VERSION,
    retentionPolicyVersion: retention.policyVersion,
    sensitive: job.sensitive,
    fileSize: contentSize(content),
    hash: contentHash(content),
    expiresAt,
    content,
  };
  return {
    job: {
      ...job,
      state: "COMPLETED",
      progressPercent: 100,
      completedAt: generatedAt,
      artifactId: artifact.artifactId,
    },
    artifact,
  };
}

/** Продвинуть ВСЕ работы (в т.ч. скрытые фильтром — иначе они застревали бы
 * навсегда) и сохранить состояние. */
function advanceAll(s: ReportsState): void {
  const artifacts = [...s.artifacts];
  const jobs = s.jobs.map((job) => {
    const stepped = advance(s, job, artifacts);
    if (stepped.artifact !== null) artifacts.push(stepped.artifact);
    return stepped.job;
  });
  s.jobs = jobs;
  s.artifacts = artifacts;
  persist();
}

// ── Handlers ─────────────────────────────────────────────────────────────

export const reportsHandlers = [
  // §22.19 каталог типов: предел приезжает к типу из ПОЛИТИКИ на чтении.
  http.get(`*${REPORT_TYPES_PATH}`, () => {
    const s = getState();
    const limits = readReportLimits();
    return HttpResponse.json({
      results: s.reportTypes.map((type) => {
        const maxPeriodDays =
          limits.maxPeriodDaysByType.get(type.reportTypeCode) ?? null;
        return {
          ...type,
          maxPeriodDays,
          unavailableReason:
            maxPeriodDays === null
              ? NO_PERIOD_LIMIT_REASON
              : limits.retentionDays === null
                ? NO_RETENTION_REASON
                : null,
        };
      }),
      retentionPolicy: {
        retentionDays: limits.retentionDays,
        policyVersion: limits.policyVersion,
      },
      maskedFields: MASKED_FIELDS.map((field) => ({ ...field })),
      unavailableFormats: UNAVAILABLE_FORMATS.map((field) => ({ ...field })),
      unavailableArtifactFields: UNAVAILABLE_ARTIFACT_FIELDS.map((field) => ({
        ...field,
      })),
      // Демо-персона wildcard: право на sensitive export есть. Решает сервер.
      canExportSensitive: true,
    });
  }),

  // §22.24/§22.25 реестр работ: безопасная проекция, фильтры применяет сервер.
  http.get(`*${REPORT_JOBS_PATH}`, ({ request }) => {
    const s = getState();
    advanceAll(s);
    const params = new URL(request.url).searchParams;
    const stateFilter = params.get("state");
    const mine = params.get("mine") === "true";
    const now = nowIso();

    const visible = s.jobs;
    const matched = visible.filter((job) => {
      if (
        stateFilter !== null &&
        stateFilter !== "" &&
        job.state !== (stateFilter as ReportJobState)
      )
        return false;
      if (mine && job.createdBy.userId !== ACTOR) return false;
      return true;
    });
    const matchedIds = new Set(matched.map((job) => job.reportJobId));
    const summaries = s.artifacts
      .filter((artifact) => matchedIds.has(artifact.reportJobId))
      .map((artifact) => summarize(artifact, now));
    const byJob = new Map(summaries.map((summary) => [summary.reportJobId, summary]));

    const response: ListReportJobsResponse = {
      results: [...matched]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(projectJob),
      artifacts: summaries,
      // §22.25: действия считает сервер — экран их не выводит из состояния.
      actions: matched.map((job) => ({
        reportJobId: job.reportJobId,
        actions: buildJobActions({
          job,
          artifact: byJob.get(job.reportJobId) ?? null,
          parametersVisible: true,
        }),
      })),
      unavailableColumns: UNAVAILABLE_HISTORY_COLUMNS.map((column) => ({
        ...column,
      })),
      totalVisible: visible.length,
      serverTime: now,
    };
    return HttpResponse.json(response);
  }),

  // §22.21 создание работы. Порядок проверок: параметры → политика (заново,
  // на мутации) → идемпотентность.
  http.post(`*${REPORT_JOBS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as CreateReportJobRequest;
    const s = getState();
    if (!DATE_RE.test(body.from) || !DATE_RE.test(body.to)) {
      return errorEnvelope("INVALID_PERIOD", "Укажите период в формате ГГГГ-ММ-ДД.", 422);
    }
    if (body.from > body.to) {
      return errorEnvelope("INVALID_PERIOD", "Начало периода позже его конца.", 422);
    }
    if (body.idempotencyKey.trim() === "") {
      return errorEnvelope(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Запуск отчёта требует ключа идемпотентности.",
        422
      );
    }
    const reportType = s.reportTypes.find(
      (type) => type.reportTypeCode === body.reportTypeCode
    );
    if (reportType === undefined) {
      return errorEnvelope("UNKNOWN_REPORT_TYPE", "Неизвестный тип отчёта.", 422);
    }
    if (!reportType.formats.includes(body.format)) {
      return errorEnvelope(
        "UNSUPPORTED_FORMAT",
        "Этот формат для отчёта не формируется.",
        422
      );
    }
    const parameters = { from: body.from, to: body.to };
    // Предел читается ЗАНОВО на мутации: между открытием формы и запуском
    // политику могли изменить, и решать обязано действующее значение.
    const limits = readReportLimits();
    const maxPeriodDays =
      limits.maxPeriodDaysByType.get(reportType.reportTypeCode) ?? null;
    if (maxPeriodDays === null) {
      return errorEnvelope("PERIOD_LIMIT_UNAVAILABLE", NO_PERIOD_LIMIT_REASON, 422);
    }
    if (limits.retentionDays === null) {
      return errorEnvelope("RETENTION_UNAVAILABLE", NO_RETENTION_REASON, 422);
    }
    if (reportPeriodDays(parameters) > maxPeriodDays) {
      return errorEnvelope(
        "PERIOD_TOO_LONG",
        `Период отчёта не может превышать ${maxPeriodDays} дней.`,
        422
      );
    }

    // §22.21 идемпотентность: тот же ключ возвращает ТУ ЖЕ работу.
    const existing = s.jobs.find((job) => job.idempotencyKey === body.idempotencyKey);
    if (existing !== undefined) {
      return HttpResponse.json(existing);
    }

    const created: ReportJob = {
      reportJobId: nextId("report-job"),
      reportTypeCode: body.reportTypeCode,
      format: body.format,
      // §22.21: работа создаётся В ОЖИДАНИИ, а не готовой.
      state: "PENDING",
      progressPercent: null,
      createdAt: nowIso(),
      createdBy: { userId: ACTOR, safeLabel: ACTOR },
      completedAt: null,
      failureCode: null,
      safeFailureMessage: null,
      artifactId: null,
      idempotencyKey: body.idempotencyKey,
      sensitive: body.sensitive,
      parameters,
    };
    s.jobs = [...s.jobs, created];
    persist();
    return HttpResponse.json(created);
  }),

  // §22.25 «Повторить с теми же параметрами»: возвращает готовый пригодный
  // артефакт, если он есть, — человек просил файл, а не работу сервера.
  http.post(`*${REPORT_JOB_RETRY_PATH_PATTERN}`, ({ params }) => {
    return rerun(decodeURIComponent(params.reportJobId as string), "RETRY");
  }),

  // §22.25 «Сформировать новую revision»: собирает заново ВСЕГДА.
  http.post(`*${REPORT_JOB_NEW_REVISION_PATH_PATTERN}`, ({ params }) => {
    return rerun(decodeURIComponent(params.reportJobId as string), "NEW_REVISION");
  }),

  // §22.27 карточка работы + §22.28 состояние job и метаданные artifact одним
  // согласованным срезом. Работа продвигается на чтении — прямая ссылка на
  // PENDING-работу доводит её до конца сама.
  http.get(`*${REPORT_JOB_DETAIL_PATH_PATTERN}`, ({ params }) => {
    const reportJobId = decodeURIComponent(params.reportJobId as string);
    const s = getState();
    const stored = s.jobs.find((job) => job.reportJobId === reportJobId);
    if (stored === undefined) return notFound(reportJobId);

    const artifacts = [...s.artifacts];
    const stepped = advance(s, stored, artifacts);
    if (stepped.artifact !== null) artifacts.push(stepped.artifact);
    const job = stepped.job;
    s.jobs = s.jobs.map((entry) => (entry.reportJobId === job.reportJobId ? job : entry));
    s.artifacts = artifacts;
    persist();

    const now = nowIso();
    const artifact =
      artifacts.find((entry) => entry.reportJobId === job.reportJobId) ?? null;

    const response: ReportJobDetailResponse = {
      job: projectJob(job),
      artifact: artifact === null ? null : summarize(artifact, now),
      actions: buildJobActions({
        job,
        artifact:
          artifact === null ? null : { available: isArtifactAvailable(artifact, now) },
        parametersVisible: true,
      }),
      reportTypeTitle:
        s.reportTypes.find((type) => type.reportTypeCode === job.reportTypeCode)
          ?.safeTitle ?? job.reportTypeCode,
      isOwn: job.createdBy.userId === ACTOR,
      unavailableBlocks: UNAVAILABLE_JOB_CARD_BLOCKS.map((block) => ({ ...block })),
      unavailableArtifactFields: UNAVAILABLE_ARTIFACT_FIELDS.map((field) => ({
        ...field,
      })),
      serverTime: now,
    };
    return HttpResponse.json(response);
  }),

  // §22.23: скачивание — ОТДЕЛЬНАЯ операция, повторно проверяющая состояние и
  // срок. Отдаётся ПОТОК, а не ссылка: постоянной ссылки не существует вовсе.
  http.post(`*${REPORT_ARTIFACT_DOWNLOAD_PATH_PATTERN}`, ({ params }) => {
    const artifactId = decodeURIComponent(params.artifactId as string);
    const s = getState();
    const artifact = s.artifacts.find((entry) => entry.artifactId === artifactId);
    if (artifact === undefined) return notFound(artifactId);
    if (!isArtifactAvailable(artifact, nowIso())) {
      return errorEnvelope("ARTIFACT_EXPIRED", "Срок хранения артефакта истёк.", 422);
    }
    return HttpResponse.json({
      fileName: `${artifact.reportTypeCode.toLowerCase()}-${artifact.parameterSnapshot.from}_${artifact.parameterSnapshot.to}.csv`,
      content: artifact.content,
    });
  }),
];

/** Общий обработчик повтора (§22.25). */
function rerun(reportJobId: string, mode: "RETRY" | "NEW_REVISION") {
  const s = getState();
  const source = s.jobs.find((job) => job.reportJobId === reportJobId);
  if (source === undefined) return notFound(reportJobId);
  if (mode === "NEW_REVISION" && source.state !== "COMPLETED") {
    return errorEnvelope(
      "NO_BASE_REVISION",
      "Новая редакция бывает у собранного отчёта: эта работа ещё не завершилась успехом.",
      422
    );
  }
  if (mode === "RETRY" && source.state !== "COMPLETED" && source.state !== "FAILED") {
    return errorEnvelope(
      "JOB_NOT_FINISHED",
      "Работа ещё выполняется — дождитесь её завершения.",
      422
    );
  }

  const seriesKey = artifactSeriesKey({
    reportTypeCode: source.reportTypeCode,
    parameters: source.parameters,
    sensitive: source.sensitive,
  });
  if (mode === "RETRY") {
    const reusable = findReusableArtifact(s.artifacts, seriesKey, nowIso());
    if (reusable !== null) {
      const result: RerunReportJobResponse = {
        reused: true,
        reportJobId: reusable.reportJobId,
        artifactId: reusable.artifactId,
      };
      return HttpResponse.json(result);
    }
  }

  const created: ReportJob = {
    reportJobId: nextId("report-job"),
    reportTypeCode: source.reportTypeCode,
    format: source.format,
    state: "PENDING",
    progressPercent: null,
    createdAt: nowIso(),
    // Автор новой работы — тот, кто её запустил: «сформировал» в истории
    // обязано отвечать, кто выгружал на самом деле.
    createdBy: { userId: ACTOR, safeLabel: ACTOR },
    completedAt: null,
    failureCode: null,
    safeFailureMessage: null,
    artifactId: null,
    // §22.25 «новый job с новым idempotencyKey»: ключ исходной вернул бы её
    // саму вместо повтора.
    idempotencyKey: `${mode === "RETRY" ? "retry" : "revision"}:${reportJobId}:${nextId("k")}`,
    sensitive: source.sensitive,
    parameters: { ...source.parameters },
  };
  s.jobs = [...s.jobs, created];
  persist();
  const result: RerunReportJobResponse = {
    reused: false,
    reportJobId: created.reportJobId,
    artifactId: null,
  };
  return HttpResponse.json(result);
}
