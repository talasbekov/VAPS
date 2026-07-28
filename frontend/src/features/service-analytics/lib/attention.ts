// Серверные детекторы блока «Требует внимания» (§22.11). Чистая модель: ни
// React, ни apiClient — тестируется в env node.
//
// ⚠️ ГЛАВНОЕ ОТЛИЧИЕ ОТ ПОКАЗАТЕЛЕЙ. Соблазн был собрать блок из уже
// посчитанных KPI («конфликтов 3 — значит внимание»), и это было бы
// ПЕРЕСТАНОВКОЙ ЧИСЕЛ ЭКРАНА, выданной за серверное наблюдение. §22.11 требует
// обратного: каждый элемент возвращает сервер, у него СВОИ `policyVersion` и
// `detectedAt`. Поэтому здесь свои предикаты, своя политика порогов и своя
// версия — ни один детектор не читает `MetricValue`.
//
// Отличие видно на каждом детекторе:
// * «требуется проверка» смотрит на ОТСУТСТВИЕ ОТМЕТКИ перед заступлением —
//   такого показателя в §22.7 нет вовсе;
// * «превышение порога» считает ДОЛЮ конфликтных смен, а не их количество:
//   три конфликта на четыре смены и три на сорок — разные наблюдения, хотя
//   KPI в обоих случаях покажет «3»;
// * «незавершённые процессы» и «данные не подтверждены» требуют ВЫДЕРЖКИ
//   (смена просрочена дольше допуска) — KPI считает их с первого дня.
import { addDays, detectConflictShiftIds, inPeriod, isUnconfirmed } from './analytics'
import type { AnalyticsSource } from './analytics'
import type { AttentionItem, AttentionSeverity } from '../model/types'

/** Версия политики НАБЛЮДЕНИЙ. Своя и намеренно НЕ равна `POLICY_VERSION`
 * (пороги показателей): методики независимы, и менять их приходится порознь —
 * общая версия соврала бы, что изменилось и то, и другое. */
export const ATTENTION_POLICY_VERSION = 'attention-policy-2026.07.1'

/**
 * §22.11 «Используй формулировки» — РОВНО пять разрешённых. Заголовок элемента
 * берётся отсюда по коду, свободного текста в заголовке нет: именно в
 * заголовке обвинительный вывод и появился бы первым.
 */
export const ATTENTION_TITLES = {
  VERIFICATION_REQUIRED: 'Требуется проверка',
  DATA_UNCONFIRMED: 'Данные не подтверждены',
  THRESHOLD_EXCEEDED: 'Обнаружено превышение серверного порога',
  UNFINISHED_PROCESSES: 'Есть незавершённые процессы',
  SOURCE_NOT_UPDATED: 'Источник не обновлён',
} as const

export type AttentionTitleCode = keyof typeof ATTENTION_TITLES

export const ALLOWED_ATTENTION_TITLES: readonly string[] = Object.values(ATTENTION_TITLES)

/**
 * §22.11 «Не используй» — запрещённые формулировки, приведённые к признакам,
 * по которым их узнаёт тест. Держатся В КОДЕ, а не в описании теста, чтобы
 * проверять КАЖДЫЙ произведённый детектором текст, а не те, что попались на
 * глаза при чтении.
 */
export const FORBIDDEN_ATTENTION_PHRASES: readonly string[] = [
  'работает плохо',
  'нарушает дисциплину',
  'злоупотребля',
  'подозрительн',
]

/** Мера наблюдения. Единица измерения у каждой своя, и она НЕ равна единице
 * показателя: доля считается в процентах, возраст источника — в часах. */
export type AttentionMeasure =
  | 'ACKNOWLEDGEMENT_MISSING'
  | 'CONFLICT_SHARE'
  | 'UNFINISHED_OVERDUE'
  | 'UNCONFIRMED_OVERDUE'
  | 'SOURCE_AGE'

/**
 * Определение детектора. Пороги и допуски — В ДАННЫХ (тот же вывод, что у
 * порогов показателей §22.5 и интервала свежести паспорта §21.7): «внимание от
 * трёх случаев», зашитое в код, нельзя ни перенастроить, ни объяснить человеку.
 */
export interface AttentionDetectorDefinition {
  categoryCode: string
  measure: AttentionMeasure
  titleCode: AttentionTitleCode
  /** Текст наблюдения — тоже из данных. Плейсхолдеры `{count}` и
   * `{parameter}`: описание составляет СЕРВЕР, экран печатает его дословно. */
  safeDescriptionTemplate: string
  /** Допуск меры: дни выдержки, дни упреждения, часы устаревания. */
  parameter: number
  /** `null` у обоих порогов — мера бинарная, срабатывание само по себе и есть
   * наблюдение, а severity берётся из `baseSeverity`. */
  warningFrom: number | null
  criticalFrom: number | null
  baseSeverity: AttentionSeverity
  targetRoute: string | null
  targetPermission: string | null
}

