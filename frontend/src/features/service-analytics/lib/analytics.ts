// Расчёт аналитики службы (§22.3/§22.7) и выборки drill-down (§22.12). Чистая
// модель: ни React, ни apiClient — тестируется в env node.
//
// ⚠️ ГЛАВНОЕ. Всё, что здесь считается, вызывается ИЗ mock-repository, то есть
// с «серверной» стороны. §22.3 перечисляет расчёты, которых frontend делать не
// должен, и «итог по видимой части таблицы» стоит в том же списке, что
// численность и просрочка: считать по загруженной странице — тот же запрет.
import type {
  DrilldownRow,
  MetricDefinition,
  MetricState,
  MetricValue,
  PeriodPreset,
} from '../model/types'

/** Строка источника: узкая проекция чужого слайса дежурств. */
export interface AnalyticsSourceShift {
  id: string
  businessDate: string
  employeeName: string
  objectLabel: string
  stateCode: string
  dutyTypeCode: string
  actualStart: string | null
  actualEnd: string | null
  updatedAt: string
}

/** Вид дежурства — здесь нужен только СРОК отдыха (§21.35: длительность —
 * атрибут вида, а не глобальная константа). Режим нарушения видом больше не
 * задаётся: он приходит правилами конфликтов из «Настроек» (§29). */
export interface AnalyticsDutyType {
  dutyTypeCode: string
  restAfterMinutes: number
}

/** Режим нарушения отдыха §21.35. Аналитика читает ТУ ЖЕ политику, что и
 * планирование дежурств: два владельца одного факта разошлись бы, и один и тот
 * же конфликт был бы жёстким на плане и мягким в аналитике. */
export type AnalyticsRestMode = 'HARD_BLOCK' | 'SOFT_OVERRIDE'

/** Источник аналитики: смены и виды из слайса дежурств + действующий режим
 * отдыха из слайса настроек. Собирает СЕРВЕР — экран получает готовое. */
export interface AnalyticsSource {
  shifts: AnalyticsSourceShift[]
  dutyTypes: AnalyticsDutyType[]
  restMode: AnalyticsRestMode
}

export const CALCULATION_VERSION = 'service-analytics-2026.07.1'
export const METRIC_DEFINITION_VERSION = 'metrics-2026.07.1'
export const POLICY_VERSION = 'analytics-policy-2026.07.1'

export const METRIC_CODES = {
  onDuty: 'DUTY_ACTIVE',
  planned: 'DUTY_PLANNED',
  rest: 'REST_AFTER_DUTY',
  unfinished: 'UNFINISHED_PAST_DUTIES',
  hardConflicts: 'CONFLICT_HARD',
  softConflicts: 'CONFLICT_SOFT',
  unconfirmed: 'UNCONFIRMED_PARTICIPATION',
} as const

const DAY_MS = 86_400_000

export function addDays(date: string, days: number): string {
  const base = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  )
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10)
}

/** §22.5: границы периода строит СЕРВЕР по пресету и бизнес-дате. Экран не
 * умеет «текущая неделя» — он присылает код, а не даты. */
export function resolvePreset(
  preset: PeriodPreset,
  businessDate: string,
): { from: string; to: string } {
  const from = addDays(businessDate, preset.offsetDays)
  // Включительные границы: длительность 1 день — это from === to.
  return { from, to: addDays(from, preset.lengthDays - 1) }
}

export function inPeriod(date: string, from: string, to: string): boolean {
  return date >= from && date <= to
}

/**
 * §22.7 «незавершённые прошедшие дежурства». Прошедшее — строго ДО бизнес-даты:
 * сегодняшняя смена ещё не обязана быть закрытой, и записать её в просрочку
 * значило бы обвинить человека раньше срока (§22.11 запрещает собственные
 * обвинительные выводы).
 */
export function isUnfinishedPast(shift: AnalyticsSourceShift, businessDate: string): boolean {
  if (shift.businessDate >= businessDate) return false
  return shift.stateCode !== 'COMPLETED' && shift.stateCode !== 'CANCELLED'
}

/**
 * «Неподтверждённое фактическое участие» (§22.7): смена дошла до несения
 * службы, но факта нет. Отменённые сюда не попадают — у них подтверждать нечего.
 */
export function isUnconfirmed(shift: AnalyticsSourceShift): boolean {
  if (shift.stateCode === 'ACTIVE') return shift.actualStart === null
  if (shift.stateCode === 'COMPLETED') return shift.actualStart === null || shift.actualEnd === null
  return false
}

/**
 * Отдых после дежурства. Длина отдыха — у ВИДА дежурства (§21.35), в сутках
 * округляя ВВЕРХ: неполные сутки отдыха — всё ещё отдых, и отбросить их значило
 * бы считать человека доступным раньше времени.
 */
