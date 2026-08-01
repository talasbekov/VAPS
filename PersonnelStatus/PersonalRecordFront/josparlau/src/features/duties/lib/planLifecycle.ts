// Lifecycle месячного плана (§21.27) и action policy шапки (§21.28).
// Чистая модель: ни React, ни apiClient — тестируется в env node.
//
// ⚠️ ГЛАВНОЕ СВОЙСТВО ЭТОГО МОДУЛЯ. §21.28 требует: «Доступность кнопки должна
// приходить от action policy API». Поэтому решение «можно ли нажать» и текст
// «почему нельзя» считаются ЗДЕСЬ и вызываются из mock-repository (нашего
// «сервера»), а страница получает готовый список действий и только рисует его.
// Если экран сам выведет доступность из состояния плана — он неизбежно
// разойдётся с сервером, и «нельзя» на кнопке перестанет означать отказ
// сервера. Тот же приём, что серверные KPI (§21.29) и серверная severity
// конфликтов (§21.34) в `monthlyPlan.ts`.
import type {
  DutyShift,
  MonthlyPlanHistoryEntry,
  MonthlyPlanRecord,
  MonthlyPlanValidation,
} from '../model/types'
import { monthOf } from './monthlyPlan'
import type { MonthlyDutyPlanConflict, UnavailableMetric } from './monthlyPlan'

export type DutyPlanActionCode =
  | 'CREATE_DRAFT'
  | 'CHECK_CONFLICTS'
  | 'APPROVE'
  | 'REOPEN'
  | 'EXPORT'
  | 'ADD_SHIFT'

/**
 * §21.28, одно действие шапки. `reason` заполнен ровно тогда, когда действие
 * недоступно: причина рядом с недоступной кнопкой — то же требование §35, что
 * причина рядом с невыводимым показателем. Кнопка без объяснения читается как
 * «сломалось».
 */
export interface DutyPlanAction {
  code: DutyPlanActionCode
  label: string
  enabled: boolean
  reason: string | null
}

/** Права, от которых зависит доступность действий шапки. Передаются готовыми
 * булевыми: сам модуль ничего не знает про RBAC-директорию и коды прав. */
export interface DutyPlanActorRights {
  canManage: boolean
  canApprove: boolean
}

/**
 * §21.28 «источник объектов». Реальное поле, а не заглушка: объекты плана
 * приходят из реестра объектов, и часть из них может в реестре отсутствовать
 * (смены сида умеют ссылаться на объект вне реестра — например «Штаб
 * управления»). Число неизвестных названо, а не спрятано.
 */
export interface DutyPlanObjectSource {
  registryLabel: string
  knownObjects: number
  unknownObjects: number
}

/** §21.28, шапка плана. Поля, которых модель не даёт, идут в
 * `unavailableFields` с причиной, а не пустой строкой (§35). */
export interface MonthlyPlanHeader {
  month: string
  /** `null` — черновик на этот месяц ещё не сформирован. Именно `null`, а не
   * подставленный DRAFT: «плана нет» и «план в черновике» — разные факты. */
  record: MonthlyPlanRecord | null
  objectSource: DutyPlanObjectSource
  actions: DutyPlanAction[]
  unavailableFields: UnavailableMetric[]
  /** §21.27 «после утверждения: создаются проекции занятости; участники
   * получают уведомления» — эффекты, которых в demo-срезе нет. */
  unavailableApprovalEffects: UnavailableMetric[]
}

export const PLAN_STATE_LABEL: Record<MonthlyPlanRecord['stateCode'], string> = {
  DRAFT: 'Черновик',
  APPROVED: 'Утверждён',
}

export const PLAN_HISTORY_LABEL: Record<MonthlyPlanHistoryEntry['event'], string> = {
  DRAFT_CREATED: 'Сформирован черновик',
  VALIDATED: 'Проверка конфликтов',
  APPROVED: 'План утверждён',
  REOPENED: 'Открыта новая редакция',
}

/** §21.28 перечисляет поля шапки; два из них не выводимы ни из чего. */
export const UNAVAILABLE_HEADER_FIELDS: readonly UnavailableMetric[] = [
  {
    code: 'USER_SCOPE',
    label: 'Scope пользователя',
    reason:
      'RBAC demo-режима — плоский список кодов прав без организационного scope (§8.9, D9): показывать «в пределах чего» пользователь видит план не из чего.',
  },
  {
    code: 'AVAILABILITY_STATE',
    label: 'Состояние доступности',
    reason:
      'Employee Status Repository (отпуск, больничный, командировка) в demo-срезе отсутствует — тот же блокер, что у слоя кадровой недоступности в матрице §21.30.',
  },
]

