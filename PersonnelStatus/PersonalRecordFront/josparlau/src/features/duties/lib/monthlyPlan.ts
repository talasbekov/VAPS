// Месячный план дежурств (§21.27-21.30, §21.34-21.35). Чистая модель: ни
// React, ни apiClient — тестируется в env node.
//
// ⚠️ ЧТО ЭТОТ МОДУЛЬ СОЗНАТЕЛЬНО НЕ ДЕЛАЕТ. §21.29 требует показывать
// СЕРВЕРНЫЕ значения KPI и прямо запрещает «вычислять итог по отрисованной
// части календаря», §21.34 — «frontend не определяет severity самостоятельно».
// Поэтому и KPI, и конфликты считаются ЗДЕСЬ, а вызывается это из
// mock-repository (наш «сервер»), не из компонента: страница получает готовые
// числа и готовую severity и только рисует их. Если однажды появится
// настоящий backend, этот модуль уезжает на него целиком, а контракт ответа
// (`MonthlyDutyPlanResponse`) остаётся тем же.
//
// Арифметика дат — только через `Date.UTC`, без локального `new Date(строка)`:
// businessDate — календарный день канона (+05), а не момент времени, и разбор
// его в локальной зоне сдвигал бы день на машинах в минусовых таймзонах
// (см. feedback-vaps-date-guard-needs-negative-tz).
import type { ConflictPolicy, DutyShift, DutyTypeDefinition } from '../model/types'

/** §21.34: severity назначает сервер. Три уровня промпта — HARD (нельзя
 * обойти), SOFT (обход по отдельному permission с обоснованием), Warning
 * (сохранение возможно без override). Warning в этом срезе не заводится:
 * единственный его кандидат — устаревшая версия паспорта — уже показан
 * построчно в «Плане дежурств» (§9.6), дублировать его в конфликтах значило
 * бы завести второго владельца одного и того же факта. */
export type DutyConflictSeverity = 'HARD' | 'SOFT'

export type DutyConflictCode = 'DUTY_OVERLAP' | 'REST_AFTER_DUTY'

export interface MonthlyDutyPlanConflict {
  conflictId: string
  code: DutyConflictCode
  severity: DutyConflictSeverity
  employeeName: string
  /** День, В КОТОРОМ конфликт проявляется (для отдыха — день второго дежурства). */
  businessDate: string
  message: string
  /**
   * Версия правил, ПО КОТОРЫМ посчитана `severity`. Стоит в КАЖДОМ конфликте, а
   * не только в ответе: конфликт живёт дальше ответа (уезжает в диалог обхода,
   * в протокол, в месячный план), и там уже нечем сверить, какой редакцией
   * правил он объявлен. `null` — политика не прочитана, применён строгий
   * дефолт §21.35.
   */
  policyVersion: string | null
}

export interface MonthlyDutyPlanCell {
  date: string
  /** БЕЗ отменённых: отменённая смена никого не занимает. */
  shiftCount: number
  /** Отменённые считаются ОТДЕЛЬНО, а не отбрасываются молча: пустая клетка
   * там, где планирование было и было отменено, читалась бы как «не
   * планировали» (§35). */
  cancelledCount: number
  /** Дежурства в состоянии PLANNED — §21.29 «Без ознакомления». */
  notAcknowledgedCount: number
  completedCount: number
  hardConflictCount: number
  softConflictCount: number
}

export interface MonthlyDutyPlanRow {
  objectId: string
  objectLabel: string
  cells: MonthlyDutyPlanCell[]
}

/** §21.29. Ровно те показатели, которые выводимы из модели; всё остальное —
 * в `unavailableMetrics`, а не нулём и не прочерком. */
export interface MonthlyDutyPlanKpi {
  objectsInPlan: number
  /** БЕЗ отменённых — см. `MonthlyDutyPlanCell.shiftCount`. */
  shifts: number
  cancelled: number
  notAcknowledged: number
  completed: number
  hardConflicts: number
  softConflicts: number
}

/** §35: показатель, который прототип называет, а модель не выдаёт. Показывается
 * текстом с причиной — молчаливый ноль читался бы как «посчитали, вышло 0». */
export interface UnavailableMetric {
  code: string
  label: string
  reason: string
}

