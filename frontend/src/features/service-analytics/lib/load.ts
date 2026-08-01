// Аналитика нагрузки (§22.9). Чистый расчёт: ни React, ни transport.
//
// ДВЕ СУММЫ, КОТОРЫЕ НЕ СМЕШИВАЮТСЯ. §22.9: «План рассчитывается по
// назначениям. Факт — по подтверждённому фактическому участию. Не подставляй
// план вместо факта». Здесь они считаются разными проходами и лежат разными
// полями; `loadState` красится ТОЛЬКО по плановой сумме — плановая перегрузка
// и есть то, что аналитика нагрузки должна показать планировщику, а факт
// печатается рядом как есть.
//
// Пороги и окно приходят из раздела «Настроек» LOAD_POLICY (§22.5 запрещает
// хардкодить порог перегрузки): политики нет → каждая строка `UNKNOWN`, а не
// «нормально». Frontend-правил вида «больше N смен за месяц» здесь нет —
// ровно их §22.9 велит удалить.
import type { AnalyticsSource, AnalyticsSourceShift } from './analytics'

export interface LoadPolicyView {
  periodDays: number
  warningMinutes: number
  overloadMinutes: number
  policyVersion: string
}

export type LoadState = 'NORMAL' | 'WARNING' | 'OVERLOADED' | 'UNKNOWN'

/** §22.9 `LoadMetric`. `nightMinutes` всегда `null` — см. `LOAD_UNAVAILABLE`. */
export interface LoadMetric {
  employeeId: string | null
  /** Безопасная подпись строки (подразделение или сотрудник). */
  safeLabel: string
  organizationUnitId: string
  plannedMinutes: number | null
  actualMinutes: number | null
  nightMinutes: number | null
  loadState: LoadState
  safeReasonCodes: string[]
  policyVersion: string | null
}

export interface LoadAnalyticsView {
  units: LoadMetric[]
  employees: LoadMetric[]
  /** Смены окна, у которых связь §22.9 не установлена (`employeeId === null`). */
  unlinkedShiftsCount: number
  policy: LoadPolicyView | null
}

/** §35: слагаемые §22.9, которых demo-срез не даёт. */
export const LOAD_UNAVAILABLE: readonly { code: string; label: string; reason: string }[] = [
  {
    code: 'NIGHT_MINUTES',
    label: 'Ночные часы',
    reason:
      'Граница дневной и ночной работы — открытый вопрос самого промпта (NIGHT-WINDOW-001): источника окна нет, и завести его решением фронта значило бы закрыть чужой вопрос молча. Ночные минуты едут null, а не нулём.',
  },
  {
    code: 'SECURITY_EVENT_LOAD',
    label: 'Нагрузка от охранных мероприятий',
    reason:
      'Назначения расстановки ОМ не несут интервалов времени (пост расчёта — строка без часов), складывать их с минутами смен не из чего. Слагаемое отсутствует, а не подменено допущением.',
  },
  {
    code: 'REST_AND_REPLACEMENTS',
    label: 'Отдых, замены и неподтверждённые факты',
    reason:
      'Отдельных read model отдыха и замен в demo-срезе нет (§21.35 живёт правилом конфликтов, а не журналом интервалов). Считать их из смен косвенно значило бы выдать вывод за данные.',
  },
]

function minutesBetween(startIso: string, endIso: string): number {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0
  return Math.round((end - start) / 60_000)
}