/** §21.27 перечисляет последствия утверждения; в demo-срезе достижимо только
 * «план фиксируется» (закрытие месяца для планирующих мутаций) и «история не
 * перезаписывается» — они реализованы. Остальные названы вслух. */
export const UNAVAILABLE_APPROVAL_EFFECTS: readonly UnavailableMetric[] = [
  {
    code: 'OCCUPANCY_PROJECTIONS',
    label: 'Создание проекций занятости',
    reason:
      'Проекция занятости — это и есть матрица «сотрудник × день» (§21.30), которая считается на чтении по текущим сменам. Отдельная материализованная проекция была бы вторым владельцем того же факта.',
  },
  {
    code: 'PARTICIPANT_NOTIFICATIONS',
    label: 'Уведомления участникам',
    reason:
      'Рассылка уведомлений требует Notification Repository с адресатами; в demo-срезе ознакомление сотрудника отмечается вручную на карточке смены (§21.32).',
  },
]

/**
 * Отпечаток планового состава месяца.
 *
 * Считается по АКТИВНЫМ сменам месяца и включает `updatedAt`: и появление
 * смены, и правка существующей обязаны обесценить прежнюю проверку. Отменённые
 * смены исключены намеренно — они не занимают сотрудника и не участвуют в
 * конфликтах (см. `detectConflicts`), поэтому отмена меняет отпечаток ровно
 * тем, что смена из него ВЫПАДАЕТ.
 */
export function planFingerprint(month: string, shifts: readonly DutyShift[]): string {
  return shifts
    .filter((shift) => monthOf(shift.businessDate) === month && shift.stateCode !== 'CANCELLED')
    .map((shift) => `${shift.id}@${shift.updatedAt}`)
    .sort()
    .join('|')
}

/** Проверка актуальна: она была, и с тех пор состав месяца не менялся. */
export function isValidationCurrent(
  validation: MonthlyPlanValidation | null,
  fingerprint: string,
): boolean {
  return validation !== null && validation.planFingerprint === fingerprint
}

export function buildValidation(
  checkedAt: string,
  conflicts: readonly MonthlyDutyPlanConflict[],
  fingerprint: string,
): MonthlyPlanValidation {
  const hardConflicts = conflicts.filter((conflict) => conflict.severity === 'HARD').length
  return {
    checkedAt,
    hardConflicts,
    softConflicts: conflicts.length - hardConflicts,
    // Жёсткий конфликт — единственное, что валит проверку: мягкий уже прошёл
    // через обход с обоснованием при заведении смены (§21.34), запрещать им
    // утверждение значило бы требовать обход дважды.
    passed: hardConflicts === 0,
    planFingerprint: fingerprint,
  }
}

/**
 * §21.27: «Кнопку „Сформировать план“ переименуй в „Сформировать черновик“,
 * если операция только предлагает состав».
 *
 * Здесь операция даже не предлагает состав — она заводит запись плана над уже
 * заведёнными сменами месяца (автоподбора состава в demo-срезе нет). Тем более
 * не «Сформировать план»: утверждением она не является.
 */
export const DRAFT_LABEL = 'Сформировать черновик'

const NO_MANAGE_REASON = 'Нужно право планирования дежурств (ops.duty.manage).'
const NO_APPROVE_REASON = 'Нужно право утверждения плана (ops.duty.approve_plan).'

/**
 * §21.28, действия шапки и их доступность.
 *
 * Порядок проверок внутри каждого действия — от права к состоянию: отсутствие
 * права не должно маскироваться состоянием плана, иначе пользователь без права
 * увидит «сначала сформируйте черновик» и пойдёт его формировать.
 *
 * Действия возвращаются ВСЕГДА все шесть, даже недоступные: §21.28 называет
 * состав кнопок шапки, а скрытая кнопка не сообщает причину. Скрывать по праву
 * тоже нельзя — «нет права» это и есть причина, которую надо показать.
 */
