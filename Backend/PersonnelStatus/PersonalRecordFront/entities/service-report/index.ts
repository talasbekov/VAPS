// Отчётный реестр службы (§22.18-22.25, §20.32) — нативный порт из Smart
// Josparlau. Асинхронная генерация: параметры → проверка права и политики →
// ReportJob → immutable artifact → скачивание с ПОВТОРНОЙ проверкой.
//
// ⚠️ Выборка строк, маскирование и сборка файла живут на стороне мок-сервера
// (mocks/ops/reports-handlers.ts): §22.24 прямо запрещает формировать
// чувствительный экспорт из уже загруженного в браузер массива.

// ── Модель ───────────────────────────────────────────────────────────────

/** §22.21: состояния СЕРВЕРНЫЕ. Фонового исполнителя в demo нет — ступень
 * генерации продвигает сервер при чтении работы; упрощён ИСПОЛНИТЕЛЬ, а не
 * модель состояний. */
export type ReportJobState = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface ReportJob {
  reportJobId: string;
  reportTypeCode: string;
  format: ReportFormat;
  state: ReportJobState;
  /** null до старта обработки: доля выполненного у не начатой работы —
   * выдумка, а не ноль. */
  progressPercent: number | null;
  createdAt: string;
  createdBy: { userId: string; safeLabel: string };
  completedAt: string | null;
  failureCode: string | null;
  safeFailureMessage: string | null;
  /** §22.21 «Success показывай только после COMPLETED и получения artifactId». */
  artifactId: string | null;
  /** §22.21: повтор с тем же ключом не создаёт вторую работу. */
  idempotencyKey: string;
  /** §20.32/§22.24: обычный экспорт и sensitive export — РАЗНЫЕ операции. */
  sensitive: boolean;
  parameters: ReportParameters;
}

/** Форматы, которые проект реально формирует: PDF/XLSX/DOCX без реализации
 * показывать запрещено (§22.23) — причина отдаётся клиенту. */
export type ReportFormat = "CSV";

export interface ReportParameters {
  /** Границы периода включительно, YYYY-MM-DD. */
  from: string;
  to: string;
}

export interface ReportArtifact {
  artifactId: string;
  reportJobId: string;
  reportTypeCode: string;
  safeTitle: string;
  format: ReportFormat;
  revision: number;
  generatedAt: string;
  generatedBy: string;
  parameterSnapshot: ReportParameters;
  /** §22.22: версии хранятся в СНИМКЕ — политика могла измениться после
   * генерации, и артефакт обязан помнить свою. */
  calculationVersion: string;
  maskingPolicyVersion: string;
  retentionPolicyVersion: string;
  /** §22.24: включены ли поля, которые обычный экспорт исключает. */
  sensitive: boolean;
  fileSize: number;
  /** Детерминированная контрольная сумма — НЕ криптографический хеш. */
  hash: string;
  /** §22.22 «Срок доступности бери из expiresAt» — срок считает сервер. */
  expiresAt: string;
  /** Содержимое живёт на «сервере» и НЕ едет в списках (§22.24). */
  content: string;
}

export type ArtifactUnavailableReason = "EXPIRED" | "NOT_READY" | "FAILED";

/** §22.25: действия строки считает СЕРВЕР — по состоянию, артефакту, сроку и
 * правам; в компоненте нет ни одной ветки «если упала — выключить кнопку». */
export type ReportJobActionCode =
  | "OPEN_PARAMETERS"
  | "DOWNLOAD"
  | "RETRY"
  | "NEW_REVISION"
  | "VIEW_ERROR";

export interface ReportJobAction {
  code: ReportJobActionCode;
  available: boolean;
  /** null, пока действие доступно: причина нужна ровно там, где отказ. */
  reason: string | null;
}

export interface ReportJobActions {
  reportJobId: string;
  actions: ReportJobAction[];
}

/** Определение отчёта (§22.19). Предел периода приходит из ПОЛИТИКИ
 * «Настроек», а не лежит в определении типа. null — политика молчит, и отчёт
 * не формируется вовсе. */
export interface ReportTypeDefinition {
  reportTypeCode: string;
  safeTitle: string;
  description: string;
  formats: ReportFormat[];
  maxPeriodDays: number | null;
  unavailableReason: string | null;
}

