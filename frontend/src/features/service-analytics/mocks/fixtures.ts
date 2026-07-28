// Demo-сид аналитики службы (§8.7: только синтетические данные).
//
// В слайсе лежат ОПРЕДЕЛЕНИЯ, а не числа: сами показатели считаются на запросе
// из живых смен. Пороги и пресеты периодов живут здесь, потому что §22.5 прямо
// запрещает хардкодить «последние 7 дней» и «порог перегрузки» в коде.
import { METRIC_CODES } from '../lib/analytics'
import type { MetricDefinition, PeriodPreset } from '../model/types'

export interface ServiceAnalyticsSlice {
  metricDefinitions: MetricDefinition[]
  periodPresets: PeriodPreset[]
  /** Размер страницы выборки drill-down (§22.12 pagination cursor). */
  drilldownPageSize: number
}

/**
 * §22.7 базовые KPI — те из них, под которыми есть РЕАЛЬНЫЕ данные. Остальные
 * приходят клиенту списком `unavailableMetrics` с причиной (§35), а не нулями.
 *
 * Пороги НАМЕРЕННО не круглые и не одинаковые: совпадение с «привычным» числом
 * скрыло бы захардкоженный порог, если бы он где-то остался (тот же приём, что
 * 92 дня у периода отчёта и 120 дней у свежести паспорта).
 */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    metricCode: METRIC_CODES.onDuty,
    safeLabel: 'На дежурстве',
    unit: 'COUNT',
    // Справочный показатель: тревожного порога у него нет, и выдуманный
    // сделал бы обычную работу службы «предупреждением».
    warningFrom: null,
    criticalFrom: null,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.planned,
    safeLabel: 'Запланировано смен',
    unit: 'COUNT',
    warningFrom: null,
    criticalFrom: null,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.rest,
    safeLabel: 'Отдых после дежурства',
    unit: 'COUNT',
    warningFrom: null,
    criticalFrom: null,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.unfinished,
    safeLabel: 'Незакрытые прошедшие дежурства',
    unit: 'COUNT',
    warningFrom: 1,
    criticalFrom: 4,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.hardConflicts,
    safeLabel: 'Жёсткие конфликты',
    unit: 'COUNT',
    warningFrom: 1,
    criticalFrom: 3,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.softConflicts,
    safeLabel: 'Мягкие конфликты',
    unit: 'COUNT',
    warningFrom: 2,
    criticalFrom: 6,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.unconfirmed,
    safeLabel: 'Неподтверждённое участие',
    unit: 'COUNT',
    warningFrom: 1,
    criticalFrom: 5,
    drilldownAvailable: true,
  },
]

/**
 * §22.5 пресеты периодов. Подписи — пользовательские, коды и глубина приходят
 * из этого registry. «Произвольный период» пресетом НЕ является: у него нет
 * своей глубины, он задаётся датами и проверяется сервером.
 */
export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  { presetCode: 'TODAY', safeLabel: 'Сегодня', offsetDays: 0, lengthDays: 1 },
  { presetCode: 'PREV_BUSINESS_DAY', safeLabel: 'Предыдущий рабочий день', offsetDays: -1, lengthDays: 1 },
  { presetCode: 'CURRENT_WEEK', safeLabel: 'Текущая неделя', offsetDays: 0, lengthDays: 7 },
  { presetCode: 'CURRENT_MONTH', safeLabel: 'Текущий месяц', offsetDays: 0, lengthDays: 30 },
]

/** Максимальная глубина произвольного периода — тоже в данных (§22.5 «проверяй
 * допустимый диапазон через server validation»). */
export const MAX_CUSTOM_PERIOD_DAYS = 62

export function buildServiceAnalyticsSeed(): {
  sliceName: string
  data: ServiceAnalyticsSlice
} {
  return {
    sliceName: 'serviceAnalytics',
    data: {
      metricDefinitions: METRIC_DEFINITIONS.map((definition) => ({ ...definition })),
      periodPresets: PERIOD_PRESETS.map((preset) => ({ ...preset })),
      // Намеренно маленькая: страница из 4 строк делает курсор ПРОВЕРЯЕМЫМ на
      // demo-объёме данных — при странице в 50 вторая страница не наступила бы
      // никогда, и pagination жил бы непроверенным.
      drilldownPageSize: 4,
    },
  }
}
