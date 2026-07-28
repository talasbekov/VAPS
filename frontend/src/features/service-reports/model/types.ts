// Отчётный реестр Smart Josparlau (§22.18-22.25, §20.32). Асинхронная
// генерация: пользователь задаёт параметры → repository проверяет право и
// параметры → создаётся ReportJob → формируется immutable artifact →
// скачивание ПОВТОРНО проверяет право и состояние.
//
// Контракт `ReportJob`/`ReportArtifact` промпта воспроизведён НЕ ЦЕЛИКОМ: поля,
// за которыми в demo-срезе нет ни данных, ни смысла, отсутствуют, а не
// заполняются нулями — какие именно и почему, перечислено в
// `UNAVAILABLE_ARTIFACT_FIELDS` (§35) и приходит клиенту вместе с артефактом.

/**
 * §22.21. Состояния — СЕРВЕРНЫЕ. Frontend их не выдумывает и не добавляет
 * своих: «идёт скачивание» или «готовится» на стороне экрана состоянием job'а
 * не являются.
 *
 * ⚠️ Про асинхронность в demo. Фонового исполнителя тут нет и быть не может:
 * mock-runtime живёт в том же процессе, а DemoClock не тикает сам (§8.8).
 * Поэтому ступень генерации продвигается СЕРВЕРОМ при чтении job'а —
 * упрощён ИСПОЛНИТЕЛЬ, а не модель состояний: сами состояния хранятся в
 * слайсе, приходят с сервера и меняются только там.
 */
export type ReportJobState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface ReportJob {
  reportJobId: string
  reportTypeCode: string
  format: ReportFormat
  state: ReportJobState
  /** `null` до старта обработки: доля выполненного у не начатой работы —
   * выдумка, а не ноль. */
  progressPercent: number | null
  createdAt: string
  createdBy: { userId: string; safeLabel: string }
  completedAt: string | null
  failureCode: string | null
  safeFailureMessage: string | null
  /** §22.21 «Success показывай только после COMPLETED и получения artifactId». */
  artifactId: string | null
  /** §22.21: повтор с тем же ключом не создаёт вторую работу. */
  idempotencyKey: string
  /** §20.32/§22.24: обычный экспорт и sensitive export — РАЗНЫЕ операции. */
  sensitive: boolean
  parameters: ReportParameters
}

/** Форматы, которые проект реально формирует. §22.23 прямо запрещает
 * показывать PDF/XLSX/DOCX, если за ними нет реализации, — поэтому их здесь
 * нет вовсе, а причина отдаётся клиенту (`UNAVAILABLE_FORMATS`). */
export type ReportFormat = 'CSV'

export interface ReportParameters {
  /** Границы периода включительно, YYYY-MM-DD. */
  from: string
  to: string
}

export interface ReportArtifact {
  artifactId: string
  reportJobId: string
  reportTypeCode: string
  safeTitle: string
  format: ReportFormat
  revision: number
  generatedAt: string
  generatedBy: string
  parameterSnapshot: ReportParameters
  /** §22.22 версии, по которым артефакт считался. Хранятся в СНИМКЕ: политика
   * могла измениться после генерации, и артефакт обязан помнить свою. */
  calculationVersion: string
  maskingPolicyVersion: string
  /** §22.24: включены ли поля, которые обычный экспорт исключает. */
  sensitive: boolean
  fileSize: number
  /** Детерминированная контрольная сумма содержимого. НЕ криптографический
   * хеш: назначение — заметить расхождение содержимого, а не защита от
   * подделки, и выдавать её за вторую было бы неправдой. */
  hash: string
  /** §22.22 «Срок доступности бери из expiresAt» — хардкода «файлы доступны
   * 30 дней» в проекте нет: срок считает сервер по политике хранения. */
  expiresAt: string
  /** Само содержимое живёт на «сервере» и НЕ едет в списках (§22.24). */
  content: string
}

/** §22.22: артефакт может быть недоступен по разным причинам, и они разные. */
export type ArtifactUnavailableReason = 'EXPIRED' | 'NOT_READY' | 'FAILED'

/** Определение отчёта (§22.19). */
export interface ReportTypeDefinition {
  reportTypeCode: string
  safeTitle: string
  description: string
  formats: ReportFormat[]
  /** Максимальная глубина периода — В ДАННЫХ, а не в коде формы: период отчёта
   * задаётся политикой, и захардкоженное число повторило бы ошибку «паспорт
   * старше 90 дней» (§21.7). */
  maxPeriodDays: number
}

/** Политика хранения артефактов (§22.22). Живёт в ДАННЫХ по той же причине. */
export interface ReportRetentionPolicy {
  retentionDays: number
  policyVersion: string
}