/**
 * §21.30 «По сотрудникам — матрица доступности». Промпт называет ШЕСТЬ слоёв:
 * дежурство, отдых после дежурства, ОМ, кадровая недоступность, конфликт,
 * неполные данные. Модель проекта даёт ЧЕТЫРЕ — они и рисуются; недостающие
 * два приходят в `unavailableLayers` с причиной (§35), а не молчат.
 *
 * `DUTY` доминирует над `REST`: если в день и дежурство, и «хвост» отдыха от
 * предыдущего, сотрудник прежде всего дежурит — а нарушение отдыха при этом уже
 * названо конфликтом, вторым способом его показывать не нужно.
 */
export type DutyEmployeeDayLayer = 'DUTY' | 'REST' | 'FREE'

export interface MonthlyDutyEmployeeCell {
  date: string
  layer: DutyEmployeeDayLayer
  /** Сколько дежурств у сотрудника в этот день (без отменённых). */
  dutyCount: number
  hardConflictCount: number
  softConflictCount: number
  /**
   * §21.30 «неполные данные» — у дежурства этого дня нет привязки к версии
   * паспорта (§9.6). Это факт планирования, а не пустая клетка.
   */
  incompleteData: boolean
}

export interface MonthlyDutyEmployeeRow {
  employeeName: string
  cells: MonthlyDutyEmployeeCell[]
}

export interface MonthlyDutyPlan {
  /** YYYY-MM. */
  month: string
  /** Все календарные дни месяца, YYYY-MM-DD. */
  days: string[]
  rows: MonthlyDutyPlanRow[]
  /** §21.30, второе представление ТОГО ЖЕ набора смен (§21.4 «представления
   * одного набора данных»). Приходит в том же ответе, а не отдельным запросом:
   * два представления одного месяца обязаны быть посчитаны по ОДНОМУ снимку,
   * иначе они разойдутся между собой. */
  employeeRows: MonthlyDutyEmployeeRow[]
  kpi: MonthlyDutyPlanKpi
  conflicts: MonthlyDutyPlanConflict[]
  unavailableMetrics: UnavailableMetric[]
  /** Правила, по которым посчитаны конфликты месяца. */
  conflictPolicy: ConflictPolicy
  /** §35: слои §21.30, которых модель не даёт. */
  unavailableLayers: UnavailableMetric[]
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month)
}

/** Месяц (YYYY-MM), которому принадлежит календарный день. */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function daysInMonth(month: string): string[] {
  const year = Number(month.slice(0, 4))
  const monthIndex = Number(month.slice(5, 7))
  // День 0 следующего месяца = последний день этого (UTC — см. шапку файла).
  const count = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  const days: string[] = []
  for (let day = 1; day <= count; day += 1) {
    days.push(`${month}-${String(day).padStart(2, '0')}`)
  }
  return days
}

/** Сдвиг календарного дня на N суток. Используется и сидом демо-данных. */
export function addDays(date: string, amount: number): string {
  const year = Number(date.slice(0, 4))
  const monthIndex = Number(date.slice(5, 7)) - 1
  const day = Number(date.slice(8, 10))
  const shifted = new Date(Date.UTC(year, monthIndex, day + amount))
  return shifted.toISOString().slice(0, 10)
}

/** Полных суток между двумя календарными днями (b - a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

function hoursLabel(minutes: number): string {
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} ч` : `${minutes} мин`
}

export function overlapMessage(employeeName: string, date: string, shiftCount: number): string {
  return `${employeeName}: ${shiftCount} дежурства в один день (${date}).`
}

export function restMessage(
  employeeName: string,
  previousDate: string,
  nextDate: string,
  restAfterMinutes: number,
): string {
  return `${employeeName}: дежурство ${nextDate} начинается до конца обязательного отдыха (${hoursLabel(restAfterMinutes)}) после дежурства ${previousDate}.`
}

/**
 * §21.34/§21.35. Считается по ВСЕМУ набору смен, а не по выбранному месяцу:
 * дежурство 1-го числа конфликтует с дежурством последнего числа предыдущего
 * месяца, и обрезав вход месяцем, мы бы такой конфликт молча потеряли.
 * Фильтрация по месяцу — только на выдаче.
 *
 * СРОК отдыха (`restAfterMinutes`) берётся у вида дежурства ПРЕДЫДУЩЕЙ смены:
 * обязательный отдых — свойство отработанного дежурства, а не следующего. Вид
 * дежурства, которого нет в реестре, отдыха не навязывает (нечего читать — не
 * выдумываем 24 часа, §21.35 «не хардкодь 24 часа»).
 *
 * РЕЖИМ (`HARD_BLOCK` / `SOFT_OVERRIDE`) приходит из `policy` — глобальной
 * политики §21.35, которой владеет раздел «Настройки» (§29 `conflict rules`).
 * Раньше он был атрибутом вида дежурства: разные виды блокировали по-разному,
 * то есть действующей политики, которую §21.35 велит читать, не существовало и
 * администрировать её было негде.
 */
