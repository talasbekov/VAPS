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
  ReportJobAction,
  ReportJobActions,
  ReportJobState,
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
/** §22.25 «Повторить с теми же параметрами» / «Сформировать новую revision».
 * Отдельный ресурс, а не флаг в теле создания: параметры повтора берёт СЕРВЕР
 * из исходной работы, и клиенту нечего сюда передавать, кроме режима. */
export function reportJobRerunPath(id: string, mode: RerunMode): string {
  return `${REPORT_JOBS_PATH}${id}/${mode === 'RETRY' ? 'retry' : 'new-revision'}/`
}

export type RerunMode = 'RETRY' | 'NEW_REVISION'

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
/**
 * §22.26/§22.27: работа В ОТВЕТЕ СЕРВЕРА, а не в слайсе. Отличается от
 * `ReportJob` ровно одним — параметры чужого запуска могут быть ВЫРЕЗАНЫ.
 *
 * Вырезаны именно на сервере: §22.27 требует, чтобы при запрещённом доступе
 * закрытые данные ОТСУТСТВОВАЛИ В DOM, а спрятать период в вёрстке значит всё
 * равно отдать его браузеру (тот же вывод, что sensitive identity §20.27 и
 * фильтрация невидимых работ §22.25).
 */
export interface ReportJobView extends Omit<ReportJob, 'parameters' | 'idempotencyKey'> {
  parameters: ReportParameters | null
  /**
   * `null` вместе с параметрами — и это не перестраховка.
   *
   * Ключ идемпотентности ПО ПОСТРОЕНИЮ производен от параметров
   * (`PERSONNEL_EXPENSE:2026-07-01:2026-07-31:S:1`, см. `ServiceReportsPage`):
   * вырезать период и напечатать ключ значило бы вернуть тот же период
   * соседним полем ответа. Тот же класс, что `parameterSnapshot` артефакта.
   */
  idempotencyKey: string | null
  /** `null`, пока параметры видны: причина нужна ровно там, где отказ. */
  parametersRedactedReason: string | null
}

export interface ReportArtifactSummary {
  artifactId: string
  reportJobId: string
  safeTitle: string
  format: ReportFormat
  revision: number
  generatedAt: string
  generatedBy: string
  /** `null` по той же причине, что `ReportJobView.parameters`: снимок
   * параметров — это те же параметры, и вырезать надо ОБА места, иначе запрет
   * просто переезжает в соседнее поле ответа. */
  parameterSnapshot: ReportParameters | null
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

/** §22.25 фильтры истории. Применяет СЕРВЕР: экран не режет уже полученный
 * массив — §22.24 не даёт грузить в браузер строки, которые не показывают. */
export interface ListReportJobsFilters {
  state?: ReportJobState
  /** Только работы смотрящего. Чьи именно — решает сервер по актору запроса. */
  mine?: boolean
}

export interface ListReportJobsResponse {
  results: ReportJobView[]
  artifacts: ReportArtifactSummary[]
  /** §22.25: доступные действия по каждой работе — считает сервер. */
  actions: ReportJobActions[]
  /** §35: колонки §22.25, которых demo-срез не даёт, с причиной. */
  unavailableColumns: MaskedField[]
  /** Сколько работ видит смотрящий ВСЕГО, до фильтров: «ничего не нашлось» и
   * «отчётов ещё не запускали» — разные сообщения. */
  totalVisible: number
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

/**
 * Ответ повтора. `reused: true` означает, что новой работы НЕ создавали —
 * сервер вернул уже готовый пригодный артефакт (§22.25). Экран обязан
 * различать эти два исхода: «сформировано заново» и «отдан прежний файл» —
 * разные события для человека.
 */
export type RerunReportJobResponse = {
  reused: boolean
  reportJobId: string
  artifactId: string | null
}
/**
 * §22.27 карточка работы + §22.28 «получить состояние job» и «получить
 * метаданные artifact» — ОДНИМ согласованным срезом.
 *
 * Двумя запросами карточка показывала бы состояние из одного ответа и артефакт
 * из другого: между ними работа успевает продвинуться, и человек увидел бы
 * «формируется» рядом с готовым файлом. Тот же приём, что карточка дежурства
 * (§21.32).
 */
export interface ReportJobDetailResponse {
  job: ReportJobView
  /** Артефакт работы или `null`, пока его нет. */
  artifact: ReportArtifactSummary | null
  /** §22.25: действия считает сервер — здесь те же, что в строке истории. */
  actions: ReportJobAction[]
  /** Название типа отчёта из каталога: у работы без артефакта его взять больше
   * неоткуда, а показывать человеку код `PERSONNEL_EXPENSE` — не название. */
  reportTypeTitle: string
  /** §22.26: свой ли это запуск. Экран не сравнивает пользователей сам —
   * «свой» решает сервер, который знает актора запроса. */
  isOwn: boolean
  /** §35: блоки §22.27, которых demo-срез не даёт, с причиной. */
  unavailableBlocks: MaskedField[]
  /** §35: поля контракта артефакта (§22.22), которых demo-срез не даёт. */
  unavailableArtifactFields: MaskedField[]
  /** Время сервера, по которому считалась доступность артефакта (§8.8). */
  serverTime: string
}

export type DownloadArtifactResponse = { fileName: string; content: string }
export type { ReportArtifact }