/** Политика хранения (§22.22): владелец — «Настройки». retentionDays null —
 * политика молчит, файл не собирается: артефакт без expiresAt жил бы вечно. */
export interface ReportRetentionPolicy {
  retentionDays: number | null;
  policyVersion: string | null;
}

// ── Пути API (pending-контракт). НЕ /api/ops/reports/: /reports в портале —
// донорский экран «Расход дня». ──────────────────────────────────────────

export const REPORT_TYPES_PATH = "/api/ops/service-report-types/";
export const REPORT_JOBS_PATH = "/api/ops/service-report-jobs/";

export function reportJobPath(id: string): string {
  return `${REPORT_JOBS_PATH}${encodeURIComponent(id)}/`;
}
export function reportArtifactDownloadPath(id: string): string {
  return `/api/ops/service-report-artifacts/${encodeURIComponent(id)}/download/`;
}
export type RerunMode = "RETRY" | "NEW_REVISION";
/** §22.25: параметры повтора берёт СЕРВЕР из исходной работы. */
export function reportJobRerunPath(id: string, mode: RerunMode): string {
  return `${REPORT_JOBS_PATH}${encodeURIComponent(id)}/${mode === "RETRY" ? "retry" : "new-revision"}/`;
}
// Шаблоны для MSW — литералами: фабрика энкодит ":" в %3A.
export const REPORT_JOB_DETAIL_PATH_PATTERN =
  "/api/ops/service-report-jobs/:reportJobId/detail/";
export function reportJobDetailPath(id: string): string {
  return `${REPORT_JOBS_PATH}${encodeURIComponent(id)}/detail/`;
}
export const REPORT_JOB_RETRY_PATH_PATTERN =
  "/api/ops/service-report-jobs/:reportJobId/retry/";
export const REPORT_JOB_NEW_REVISION_PATH_PATTERN =
  "/api/ops/service-report-jobs/:reportJobId/new-revision/";
export const REPORT_ARTIFACT_DOWNLOAD_PATH_PATTERN =
  "/api/ops/service-report-artifacts/:artifactId/download/";

// ── Контракты ответов ────────────────────────────────────────────────────

export interface MaskedField {
  code: string;
  label: string;
  reason: string;
}

export interface ListReportTypesResponse {
  results: ReportTypeDefinition[];
  retentionPolicy: ReportRetentionPolicy;
  /** §22.24: какие поля исключает обычный экспорт и почему. */
  maskedFields: MaskedField[];
  /** §22.23: форматы, которых проект не формирует, с причиной. */
  unavailableFormats: MaskedField[];
  unavailableArtifactFields: MaskedField[];
  /** §20.32: есть ли право на sensitive export. Считает сервер. */
  canExportSensitive: boolean;
}

/** Работа в ответе сервера: параметры чужого запуска ВЫРЕЗАНЫ на сервере, а
 * не скрыты вёрсткой (§22.26/§22.27). Ключ идемпотентности производен от
 * параметров и вырезается вместе с ними. */
export interface ReportJobView
  extends Omit<ReportJob, "parameters" | "idempotencyKey"> {
  parameters: ReportParameters | null;
  idempotencyKey: string | null;
  parametersRedactedReason: string | null;
}

export interface ReportArtifactSummary {
  artifactId: string;
  reportJobId: string;
  safeTitle: string;
  format: ReportFormat;
  revision: number;
  generatedAt: string;
  generatedBy: string;
  parameterSnapshot: ReportParameters | null;
  calculationVersion: string;
  maskingPolicyVersion: string;
  sensitive: boolean;
  fileSize: number;
  hash: string;
  expiresAt: string;
  available: boolean;
  unavailableReason: ArtifactUnavailableReason | null;
}

/** §22.25 фильтры истории — применяет СЕРВЕР. */
export interface ListReportJobsFilters {
  state?: ReportJobState;
  mine?: boolean;
}

export interface ListReportJobsResponse {
  results: ReportJobView[];
  artifacts: ReportArtifactSummary[];
  actions: ReportJobActions[];
  unavailableColumns: MaskedField[];
  /** «Ничего не нашлось» и «отчётов ещё не запускали» — разные сообщения. */
  totalVisible: number;
  /** Время сервера: экран не пересчитывает срок своими часами. */
  serverTime: string;
}

