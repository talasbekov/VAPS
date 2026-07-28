// Demo-сид аналитики службы (§8.7: только синтетические данные).
//
// В слайсе лежат ОПРЕДЕЛЕНИЯ, а не числа: сами показатели считаются на запросе
// из живых смен. Пороги и пресеты периодов живут здесь, потому что §22.5 прямо
// запрещает хардкодить «последние 7 дней» и «порог перегрузки» в коде.
import { ROUTES } from '../../../shared/routes'
import { METRIC_CODES } from '../lib/analytics'
import type { AttentionDetectorDefinition } from '../lib/attention'
import type { LifecycleStateDefinition } from '../lib/operations'
import type { MetricDefinition, PeriodPreset } from '../model/types'

export interface ServiceAnalyticsSlice {
  metricDefinitions: MetricDefinition[]
  periodPresets: PeriodPreset[]
  /** Размер страницы выборки drill-down (§22.12 pagination cursor). */
  drilldownPageSize: number
  /** §22.11: политика наблюдений — отдельная от порогов показателей. */
  attentionDetectors: AttentionDetectorDefinition[]
  /** §22.13: реестр состояний ОМ — распределение строится ТОЛЬКО по нему. */
  opsLifecycleRegistry: LifecycleStateDefinition[]
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

/**
 * §22.11 политика наблюдений. Живёт РЯДОМ с порогами показателей, но отдельно
 * от них: у наблюдений своя версия (`ATTENTION_POLICY_VERSION`), свои единицы
 * (проценты, часы, дни выдержки) и свои допуски. Общий набор порогов означал бы,
 * что «внимание» — это перекрашенный KPI, а §22.11 требует наблюдения.
 *
 * Пороги снова не круглые: 18/34 процента и 53 часа. Совпадение с «привычным»
 * числом (25/50, двое суток) скрыло бы захардкоженный порог, если бы он
 * где-то остался.
 */
export const ATTENTION_DETECTORS: readonly AttentionDetectorDefinition[] = [
  {
    categoryCode: 'ACKNOWLEDGEMENT_MISSING',
    measure: 'ACKNOWLEDGEMENT_MISSING',
    titleCode: 'VERIFICATION_REQUIRED',
    safeDescriptionTemplate:
      // ⚠️ Формулировка §22.11 стоит в ЗАГОЛОВКЕ и не повторяется здесь:
      // повтор делал бы подпись элемента подстрокой его же описания — тот же
      // класс, что «сдано» ⊂ «сдано, расход разошёлся» (инцидент Этапа 44).
      'Записей с ближайшим заступлением без отметки об ознакомлении: {count}. Срок упреждения — {parameter} дн.',
    parameter: 3,
    warningFrom: 1,
    criticalFrom: 4,
    baseSeverity: 'INFO',
    targetRoute: ROUTES.duties,
    targetPermission: 'ops.duty.view',
  },
  {
    categoryCode: 'CONFLICT_SHARE',
    measure: 'CONFLICT_SHARE',
    titleCode: 'THRESHOLD_EXCEEDED',
    safeDescriptionTemplate:
      'Доля записей периода с конфликтом планирования — {value}% при серверном пороге. Записей с конфликтом: {count}.',
    parameter: 0,
    warningFrom: 18,
    criticalFrom: 34,
    baseSeverity: 'INFO',
    targetRoute: ROUTES.duties,
    targetPermission: 'ops.duty.view',
  },
  {
    categoryCode: 'UNFINISHED_OVERDUE',
    measure: 'UNFINISHED_OVERDUE',
    titleCode: 'UNFINISHED_PROCESSES',
    safeDescriptionTemplate:
      'Записей, не переведённых в завершённое состояние дольше допуска ({parameter} дн.): {count}.',
    parameter: 2,
    warningFrom: 1,
    criticalFrom: 5,
    baseSeverity: 'INFO',
    targetRoute: ROUTES.duties,
    targetPermission: 'ops.duty.view',
  },
  {
    categoryCode: 'UNCONFIRMED_OVERDUE',
    measure: 'UNCONFIRMED_OVERDUE',
    titleCode: 'DATA_UNCONFIRMED',
    safeDescriptionTemplate:
      'Записей без подтверждённых отметок фактического времени дольше допуска ({parameter} дн.): {count}.',
    parameter: 2,
    warningFrom: 1,
    criticalFrom: 4,
    baseSeverity: 'INFO',
    targetRoute: ROUTES.duties,
    targetPermission: 'ops.duty.view',
  },
  {
    // Утверждение об ИСТОЧНИКЕ. Перехода у него нет намеренно: вести человека
    // в раздел данных, которые не обновлялись, значит предложить искать там
    // причину, которой в разделе не видно.
    categoryCode: 'SOURCE_AGE',
    measure: 'SOURCE_AGE',
    titleCode: 'SOURCE_NOT_UPDATED',
    safeDescriptionTemplate:
      // Формулировка §22.11 — в заголовке; здесь только измеренное (см. выше).
      'Последнее изменение источника — {value} ч назад при допуске {parameter} ч.',
    parameter: 53,
    warningFrom: 53,
    criticalFrom: null,
    baseSeverity: 'INFO',
    targetRoute: null,
    targetPermission: null,
  },
]

/**
 * §22.13 Lifecycle Registry ОМ. Живёт В ДАННЫХ, а не строкой в коде аналитики:
 * подписи стадий принадлежат feature `security-events`, импорт оттуда красный
 * по ARCH-FE-013, а дубль-константа разошлась бы с оригиналом молча. Реестр в
 * слайсе делает расхождение ВИДИМЫМ: код, которого здесь нет, приезжает
 * клиенту списком `unknownLifecycleCodes`, а не растворяется в распределении.
 */
export const OPS_LIFECYCLE_REGISTRY: readonly LifecycleStateDefinition[] = [
  { stateCode: 'BULLETIN', safeLabel: 'Бюллетень' },
  { stateCode: 'RECON', safeLabel: 'Рекогносцировка' },
  { stateCode: 'DEMAND', safeLabel: 'Потребность' },
  { stateCode: 'FORCES', safeLabel: 'Запрос сил' },
  { stateCode: 'PLACEMENT', safeLabel: 'Расстановка' },
  { stateCode: 'APPROVAL', safeLabel: 'Согласование' },
  { stateCode: 'ACKNOWLEDGEMENT', safeLabel: 'Ознакомление' },
  { stateCode: 'CONDUCT', safeLabel: 'Проведение' },
  { stateCode: 'CLOSED', safeLabel: 'Закрыто' },
]

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
      attentionDetectors: ATTENTION_DETECTORS.map((detector) => ({ ...detector })),
      opsLifecycleRegistry: OPS_LIFECYCLE_REGISTRY.map((state) => ({ ...state })),
    },
  }
}
