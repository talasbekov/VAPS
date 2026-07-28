// Pending-контракты аналитики службы (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type {
  AnalyticsSnapshot,
  AttentionData,
  DrilldownPage,
  PeriodPreset,
  ServiceAnalyticsData,
  UnavailableMetric,
} from '../model/types'

export const ANALYTICS_SNAPSHOT_PATH = '/api/ops/service-analytics/'
export const ANALYTICS_PRESETS_PATH = '/api/ops/service-analytics-presets/'
export const ANALYTICS_DRILLDOWN_PATH = '/api/ops/service-analytics-drilldown/'
/** §22.11 отдельный ресурс, а не поле снимка показателей: наблюдения делает
 * ДРУГОЙ детектор с другой политикой и другим временем — приехав внутри снимка
 * KPI, они унаследовали бы его `policyVersion` и читались бы как его следствие.
 * Путь СИБЛИНГ, а не вложенный: `…/service-analytics/attention/` msw отдал бы
 * первому совпавшему handler'у молча (коллизия путей, Этап 39). */
export const ANALYTICS_ATTENTION_PATH = '/api/ops/service-analytics-attention/'

/** Блок §35 в ответе. Форма та же, что у `UnavailableMetric`: «чего нет и
 * почему» — одно понятие, и второй тип с теми же полями разошёлся бы с первым.
 * Тип НЕ выводится из литерального массива `UNAVAILABLE_HEADER_BLOCKS`: контракт
 * описывает форму ответа, а не набор строк, который лежит в нём сегодня. */
export type HeaderBlock = UnavailableMetric

/** §22.5: набор пресетов и предел произвольного периода — из registry. */
export interface AnalyticsPresetsResponse {
  results: PeriodPreset[]
  maxCustomPeriodDays: number
  /** §22.6: пресет по умолчанию решает сервер — кнопка «Сбросить» возвращает
   * «разрешённые сервером значения по умолчанию», а не зашитый в экран выбор. */
  defaultPresetCode: string
}

export type ServiceAnalyticsResponse = AnalyticsSnapshot<ServiceAnalyticsData> & {
  /** §35: блоки §22.6/§22.11, которых в срезе нет, с причиной. */
  unavailableHeaderBlocks: HeaderBlock[]
  /** §22.12: доступен ли смотрящему drill-down вообще, и если нет — почему.
   * Считает сервер: право на дашборд и право на раскрытие — разные (§22.26). */
  drilldownAllowed: boolean
  drilldownDeniedReason: string | null
}

/**
 * §22.12 запрос выборки. Экран обязан прислать `snapshotId` — строки должны
 * принадлежать ТОМУ ЖЕ снимку, что и раскрытый показатель. Сервер сверяет его
 * со снимком, который получился бы сейчас, и отвечает отказом при расхождении:
 * иначе число из шапки и строки под ним рассказывали бы о разных мгновениях.
 */
export interface DrilldownQuery {
  snapshotId: string
  metricCode: string
  presetCode: string | null
  from: string
  to: string
  cursor: string | null
}

export type DrilldownResponse = AnalyticsSnapshot<DrilldownPage>

/** §22.11. `policyVersion` конверта здесь — версия политики НАБЛЮДЕНИЙ, а не
 * порогов показателей: у этого снимка другая методика. */
export type AttentionResponse = AnalyticsSnapshot<AttentionData>