export type CreateReportJobRequest = {
  reportTypeCode: string;
  format: ReportFormat;
  from: string;
  to: string;
  sensitive: boolean;
  idempotencyKey: string;
};

export type CreateReportJobResponse = ReportJob;

/** reused: true — новой работы НЕ создавали, отдан прежний пригодный артефакт. */
export type RerunReportJobResponse = {
  reused: boolean;
  reportJobId: string;
  artifactId: string | null;
};

/** §22.27 карточка + §22.28 состояние job и метаданные artifact — одним
 * согласованным срезом. */
export interface ReportJobDetailResponse {
  job: ReportJobView;
  artifact: ReportArtifactSummary | null;
  actions: ReportJobAction[];
  reportTypeTitle: string;
  /** §22.26: «свой» решает сервер, экран не сравнивает пользователей сам. */
  isOwn: boolean;
  unavailableBlocks: MaskedField[];
  unavailableArtifactFields: MaskedField[];
  serverTime: string;
}

export type DownloadArtifactResponse = { fileName: string; content: string };

// ── Формирование отчёта и masking policy (серверная сторона мока) ────────

/** Строка источника «Расход личного состава» — узкая проекция стора дежурств. */
export interface ReportSourceRow {
  businessDate: string;
  employeeName: string;
  objectLabel: string;
  postLabel: string | null;
  stateCode: string;
  /** §22.24 «персональные комментарии» — исключается обычным экспортом. */
  note: string | null;
  /** §22.24 «скрытые ограничения» — обоснование обхода конфликта. */
  overrideReason: string | null;
}

export const MASKED_FIELDS: readonly MaskedField[] = [
  {
    code: "NOTE",
    label: "Примечание к дежурству",
    reason:
      "§22.24 «персональные комментарии»: свободный текст пишется для внутренней работы и может содержать сведения о человеке, которых отчёт не требует.",
  },
  {
    code: "OVERRIDE_REASON",
    label: "Обоснование обхода конфликта",
    reason:
      "§22.24 «скрытые ограничения»: обоснование обхода обязательного отдыха — внутреннее решение, а не факт несения службы.",
  },
];

/** Версия политики маскирования — меняется вместе с составом MASKED_FIELDS. */
export const MASKING_POLICY_VERSION = "masking-2026.07.1";
/** Версия расчёта — методика выборки строк. */
export const REPORT_CALCULATION_VERSION = "expense-2026.07.1";

const BASE_COLUMNS = ["Дата", "Сотрудник", "Объект", "Пост", "Состояние"] as const;
const SENSITIVE_COLUMNS = ["Примечание", "Обоснование обхода"] as const;

export function csvField(value: string): string {
  if (!/[";\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * §22.20 «Расход личного состава». Обычный экспорт не имеет колонок с
 * исключёнными полями ВООБЩЕ — не пустые ячейки, а отсутствующие колонки:
 * иначе отчёт сообщал бы «у этих смен примечаний не было».
 */
export function buildReportContent(
  rows: readonly ReportSourceRow[],
  parameters: ReportParameters,
  sensitive: boolean
): string {
  const header = sensitive
    ? [...BASE_COLUMNS, ...SENSITIVE_COLUMNS]
    : [...BASE_COLUMNS];
  const lines = [
    `# Расход личного состава за период ${parameters.from} — ${parameters.to}`,
    header.map(csvField).join(";"),
  ];
  for (const row of rows) {
    const base = [
      row.businessDate,
      row.employeeName,
      row.objectLabel,
      row.postLabel ?? "",
      row.stateCode,
    ];
    const values = sensitive
      ? [...base, row.note ?? "", row.overrideReason ?? ""]
      : base;
    lines.push(values.map(csvField).join(";"));
  }
  return `${lines.join("\n")}\n`;
}

/** Отбор строк периода — границы ВКЛЮЧИТЕЛЬНЫЕ. */
export function selectRows(
  rows: readonly ReportSourceRow[],
  parameters: ReportParameters
): ReportSourceRow[] {
  return rows
    .filter(
      (row) =>
        row.businessDate >= parameters.from && row.businessDate <= parameters.to
    )
    .sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) ||
        a.employeeName.localeCompare(b.employeeName)
    );
}

/** Детерминированная контрольная сумма (FNV-1a, 32 бита). */
export function contentHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Размер в байтах: кириллица в UTF-8 занимает два байта. */
export function contentSize(content: string): number {
  return new TextEncoder().encode(content).length;
}

export function reportPeriodDays(parameters: ReportParameters): number {
  const toUtc = (date: string) =>
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10))
    );
  // Включительные границы: «с 1-го по 1-е» — один день.
  return Math.round((toUtc(parameters.to) - toUtc(parameters.from)) / 86_400_000) + 1;
}

