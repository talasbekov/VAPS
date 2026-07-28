// Pending-контракты отчётного реестра (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
//
// ⚠️ Путь НЕ `/api/ops/reports/`: `/reports` в портале — донорский экран
// «Расход дня» (E10), и одноимённый ресурс сбивал бы с толку при чтении логов
// и в поиске по коду. Проверено grep'ом до заведения — коллизия путей в MSW
// разрешается молча в пользу первого handler'а (инцидент Этапа 39).
import type { MaskedField } from '../lib/reporting'
import type {
  ArtifactUnavailableReason,
  ReportArtifact,
  ReportFormat,
  ReportJob,
  ReportParameters,
  ReportRetentionPolicy,
  ReportTypeDefinition,
} from '../model/types'

export const REPORT_TYPES_PATH = '/api/ops/service-report-types/'
export const REPORT_JOBS_PATH = '/api/ops/service-report-jobs/'

export function reportJobPath(id: string): string {
  return `${REPORT_JOBS_PATH}${id}/`
}
export function reportArtifactDownloadPath(id: string): string {
  return `/api/ops/service-report-artifacts/${id}/download/`
}

export interface ListReportTypesResponse {
  results: ReportTypeDefinition[]
  retentionPolicy: ReportRetentionPolicy
  /** §22.24: какие поля исключает обычный экспорт и почему. */
  maskedFields: MaskedField[]
  /** §22.23: форматы, которых проект не формирует, с причиной. */
  unavailableFormats: MaskedField[]
  /** §35: поля контракта §22.22, которых demo-срез не даёт. */
  unavailableArtifactFields: MaskedField[]
  /** Есть ли у смотрящего право на sensitive export (§20.32). Считает сервер. */
  canExportSensitive: boolean
}

/**
 * §22.24 «List endpoint отчётов возвращает безопасную проекцию».
 *
 * Ни `content`, ни ссылки на файл здесь НЕТ — §22.23 запрещает класть
 * постоянную ссылку в list endpoint, HTML, Tooltip, `aria-label`, telemetry,
 * localStorage и URL страницы. Скачивание — отдельная операция, которая
 * повторно проверяет право и отдаёт ПОТОК; постоянной ссылки не существует
 * вовсе, поэтому её неоткуда утечь.
 */
export interface ReportArtifactSummary {
  artifactId: string
  reportJobId: string
  safeTitle: string
  format: ReportFormat
  revision: number
  generatedAt: string
  generatedBy: string
  parameterSnapshot: ReportParameters
  calculationVersion: string
  maskingPolicyVersion: string
  sensitive: boolean
  fileSize: number
  hash: string
  expiresAt: string
  available: boolean
  /** `null`, пока артефакт доступен. */
  unavailableReason: ArtifactUnavailableReason | null
}

export interface ListReportJobsResponse {
  results: ReportJob[]
  artifacts: ReportArtifactSummary[]
  /** Время сервера, по которому считалась доступность артефактов: экран не
   * пересчитывает срок своими часами (§8.8). */
  serverTime: string
}

/** `type`, а не `interface`: переменные `useApiMutation` обязаны
 * удовлетворять `Record<string, unknown>`. */
export type CreateReportJobRequest = {
  reportTypeCode: string
  format: ReportFormat
  from: string
  to: string
  sensitive: boolean
  /** §22.21: повтор с тем же ключом не создаёт вторую работу. */
  idempotencyKey: string
}

export type CreateReportJobResponse = ReportJob
export type ReportJobResponse = ReportJob
export type DownloadArtifactResponse = { fileName: string; content: string }
export type { ReportArtifact }