export function detectConflicts(
  shifts: readonly DutyShift[],
  dutyTypes: readonly DutyTypeDefinition[],
  policy: ConflictPolicy,
): MonthlyDutyPlanConflict[] {
  const typeByCode = new Map(dutyTypes.map((type) => [type.dutyTypeCode, type]))
  const byEmployee = new Map<string, DutyShift[]>()
  // Отменённая смена не занимает сотрудника: она не пересекается с другой и не
  // требует отдыха после себя. Иначе отмена «лечила» бы план на экране, но
  // продолжала блокировать планирование — худший из возможных исходов.
  for (const shift of shifts.filter((candidate) => candidate.stateCode !== 'CANCELLED')) {
    const bucket = byEmployee.get(shift.employeeName) ?? []
    bucket.push(shift)
    byEmployee.set(shift.employeeName, bucket)
  }

  const conflicts: MonthlyDutyPlanConflict[] = []
  for (const [employeeName, employeeShifts] of [...byEmployee.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const byDate = new Map<string, DutyShift[]>()
    for (const shift of employeeShifts) {
      const bucket = byDate.get(shift.businessDate) ?? []
      bucket.push(shift)
      byDate.set(shift.businessDate, bucket)
    }
    const dates = [...byDate.keys()].sort()

    for (const date of dates) {
      const sameDay = byDate.get(date) ?? []
      if (sameDay.length > 1) {
        conflicts.push({
          conflictId: `overlap:${employeeName}:${date}`,
          code: 'DUTY_OVERLAP',
          // §21.34 «пересечение с другим дежурством» — hard, обойти нельзя:
          // тот же принцип, что hard-rule двойного назначения в расстановке ОМ
          // и в боевых группах (§24.17). Правило показано в «Настройках»
          // запертым (§29): режим у него не переключается ни для кого.
          severity: 'HARD',
          employeeName,
          businessDate: date,
          message: overlapMessage(employeeName, date, sameDay.length),
          policyVersion: policy.conflictPolicyVersion,
        })
      }
    }

    for (let index = 1; index < dates.length; index += 1) {
      const previousDate = dates[index - 1]
      const nextDate = dates[index]
      // Отдых отсчитывается от КОНЦА предыдущего дня дежурства, следующее
      // дежурство начинается в начале своего дня: между ними ровно
      // (разница в сутках − 1) полных суток.
      const freeMinutes = (daysBetween(previousDate, nextDate) - 1) * 24 * 60
      for (const previous of byDate.get(previousDate) ?? []) {
        const type = typeByCode.get(previous.dutyTypeCode)
        if (type === undefined || type.restAfterMinutes <= 0) continue
        if (freeMinutes >= type.restAfterMinutes) continue
        conflicts.push({
          conflictId: `rest:${employeeName}:${previousDate}:${nextDate}`,
          code: 'REST_AFTER_DUTY',
          severity: policy.restAfterDutyMode === 'HARD_BLOCK' ? 'HARD' : 'SOFT',
          employeeName,
          businessDate: nextDate,
          message: restMessage(employeeName, previousDate, nextDate, type.restAfterMinutes),
          policyVersion: policy.conflictPolicyVersion,
        })
        break
      }
    }
  }

  return conflicts.sort(
    (a, b) => a.businessDate.localeCompare(b.businessDate) || a.conflictId.localeCompare(b.conflictId),
  )
}

/** §35: показатели прототипа (§21.30 «укомплектовано 4/4», «были замены»),
 * которых нет в модели суточного дежурства. Список — часть ответа, а не текст
 * в вёрстке: причина принадлежит серверу, который знает, чего у него нет. */
export const UNAVAILABLE_MONTHLY_METRICS: readonly UnavailableMetric[] = [
  {
    code: 'STAFFING_COMPLETENESS',
    label: 'Укомплектовано / частично / не укомплектовано',
    reason:
      'У суточного дежурства нет требуемой численности на объект (requiredEmployees заведён только у боевых групп) — доля укомплектованности была бы выдумана.',
  },
  {
    code: 'REPLACEMENTS',
    label: 'Были замены',
    reason:
      'История замен ведётся только у боевых групп (§24.21); у суточных дежурств замены не реализованы.',
  },
]

/** §21.30, слои матрицы доступности, которых в demo-модели нет НИ В КАКОМ виде. */
export const UNAVAILABLE_EMPLOYEE_LAYERS: readonly UnavailableMetric[] = [
  {
    code: 'SECURITY_EVENT_LAYER',
    label: 'Занятость охранным мероприятием',
    reason:
      'Расстановка ОМ живёт в другой фиче и в другом ID-пространстве сотрудников: склейка по ФИО дала бы ложные совпадения (см. FRONTEND_DECISIONS A44-A46/A50), а не «нет занятости».',
  },
  {
    code: 'HR_UNAVAILABILITY_LAYER',
    label: 'Кадровая недоступность (отпуск, больничный, командировка)',
    reason:
      'Employee Status Repository в demo-срезе отсутствует. §21.30 при этом требует заменять чувствительную причину подписью «Недоступен» — маскировать нечего, слоя нет вовсе.',
  },
]

/**
 * §21.30 «Сотрудник × календарный день».
 *
 * Отдых считается ОТ ДЕЖУРСТВА: смена на дне D закрывает следующие
 * `ceil(restAfterMinutes / сутки)` дней. Длительность берётся у вида ДЕЖУРСТВА,
 * а не константой (§21.35 «не хардкодь 24 часа»); вид вне реестра отдыха не
 * навязывает. Хвост отдыха, попавший в соседний месяц, обрезается на выдаче —
 * ровно как у конфликтов, поэтому вход тут ВЕСЬ набор смен, а не месячный срез.
 */
export function buildEmployeeRows(
  month: string,
  shifts: readonly DutyShift[],
  dutyTypes: readonly DutyTypeDefinition[],
  conflicts: readonly MonthlyDutyPlanConflict[],
): MonthlyDutyEmployeeRow[] {
  const days = daysInMonth(month)
  const typeByCode = new Map(dutyTypes.map((type) => [type.dutyTypeCode, type]))
  const active = shifts.filter((shift) => shift.stateCode !== 'CANCELLED')

  const byEmployee = new Map<string, DutyShift[]>()
  for (const shift of active) {
    const bucket = byEmployee.get(shift.employeeName) ?? []
    bucket.push(shift)
    byEmployee.set(shift.employeeName, bucket)
  }

  const conflictCounts = new Map<string, { hard: number; soft: number }>()
  for (const conflict of conflicts) {
    const key = `${conflict.employeeName}|${conflict.businessDate}`
    const current = conflictCounts.get(key) ?? { hard: 0, soft: 0 }
    if (conflict.severity === 'HARD') current.hard += 1
    else current.soft += 1
    conflictCounts.set(key, current)
  }

  return [...byEmployee.entries()]
    // В матрицу попадает только сотрудник, у которого В ЭТОМ месяце есть
    // дежурство или хвост отдыха: строка из одних «свободен» не сообщает
    // ничего, а полный список личного состава фича и не знает (A26/A35).
    .map(([employeeName, employeeShifts]) => {
      const restDays = new Set<string>()
      for (const shift of employeeShifts) {
        const type = typeByCode.get(shift.dutyTypeCode)
        if (type === undefined || type.restAfterMinutes <= 0) continue
        const restLength = Math.ceil(type.restAfterMinutes / (24 * 60))
        for (let offset = 1; offset <= restLength; offset += 1) {
          restDays.add(addDays(shift.businessDate, offset))
        }
      }
      const cells: MonthlyDutyEmployeeCell[] = days.map((date) => {
        const dayShifts = employeeShifts.filter((shift) => shift.businessDate === date)
        const counts = conflictCounts.get(`${employeeName}|${date}`)
        return {
          date,
          layer: dayShifts.length > 0 ? 'DUTY' : restDays.has(date) ? 'REST' : 'FREE',
          dutyCount: dayShifts.length,
          hardConflictCount: counts?.hard ?? 0,
          softConflictCount: counts?.soft ?? 0,
          incompleteData: dayShifts.some((shift) => shift.passportBinding === null),
        }
      })
      return { employeeName, cells }
    })
    .filter((row) => row.cells.some((cell) => cell.layer !== 'FREE'))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
}

export function buildMonthlyPlan(
  month: string,
  shifts: readonly DutyShift[],
  dutyTypes: readonly DutyTypeDefinition[],
  policy: ConflictPolicy,
): MonthlyDutyPlan {
  const days = daysInMonth(month)
  const allConflicts = detectConflicts(shifts, dutyTypes, policy)
  const conflicts = allConflicts.filter((conflict) => monthOf(conflict.businessDate) === month)
  const monthShifts = shifts.filter((shift) => monthOf(shift.businessDate) === month)
  // Отменённые остаются в `rowsByObject` (строка объекта не должна исчезать
  // из сетки), но во ВСЕ счётчики идёт только активная часть.
  const activeMonthShifts = monthShifts.filter((shift) => shift.stateCode !== 'CANCELLED')

  const conflictCounts = new Map<string, { hard: number; soft: number }>()
  for (const conflict of conflicts) {
    const key = `${conflict.employeeName}|${conflict.businessDate}`
    const current = conflictCounts.get(key) ?? { hard: 0, soft: 0 }
    if (conflict.severity === 'HARD') current.hard += 1
    else current.soft += 1
    conflictCounts.set(key, current)
  }

  const rowsByObject = new Map<string, { objectLabel: string; shifts: DutyShift[] }>()
  for (const shift of monthShifts) {
    const existing = rowsByObject.get(shift.target.objectId)
    if (existing === undefined) {
      rowsByObject.set(shift.target.objectId, {
        objectLabel: shift.target.safeLabel,
        shifts: [shift],
      })
    } else {
      existing.shifts.push(shift)
    }
  }

  const rows: MonthlyDutyPlanRow[] = [...rowsByObject.entries()]
    .sort(([, a], [, b]) => a.objectLabel.localeCompare(b.objectLabel))
    .map(([objectId, { objectLabel, shifts: objectShifts }]) => ({
      objectId,
      objectLabel,
      cells: days.map((date) => {
        const dayShifts = objectShifts.filter((shift) => shift.businessDate === date)
        let hard = 0
        let soft = 0
        for (const shift of dayShifts) {
          const counts = conflictCounts.get(`${shift.employeeName}|${date}`)
          if (counts === undefined) continue
          hard += counts.hard
          soft += counts.soft
        }
        const active = dayShifts.filter((shift) => shift.stateCode !== 'CANCELLED')
        return {
          date,
          shiftCount: active.length,
          cancelledCount: dayShifts.length - active.length,
          notAcknowledgedCount: active.filter((shift) => shift.stateCode === 'PLANNED').length,
          completedCount: active.filter((shift) => shift.stateCode === 'COMPLETED').length,
          hardConflictCount: hard,
          softConflictCount: soft,
        }
      }),
    }))

  return {
    month,
    days,
    rows,
    conflictPolicy: policy,
    kpi: {
      objectsInPlan: rows.length,
      shifts: activeMonthShifts.length,
      cancelled: monthShifts.length - activeMonthShifts.length,
      notAcknowledged: activeMonthShifts.filter((shift) => shift.stateCode === 'PLANNED').length,
      completed: activeMonthShifts.filter((shift) => shift.stateCode === 'COMPLETED').length,
      hardConflicts: conflicts.filter((conflict) => conflict.severity === 'HARD').length,
      softConflicts: conflicts.filter((conflict) => conflict.severity === 'SOFT').length,
    },
    conflicts,
    unavailableMetrics: [...UNAVAILABLE_MONTHLY_METRICS],
    // Конфликты сюда передаются УЖЕ обрезанные месяцем — матрица показывает
    // ровно те, что видны в этом же ответе, а не пересчитывает их заново.
    employeeRows: buildEmployeeRows(month, shifts, dutyTypes, conflicts),
    unavailableLayers: [...UNAVAILABLE_EMPLOYEE_LAYERS],
  }
}