/** §22.22: артефакт доступен, пока не истёк срок хранения. */
export function isArtifactAvailable(
  artifact: Pick<ReportArtifact, "expiresAt">,
  nowIso: string
): boolean {
  return Date.parse(nowIso) < Date.parse(artifact.expiresAt);
}

/** §22.25: серия — отчёт одного типа за один период в одном режиме. Режим
 * входит в ключ: обычная и чувствительная выгрузки — разные документы. */
export function artifactSeriesKey(input: {
  reportTypeCode: string;
  parameters: ReportParameters;
  sensitive: boolean;
}): string {
  const mode = input.sensitive ? "S" : "N";
  return `${input.reportTypeCode}|${input.parameters.from}|${input.parameters.to}|${mode}`;
}

/** Номер следующей редакции — по МАКСИМУМУ существующих, не по количеству:
 * артефакт может исчезнуть по сроку, и счёт по длине дал бы второй №1. */
export function nextRevision(
  artifacts: readonly ReportArtifact[],
  seriesKey: string
): number {
  const revisions = artifacts
    .filter(
      (artifact) =>
        artifactSeriesKey({
          reportTypeCode: artifact.reportTypeCode,
          parameters: artifact.parameterSnapshot,
          sensitive: artifact.sensitive,
        }) === seriesKey
    )
    .map((artifact) => artifact.revision);
  return revisions.length === 0 ? 1 : Math.max(...revisions) + 1;
}

/** §22.25: «Повторить» возвращает существующий пригодный артефакт той же
 * серии — последнюю редакцию. */
export function findReusableArtifact(
  artifacts: readonly ReportArtifact[],
  seriesKey: string,
  nowIso: string
): ReportArtifact | null {
  const suitable = artifacts.filter(
    (artifact) =>
      artifactSeriesKey({
        reportTypeCode: artifact.reportTypeCode,
        parameters: artifact.parameterSnapshot,
        sensitive: artifact.sensitive,
      }) === seriesKey && isArtifactAvailable(artifact, nowIso)
  );
  if (suitable.length === 0) return null;
  return suitable.reduce((best, artifact) =>
    artifact.revision > best.revision ? artifact : best
  );
}

/** §22.21: сбой сборки — состояние работы с БЕЗОПАСНЫМ сообщением. */
export const ASSEMBLY_FAILURE = {
  code: "ASSEMBLY_FAILED",
  message:
    "Не удалось собрать отчёт: источник данных недоступен. Запустите отчёт повторно; если ошибка повторится, обратитесь к администратору.",
} as const;

/** §22.26 «просмотр параметров чужого отчёта» — отдельное право. */
export const FOREIGN_PARAMETERS_REASON =
  "Это чужой запуск: просмотр параметров чужого отчёта — отдельное право (§22.26), и его у вас нет.";

export const FOREIGN_DOWNLOAD_REASON =
  "Файл называет свой период в первой строке: скрыть параметры на экране и отдать их файлом значило бы скрыть только на вид.";