/** Результат замера. `value` — то, что сравнивается с порогами; `count` — то,
 * что показывается человеку. Это РАЗНЫЕ числа у долевых мер, и разъехаться им
 * нельзя: доля решает, наблюдение это или нет, количество лишь называет объём. */
interface Measurement {
  value: number
  count: number | null
}

const HOUR_MS = 3_600_000

function measure(
  definition: AttentionDetectorDefinition,
  source: AnalyticsSource,
  context: { from: string; to: string; businessDate: string; generatedAt: string },
): Measurement | null {
  const inRange = source.shifts.filter((shift) =>
    inPeriod(shift.businessDate, context.from, context.to),
  )

  switch (definition.measure) {
    case 'ACKNOWLEDGEMENT_MISSING': {
      // Наблюдение о БЛИЖАЙШИХ заступлениях: отметки нет, а смена наступает
      // внутри срока упреждения. Смена через месяц без отметки — не повод
      // «требовать проверки»: срок ознакомления ещё не истёк.
      const horizon = addDays(context.businessDate, definition.parameter)
      const hits = inRange.filter(
        (shift) =>
          shift.stateCode === 'PLANNED' &&
          shift.businessDate >= context.businessDate &&
          shift.businessDate <= horizon,
      )
      return { value: hits.length, count: hits.length }
    }
    case 'CONFLICT_SHARE': {
      // ДОЛЯ, а не количество: KPI конфликтов покажет «3» и на четырёх сменах,
      // и на сорока — а это разные наблюдения. Знаменатель — смены периода;
      // при пустом периоде наблюдения нет вовсе (0/0 — не «ноль процентов»).
      if (inRange.length === 0) return null
      const conflicts = detectConflictShiftIds(inRange, source.dutyTypes, source.restMode)
      const affected = conflicts.hard.length + conflicts.soft.length
      return {
        value: Math.round((affected / inRange.length) * 100),
        count: affected,
      }
    }
    case 'UNFINISHED_OVERDUE': {
      // Выдержка: смена прошла дольше допуска и не закрыта. Сегодняшняя и
      // вчерашняя незакрытая смена — обычный ход работы, а не наблюдение.
      const deadline = addDays(context.businessDate, -definition.parameter)
      const hits = inRange.filter(
        (shift) =>
          shift.businessDate < deadline &&
          shift.stateCode !== 'COMPLETED' &&
          shift.stateCode !== 'CANCELLED',
      )
      return { value: hits.length, count: hits.length }
    }
    case 'UNCONFIRMED_OVERDUE': {
      const deadline = addDays(context.businessDate, -definition.parameter)
      const hits = inRange.filter(
        (shift) => shift.businessDate < deadline && isUnconfirmed(shift),
      )
      return { value: hits.length, count: hits.length }
    }
    case 'SOURCE_AGE': {
      // Утверждение об ИСТОЧНИКЕ, а не о людях: сколько часов назад он менялся
      // последний раз. Считать тут нечего — `count` остаётся `null`.
      const latest = source.shifts.reduce(
        (max, shift) => (shift.updatedAt > max ? shift.updatedAt : max),
        '',
      )
      if (latest === '') return null
      const ageMs = new Date(context.generatedAt).getTime() - new Date(latest).getTime()
      return { value: Math.max(0, Math.floor(ageMs / HOUR_MS)), count: null }
    }
  }
}

/** Срабатывание. Без порогов мера бинарная: наблюдение есть, если есть хоть
 * один случай. С порогами — от нижнего заданного, иначе элемент появлялся бы
 * раньше собственной политики. */
function fires(definition: AttentionDetectorDefinition, value: number): boolean {
  const thresholds = [definition.warningFrom, definition.criticalFrom].filter(
    (item): item is number => item !== null,
  )
  if (thresholds.length === 0) return value > 0
  return value >= Math.min(...thresholds)
}

function severityOf(
  definition: AttentionDetectorDefinition,
  value: number,
): AttentionSeverity {
  if (definition.criticalFrom !== null && value >= definition.criticalFrom) return 'CRITICAL'
  if (definition.warningFrom !== null && value >= definition.warningFrom) return 'WARNING'
  return definition.baseSeverity
}