export function restDays(type: AnalyticsDutyType | undefined): number {
  if (type === undefined) return 0
  return Math.ceil(type.restAfterMinutes / (24 * 60))
}

export function isResting(
  shift: AnalyticsSourceShift,
  type: AnalyticsDutyType | undefined,
  onDate: string,
): boolean {
  if (shift.stateCode !== 'COMPLETED') return false
  const days = restDays(type)
  if (days === 0) return false
  return onDate > shift.businessDate && onDate <= addDays(shift.businessDate, days)
}

/**
 * Конфликты (§21.34/§22.7). Считаются ТЕМ ЖЕ способом, что в плане дежурств:
 * пересечение в один день — всегда жёсткий; нарушение обязательного отдыха —
 * severity берётся у ВИДА дежурства, а не назначается здесь.
 *
 * ⚠️ Отменённые смены выбывают из расчёта: отмена не должна продолжать
 * блокировать планирование (тот же вывод, что A66).
 *
 * Возвращает идентификаторы смен, а не количество: §22.12 требует, чтобы за
 * каждым числом стояла разрешённая выборка со стабильными ID, — число тогда
 * получается из выборки, а не наоборот.
 */
export function detectConflictShiftIds(
  shifts: readonly AnalyticsSourceShift[],
  types: readonly AnalyticsDutyType[],
  restMode: AnalyticsRestMode,
): { hard: string[]; soft: string[] } {
  const typeByCode = new Map(types.map((type) => [type.dutyTypeCode, type]))
  const active = shifts.filter((shift) => shift.stateCode !== 'CANCELLED')
  const byEmployee = new Map<string, AnalyticsSourceShift[]>()
  for (const shift of active) {
    const list = byEmployee.get(shift.employeeName) ?? []
    list.push(shift)
    byEmployee.set(shift.employeeName, list)
  }

  const hard = new Set<string>()
  const soft = new Set<string>()
  for (const list of byEmployee.values()) {
    const sorted = [...list].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const first = sorted[i]
        const second = sorted[j]
        if (first.businessDate === second.businessDate) {
          hard.add(first.id)
          hard.add(second.id)
          continue
        }
        const type = typeByCode.get(first.dutyTypeCode)
        const days = restDays(type)
        if (days === 0) continue
        if (second.businessDate <= addDays(first.businessDate, days)) {
          // Нарушение принадлежит ВТОРОЙ смене пары — она заступает раньше
          // положенного; первая свою обязанность не нарушала.
          const target = restMode === 'HARD_BLOCK' ? hard : soft
          target.add(second.id)
        }
      }
    }
  }
  // Смена, попавшая в оба набора, остаётся жёсткой: показывать её мягкой значило
  // бы занизить severity, а §21.34 запрещает выводить severity на фронте — тем
  // более занижать её на сервере.
  for (const id of hard) soft.delete(id)
  return { hard: [...hard].sort(), soft: [...soft].sort() }
}

/** §22.3: состояние показателя — по СЕРВЕРНЫМ порогам из определения. */
export function metricState(value: number | null, definition: MetricDefinition): MetricState {
  if (value === null) return 'UNKNOWN'
  if (definition.criticalFrom !== null && value >= definition.criticalFrom) return 'CRITICAL'
  if (definition.warningFrom !== null && value >= definition.warningFrom) return 'WARNING'
  return 'NORMAL'
}

export function displayValue(value: number | null, unit: MetricDefinition['unit']): string {
  if (value === null) return 'нет данных'
  if (unit === 'PERCENT') return `${value}%`
  if (unit === 'MINUTES') return `${value} мин`
  if (unit === 'HOURS') return `${value} ч`
  return String(value)
}

/**
 * Сборка показателя. `value === null` означает «посчитать не удалось», и это
 * НЕ ноль: §35 отдельно запрещает подменять отсутствие данных нулём — «0
 * конфликтов» и «конфликты неизвестны» человек прочитает по-разному.
 */
export function buildMetric(definition: MetricDefinition, value: number | null): MetricValue {
  return {
    metricCode: definition.metricCode,
    safeLabel: definition.safeLabel,
    value,
    displayValue: displayValue(value, definition.unit),
    unit: definition.unit,
    state: metricState(value, definition),
    // Раскрывать нечего, если значение неизвестно: кнопка drill-down у
    // непосчитанного показателя вела бы к пустой выборке и читалась бы как
    // «строк нет», а не «показатель не посчитан».
    drilldownAvailable: definition.drilldownAvailable && value !== null,
    metricDefinitionVersion: METRIC_DEFINITION_VERSION,
  }
}