/** §22.25 политика действий строки — целиком серверная. */
export function buildJobActions(input: {
  job: Pick<ReportJob, "state" | "artifactId">;
  artifact: { available: boolean } | null;
  parametersVisible: boolean;
}): ReportJobAction[] {
  const { job, artifact, parametersVisible } = input;
  const terminal = job.state === "COMPLETED" || job.state === "FAILED";
  const running = "Работа ещё выполняется — дождитесь её завершения.";

  const download: ReportJobAction = !parametersVisible
    ? // Первым: «срок истёк» тому, кому нельзя видеть выгрузку, — подмена
      // причины отказа.
      { code: "DOWNLOAD", available: false, reason: FOREIGN_DOWNLOAD_REASON }
    : job.state === "FAILED"
      ? {
          code: "DOWNLOAD",
          available: false,
          reason: "Работа завершилась ошибкой — файла нет.",
        }
      : artifact === null
        ? {
            code: "DOWNLOAD",
            available: false,
            reason: "Артефакт ещё не сформирован.",
          }
        : artifact.available
          ? { code: "DOWNLOAD", available: true, reason: null }
          : {
              code: "DOWNLOAD",
              available: false,
              reason: "Срок хранения артефакта истёк — файла больше нет на сервере.",
            };

  return [
    {
      code: "OPEN_PARAMETERS",
      available: parametersVisible,
      reason: parametersVisible ? null : FOREIGN_PARAMETERS_REASON,
    },
    download,
    { code: "RETRY", available: terminal, reason: terminal ? null : running },
    {
      code: "NEW_REVISION",
      available: job.state === "COMPLETED",
      reason:
        job.state === "COMPLETED"
          ? null
          : job.state === "FAILED"
            ? "Редакция бывает у собранного отчёта: у упавшей работы её нет — используйте «Повторить»."
            : running,
    },
    {
      code: "VIEW_ERROR",
      available: job.state === "FAILED",
      reason: job.state === "FAILED" ? null : "Работа не завершалась ошибкой.",
    },
  ];
}

// ── §35-блоки ────────────────────────────────────────────────────────────

export const UNAVAILABLE_HISTORY_COLUMNS: readonly MaskedField[] = [
  {
    code: "SCOPE",
    label: "Scope",
    reason:
      "RBAC demo-режима плоский, без организационного scope: у работы нет области, которую можно показать. Пустая колонка «Scope» читалась бы как «область не ограничена».",
  },
];

export const UNAVAILABLE_JOB_CARD_BLOCKS: readonly MaskedField[] = [
  {
    code: "SCOPE",
    label: "Scope запуска",
    reason:
      "RBAC demo-режима плоский, без организационного scope: перепроверяется то, что есть, — право; scope перепроверять не на чем.",
  },
  {
    code: "ARTIFACT_ROUTE",
    label: "Отдельный маршрут артефакта",
    reason:
      "У работы ровно один артефакт, и все его метаданные показаны здесь: второй маршрут стал бы вторым владельцем одного представления, а постоянной ссылки на файл не существует вовсе (§22.23).",
  },
];

export const UNAVAILABLE_FORMATS: readonly MaskedField[] = [
  {
    code: "XLSX",
    label: "XLSX",
    reason:
      "Формирование книги Excel требует серверной генерации; кнопка без артефакта — «фальшивое действие», которое §22.23 запрещает.",
  },
  {
    code: "PDF",
    label: "PDF",
    reason:
      "PDF в проекте формируется печатью браузера по печатному канону, а не серверным артефактом — это другой механизм.",
  },
  {
    code: "DOCX",
    label: "DOCX",
    // Причина переписана (Plane №156): генератор DOCX в проекте ЕСТЬ, им
    // собираются документы по мероприятию в секции ниже. Прежний текст
    // «генератора нет» стоял бы на одном экране с работающей выгрузкой DOCX и
    // читался бы как поломка. Недоступен именно ОТЧЁТ ЗА ПЕРИОД: у него нет
    // бланка-образца, с которого снята бы вёрстка.
    reason:
      "Генератор DOCX в проекте ЕСТЬ и работает — им собираются документы по мероприятию в секции ниже (Plane №156). Но служебный отчёт за период это другой артефакт: у него нет бланка-образца, с которого снята бы вёрстка, а собирать его «как-нибудь» значило бы выдать за документ заказчика то, чего он не присылал.",
  },
];

export const UNAVAILABLE_ARTIFACT_FIELDS: readonly MaskedField[] = [
  {
    code: "SCOPE_SNAPSHOT",
    label: "Снимок scope",
    reason:
      "RBAC demo-режима плоский, без организационного scope — снимать нечего.",
  },
  {
    code: "SOURCE_WATERMARK",
    label: "Водяной знак источника",
    reason:
      "Водяной знак наносится генератором документа; CSV его не несёт, а приписывать поле, которого нет в файле, значило бы описывать несуществующее свойство.",
  },
  {
    code: "POLICY_VERSION",
    label: "Версия политики доступа",
    reason:
      "Версионируемой политики доступа в demo-срезе нет: права — плоский список кодов. Версии расчёта и маскирования при этом реальные и хранятся в артефакте.",
  },
];