function addDaysIso(businessDate: string, days: number): string {
  const parsed = new Date(`${businessDate}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

/** Смены ОКНА: от `businessDate - periodDays + 1` до бизнес-даты включительно. */
function inWindow(shift: AnalyticsSourceShift, businessDate: string, periodDays: number): boolean {
  const from = addDaysIso(businessDate, -(periodDays - 1))
  return shift.businessDate >= from && shift.businessDate <= businessDate
}

function resolveState(planned: number, policy: LoadPolicyView): LoadState {
  if (planned >= policy.overloadMinutes) return 'OVERLOADED'
  if (planned >= policy.warningMinutes) return 'WARNING'
  return 'NORMAL'
}

function stateReasons(state: LoadState): string[] {
  if (state === 'OVERLOADED') return ['PLANNED_OVERLOAD']
  if (state === 'WARNING') return ['PLANNED_WARNING']
  return []
}

/**
 * §22.9. План: смены PLANNED/ACKNOWLEDGED/ACTIVE/COMPLETED окна — назначение
 * остаётся назначением и после исполнения; ОТМЕНЁННАЯ смена не входит никуда
 * («отменённое назначение не входит в actual», и плановую нагрузку она больше
 * не создаёт). Факт: только COMPLETED с обоими фактическими штампами.
 */
export function buildLoadAnalytics(
  source: AnalyticsSource,
  policy: LoadPolicyView | null,
  businessDate: string,
): LoadAnalyticsView {
  const durationByType = new Map(
    source.dutyTypes.map((type) => [type.dutyTypeCode, type.defaultDurationMinutes]),
  )

  interface Bucket {
    employeeId: string | null
    safeLabel: string
    organizationUnitId: string
    planned: number
    actual: number
  }
  const unitBuckets = new Map<string, Bucket>()
  const employeeBuckets = new Map<string, Bucket>()
  let unlinked = 0

  // Политики нет — окна нет: фильтровать «за последние N суток» было бы
  // выдумыванием N. Строки строятся по ВСЕМ неотменённым сменам, но значения
  // едут null, а состояние — UNKNOWN: «посчитать нельзя», не «нормально».
  const windowShifts = source.shifts.filter(
    (shift) =>
      shift.stateCode !== 'CANCELLED' &&
      (policy === null || inWindow(shift, businessDate, policy.periodDays)),
  )
  for (const shift of windowShifts) {
    const planned = durationByType.get(shift.dutyTypeCode) ?? 0
    const actual =
      shift.stateCode === 'COMPLETED' && shift.actualStart !== null && shift.actualEnd !== null
        ? minutesBetween(shift.actualStart, shift.actualEnd)
        : 0
    if (shift.employeeId === null || shift.unitId === null) {
      // Связь §22.9 не установлена: сумма без владельца поехала бы в чужую
      // строку. Смена считается ОТДЕЛЬНО и видна счётчиком, а не теряется.
      unlinked += 1
      continue
    }
    const unit = unitBuckets.get(shift.unitId) ?? {
      employeeId: null,
      safeLabel: source.unitLabels[shift.unitId] ?? shift.unitId,
      organizationUnitId: shift.unitId,
      planned: 0,
      actual: 0,
    }
    unit.planned += planned
    unit.actual += actual
    unitBuckets.set(shift.unitId, unit)

    const employee = employeeBuckets.get(shift.employeeId) ?? {
      employeeId: shift.employeeId,
      safeLabel: shift.employeeName,
      organizationUnitId: shift.unitId,
      planned: 0,
      actual: 0,
    }
    employee.planned += planned
    employee.actual += actual
    employeeBuckets.set(shift.employeeId, employee)
  }

  const toMetric = (bucket: Bucket): LoadMetric => {
    if (policy === null) {
      return {
        employeeId: bucket.employeeId,
        safeLabel: bucket.safeLabel,
        organizationUnitId: bucket.organizationUnitId,
        // §19.19-принцип тот же: неизвестность не превращается в ноль.
        plannedMinutes: null,
        actualMinutes: null,
        nightMinutes: null,
        loadState: 'UNKNOWN',
        safeReasonCodes: ['POLICY_UNDEFINED'],
        policyVersion: null,
      }
    }
    const state = resolveState(bucket.planned, policy)
    return {
      employeeId: bucket.employeeId,
      safeLabel: bucket.safeLabel,
      organizationUnitId: bucket.organizationUnitId,
      plannedMinutes: bucket.planned,
      actualMinutes: bucket.actual,
      nightMinutes: null,
      loadState: state,
      safeReasonCodes: stateReasons(state),
      policyVersion: policy.policyVersion,
    }
  }

  // Порядок задаёт сервер и задаёт его ПО ПОДПИСИ: сортировка по величине
  // нагрузки была бы таблицей «кто перегружен», собранной без запроса.
  const units = [...unitBuckets.values()]
    .map(toMetric)
    .sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, 'ru'))
  const employees = [...employeeBuckets.values()]
    .map(toMetric)
    .sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, 'ru'))

  return { units, employees, unlinkedShiftsCount: unlinked, policy }
}