/**
 * §22.12 «Переход выполняется по стабильным ID» + «сохранять snapshotId».
 *
 * Идентификатор снимка ДЕТЕРМИНИРОВАН его входом (версия данных, период,
 * scope, версия расчёта): drill-down обязан относиться к тому же снимку, что и
 * показатель, а сравнить их можно только если id воспроизводим. Случайный id
 * различал бы два одинаковых снимка, а часы — делали бы его невоспроизводимым.
 */
export function buildSnapshotId(input: {
  revision: number
  from: string
  to: string
  scopeId: string
}): string {
  return `snap-${input.revision}-${input.from}-${input.to}-${input.scopeId}`
}

/** Курсор страницы выборки. Непрозрачен для экрана, но НЕ секретен: это просто
 * смещение — прятать его за хешем значило бы изображать защиту. */
export function encodeCursor(offset: number): string {
  return `offset:${offset}`
}

export function decodeCursor(cursor: string | null): number {
  if (cursor === null) return 0
  const match = /^offset:(\d+)$/.exec(cursor)
  return match === null ? 0 : Number(match[1])
}

const STATE_LABEL: Record<string, string> = {
  PLANNED: 'Запланировано',
  ACKNOWLEDGED: 'Ознакомлен',
  ACTIVE: 'На посту',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
}

/**
 * Строка выборки. Персональная детализация вырезается ЗДЕСЬ, на сервере
 * (§22.26/§22.30 «privacy suppressed»): скрыть ФИО в вёрстке значит всё равно
 * отдать его браузеру — тот же вывод, что параметры чужого отчёта (A74).
 */
export function toDrilldownRow(
  shift: AnalyticsSourceShift,
  personalDetailAllowed: boolean,
): DrilldownRow {
  return {
    rowId: shift.id,
    businessDate: shift.businessDate,
    objectLabel: shift.objectLabel,
    stateLabel: STATE_LABEL[shift.stateCode] ?? shift.stateCode,
    employeeLabel: personalDetailAllowed ? shift.employeeName : null,
  }
}

/** §35: показатели §22.7, которых demo-срез не даёт. */
export const UNAVAILABLE_METRICS = [
  {
    code: 'HEADCOUNT',
    label: 'Активный личный состав в scope',
    reason:
      'Численность приходит из кадрового источника, которого у Smart Josparlau нет: §22.7 сам исключает кадровые KPI и разрешает списочную численность только как read-only значение ВНЕШНЕГО источника, если оно есть в контракте. Его нет — и выводить число из числа сотрудников, попавших в смены, значило бы назвать личным составом тех, кого поставили в наряд.',
  },
  {
    code: 'AVAILABILITY',
    label: 'Доступно для назначения',
    reason:
      'Доступность складывается из кадровой недоступности (отпуск, больничный, командировка), которой в demo-модели нет (§21.30 называет эти слои недоступными по той же причине). Разница «все минус дежурящие» — не доступность, а её видимость.',
  },
  {
    code: 'WORKLOAD',
    label: 'Перегрузка по серверной политике',
    reason:
      'Политики нагрузки (норма часов на период, порог перегрузки) в demo-срезе не существует, а §22.5 прямо запрещает хардкодить порог перегрузки. Показатель без политики был бы числом без смысла.',
  },
  {
    code: 'SECURITY_EVENT_ENGAGED',
    label: 'Участвует в ОМ',
    reason:
      'Расстановка охранного мероприятия ведёт назначения в СВОЁМ пространстве идентификаторов, а дежурства — в своём; связь между ними только по ФИО, и склейка по строке дала бы ложные совпадения (A50). Число, посчитанное такой склейкой, нельзя перепроверить.',
  },
] as const

/** §35: блоки §22.6, которых в этом срезе нет. Блок «Требует внимания» §22.11
 * здесь БЫЛ и уехал: он реализован собственным детектором (`lib/attention.ts`)
 * и приезжает отдельным ресурсом. */
export const UNAVAILABLE_HEADER_BLOCKS = [
  {
    code: 'SCOPE_FILTER',
    label: 'Выбор scope и подразделения',
    reason:
      'RBAC demo-режима плоский, без организационного scope (§8.9): выбирать не из чего, а список из одного пункта «вся организация» изображал бы выбор, которого нет. §22.26 при этом требует, чтобы недоступный scope не появлялся даже в списке фильтров, — здесь его и нет.',
  },
  {
    code: 'EXPORT',
    label: 'Экспорт аналитики из шапки',
    reason:
      'Выгрузка живёт отдельным разделом с собственной очередью, артефактом и сроком хранения (§22.18-22.25, реализовано): вторая кнопка экспорта здесь создала бы второй путь к тем же файлам мимо истории отчётов.',
  },
] as const