function renderDescription(
  definition: AttentionDetectorDefinition,
  measurement: Measurement,
): string {
  return definition.safeDescriptionTemplate
    .replaceAll('{count}', measurement.count === null ? '—' : String(measurement.count))
    .replaceAll('{parameter}', String(definition.parameter))
    .replaceAll('{value}', String(measurement.value))
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
}

/** Администрируемые числа детектора (владелец — раздел «Настройки», §29). */
export interface AttentionPolicyValues {
  parameter?: number
  warningFrom?: number
  criticalFrom?: number
}

/**
 * Наложение администрируемой политики на определения детекторов. Методика
 * (мера, текст наблюдения, маршрут перехода) остаётся здесь; допуски и пороги
 * приходят из раздела «Настройки» — там их меняют, с журналом и версией.
 *
 * Политики нет — детекторов нет: вернуть их с зашитыми числами значило бы
 * наблюдать по методике, которую никто не администрирует, и выдать результат
 * за действующую политику. Вызывающий обязан объяснить пустоту (§35).
 *
 * Детектор, чьих значений в политике нет, сохраняет собственные: это не
 * «сброс в ноль», а отсутствие администрируемой записи именно для него.
 */
export function applyAttentionPolicy(
  definitions: readonly AttentionDetectorDefinition[],
  policy: { byDetector: ReadonlyMap<string, AttentionPolicyValues> } | null,
): AttentionDetectorDefinition[] {
  if (policy === null) return []
  return definitions.map((definition) => {
    const values = policy.byDetector.get(definition.categoryCode)
    if (values === undefined) return definition
    return {
      ...definition,
      parameter: values.parameter ?? definition.parameter,
      warningFrom: values.warningFrom ?? definition.warningFrom,
      criticalFrom: values.criticalFrom ?? definition.criticalFrom,
    }
  })
}

/**
 * Сборка блока. Порядок задаёт СЕРВЕР (severity, затем код категории): §22.11
 * отдаёт элементы готовыми, и пересортировка на экране сделала бы порядок
 * свойством вёрстки — то есть разным у двух клиентов одного ответа.
 */
export function buildAttentionItems(
  definitions: readonly AttentionDetectorDefinition[],
  source: AnalyticsSource,
  context: {
    from: string
    to: string
    businessDate: string
    generatedAt: string
    snapshotId: string
    scopeLabel: string | null
    /** Версия ДЕЙСТВУЮЩЕЙ политики (владелец — «Настройки», §29). Приходит
     * снаружи, а не берётся константой: элемент и ответ обязаны говорить об
     * одной методике, иначе элемент сослался бы на политику, по которой его
     * уже не считали. */
    policyVersion: string
  },
): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const definition of definitions) {
    const measurement = measure(definition, source, context)
    if (measurement === null) continue
    if (!fires(definition, measurement.value)) continue
    items.push({
      // Идентификатор ДЕТЕРМИНИРОВАН снимком и категорией: один и тот же
      // снимок обязан давать те же элементы (иначе их нельзя ни сверить, ни
      // сослаться на них), а случайный id различал бы одинаковые наблюдения.
      attentionId: `att-${context.snapshotId}-${definition.categoryCode}`,
      categoryCode: definition.categoryCode,
      severity: severityOf(definition, measurement.value),
      safeTitle: ATTENTION_TITLES[definition.titleCode],
      safeDescription: renderDescription(definition, measurement),
      count: measurement.count,
      scopeLabel: context.scopeLabel,
      targetRoute: definition.targetRoute,
      targetPermission: definition.targetPermission,
      detectedAt: context.generatedAt,
      policyVersion: context.policyVersion,
    })
  }
  return items.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.categoryCode.localeCompare(b.categoryCode),
  )
}

/** §35: наблюдения §22.11, которых demo-срез не даёт. */
export const UNAVAILABLE_DETECTORS = [
  {
    code: 'WORKLOAD_EXCESS',
    label: 'Превышение нормы нагрузки',
    reason:
      'Нормы часов на период и порога перегрузки в demo-срезе не существует (§22.5 прямо запрещает хардкодить порог перегрузки). Детектор без политики выдавал бы за наблюдение произвольное число.',
  },
  {
    code: 'ABSENCE_PATTERN',
    label: 'Отклонения по кадровой недоступности',
    reason:
      'Кадровой недоступности (отпуск, больничный, командировка) в модели нет — той же причиной закрыты слои матрицы §21.30. А наблюдение о больничных без источника было бы ровно тем обвинительным выводом, который §22.11 запрещает.',
  },
] as const