// ── Документы ОМ в PDF (Plane №159, шаг ПД-3) ─────────────────────────────
// Документ и отчёт — РАЗНЫЕ вещи, и типы у них разные не для порядка.
// Отчёт это ЗАДАНИЕ: его ставят в очередь, оно живёт своим сроком, у него
// бывают повтор и ревизия. Документ собирается одним ответом за доли секунды
// и никакого состояния после себя не оставляет.

export const OPS_EVENT_DOCUMENTS_PATH = "/api/ops/event-documents/";
export const OPS_EVENT_DOCUMENT_RENDER_PATH =
  "/api/ops/event-documents/render/";

export interface EventDocumentKind {
  kind: string;
  label: string;
  /** Строится ПО мероприятию: без него собирать нечего. У бюллетеня и
   * графиков это `false` — они идут по всем ОМ на момент среза. */
  needsEvent: boolean;
  /** Срез выбирает человек (`[БЛН-04]`, Plane №420): дата и время, от
   * которых идёт отбор и которые печатаются в заголовке. Сегодня — только у
   * бюллетеня; поле может отсутствовать у старого сервера. */
  needsAsOf?: boolean;
}

/**
 * Формат выгрузки. DOCX — то, что просил заказчик (Plane №156): образцы это
 * рабочие бланки Word, их дозаполняют руками после выгрузки. PDF рядом нужен,
 * когда документ идут печатать или отправлять и правок в нём не ждут.
 */
export type EventDocumentFormat = "docx" | "pdf";

export interface EventDocumentFormatOption {
  format: EventDocumentFormat;
  label: string;
}

export interface EventDocumentKindsResponse {
  results: EventDocumentKind[];
  /** Список приходит С СЕРВЕРА, а не зашит здесь: свой разошёлся бы с ручкой
   * и предложил бы формат, которого она не соберёт. */
  formats: EventDocumentFormatOption[];
}

/** Файл приходит содержимым в JSON, а не потоком: клиент шлёт токен
 * ЗАГОЛОВКОМ, и открыть файл прямой ссылкой нельзя — токена в ней нет. Тот же
 * контракт, что у скачивания артефакта отчёта. */
export interface EventDocumentResponse {
  fileName: string;
  contentBase64: string;
  contentType: string;
}

export function eventDocumentRenderPath(params: {
  kind: string;
  eventCode?: string;
  format?: EventDocumentFormat;
  /** ISO-дата-время среза; без него сервер берёт «сейчас», как прежде. */
  asOf?: string;
}): string {
  const query = new URLSearchParams({ kind: params.kind });
  if ((params.eventCode ?? "").trim() !== "")
    query.set("event", (params.eventCode as string).trim());
  if ((params.asOf ?? "").trim() !== "") query.set("asOf", (params.asOf as string).trim());
  // Формат ставится в адрес ТОЛЬКО когда он задан: без него ручка отдаёт PDF,
  // и подставлять его здесь значило бы держать умолчание в двух местах.
  //
  // Параметр называется `ext`, а НЕ `format`: имя `format` занято самим DRF
  // (URL_FORMAT_OVERRIDE) под выбор рендерера, и `?format=docx` отвечает 404
  // «Not found» ещё до вьюхи. Нашлось пробой, не рассуждением.
  if (params.format !== undefined) query.set("ext", params.format);
  return `${OPS_EVENT_DOCUMENT_RENDER_PATH}?${query.toString()}`;
}

// ── Выпуски бюллетеня (`[МД-01]`, `[БЛН-04]`, Plane №420) ────────────────────
//
// Выпуск — срез, кто выпустил, число строк и замороженный PDF: то, что ушло
// адресатам. Сборка на лету (`render`) остаётся рядом — она отвечает «как
// выглядит бюллетень сейчас», выпуск — «что было отправлено».

export const OPS_BULLETIN_ISSUES_PATH = "/api/ops/bulletin-issues/";

export interface BulletinIssue {
  id: string;
  asOf: string;
  issuedBy: string;
  issuedAt: string | null;
  eventCount: number;
  fileName: string;
}

export interface BulletinIssuesResponse {
  results: BulletinIssue[];
}

export function bulletinIssueFilePath(id: string): string {
  return `${OPS_BULLETIN_ISSUES_PATH}${id}/file/`;
}