export function buildPlanActions(
  record: MonthlyPlanRecord | null,
  rights: DutyPlanActorRights,
  validationIsCurrent: boolean,
): DutyPlanAction[] {
  const state = record?.stateCode ?? null
  const approvedLockReason =
    record === null
      ? null
      : `План месяца утверждён (редакция ${record.revision}) — изменения только в новой редакции.`

  const createDraft = (): DutyPlanAction => {
    if (!rights.canManage) {
      return { code: 'CREATE_DRAFT', label: DRAFT_LABEL, enabled: false, reason: NO_MANAGE_REASON }
    }
    if (record !== null) {
      return {
        code: 'CREATE_DRAFT',
        label: DRAFT_LABEL,
        enabled: false,
        reason: `План на этот месяц уже создан (редакция ${record.revision}, ${PLAN_STATE_LABEL[record.stateCode].toLowerCase()}).`,
      }
    }
    return { code: 'CREATE_DRAFT', label: DRAFT_LABEL, enabled: true, reason: null }
  }

  const checkConflicts = (): DutyPlanAction => {
    if (!rights.canManage) {
      return { code: 'CHECK_CONFLICTS', label: 'Проверить конфликты', enabled: false, reason: NO_MANAGE_REASON }
    }
    if (record === null) {
      return {
        code: 'CHECK_CONFLICTS',
        label: 'Проверить конфликты',
        enabled: false,
        reason: 'Плана на этот месяц нет — сначала сформируйте черновик.',
      }
    }
    if (state === 'APPROVED') {
      return {
        code: 'CHECK_CONFLICTS',
        label: 'Проверить конфликты',
        enabled: false,
        reason: 'План утверждён и закрыт для изменений: проверять нечего до открытия новой редакции.',
      }
    }
    return { code: 'CHECK_CONFLICTS', label: 'Проверить конфликты', enabled: true, reason: null }
  }

  const approve = (): DutyPlanAction => {
    const label = 'Утвердить план'
    if (!rights.canApprove) {
      return { code: 'APPROVE', label, enabled: false, reason: NO_APPROVE_REASON }
    }
    if (record === null) {
      return {
        code: 'APPROVE',
        label,
        enabled: false,
        reason: 'Плана на этот месяц нет — сначала сформируйте черновик.',
      }
    }
    if (state === 'APPROVED') {
      return { code: 'APPROVE', label, enabled: false, reason: 'План уже утверждён.' }
    }
    if (record.lastValidation === null) {
      return {
        code: 'APPROVE',
        label,
        enabled: false,
        reason: 'Проверка конфликтов не проводилась — §21.27 ставит её перед утверждением.',
      }
    }
    if (!validationIsCurrent) {
      return {
        code: 'APPROVE',
        label,
        enabled: false,
        reason: 'Состав месяца менялся после последней проверки — проверьте конфликты заново.',
      }
    }
    if (!record.lastValidation.passed) {
      return {
        code: 'APPROVE',
        label,
        enabled: false,
        reason: `Проверка нашла жёстких конфликтов: ${record.lastValidation.hardConflicts}. Их нельзя обойти обоснованием (§21.34).`,
      }
    }
    return { code: 'APPROVE', label, enabled: true, reason: null }
  }

  const reopen = (): DutyPlanAction => {
    const label = 'Открыть новую редакцию'
    if (!rights.canApprove) {
      return { code: 'REOPEN', label, enabled: false, reason: NO_APPROVE_REASON }
    }
    if (state !== 'APPROVED') {
      return {
        code: 'REOPEN',
        label,
        enabled: false,
        reason: 'Новая редакция открывается только для утверждённого плана.',
      }
    }
    return { code: 'REOPEN', label, enabled: true, reason: null }
  }

  const addShift = (): DutyPlanAction => {
    const label = 'Добавить дежурство'
    if (!rights.canManage) {
      return { code: 'ADD_SHIFT', label, enabled: false, reason: NO_MANAGE_REASON }
    }
    if (state === 'APPROVED') {
      return { code: 'ADD_SHIFT', label, enabled: false, reason: approvedLockReason }
    }
    return { code: 'ADD_SHIFT', label, enabled: true, reason: null }
  }

  return [
    createDraft(),
    checkConflicts(),
    approve(),
    reopen(),
    // §21.28 называет «Экспортировать» среди кнопок шапки. Операции за ней нет,
    // и рисовать работающую кнопку было бы выдумкой (§35) — она приходит
    // недоступной С ПРИЧИНОЙ, как и любой невыводимый показатель. Право
    // `ops.export.run` тут не проверяется намеренно: причина не в правах, и
    // подмена одной причины другой ввела бы в заблуждение.
    {
      code: 'EXPORT',
      label: 'Экспортировать',
      enabled: false,
      reason:
        'Экспорт месячного плана не реализован: печатные формы в demo-срезе есть только у расстановки ОМ (§9.15).',
    },
    addShift(),
  ]
}

export function findAction(
  actions: readonly DutyPlanAction[],
  code: DutyPlanActionCode,
): DutyPlanAction | undefined {
  return actions.find((action) => action.code === code)
}
