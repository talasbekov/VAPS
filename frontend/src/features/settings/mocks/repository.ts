// Feature repository (§8.5): server-like validation, permission/scope,
// атомарная мутация. §29 требует от настроек ровно четырёх вещей — менять
// через Mock API, проверять права, валидировать и оставлять след. Все четыре
// живут здесь, а не в компоненте.
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
} from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import type {
  ListSettingChangeLogResponse,
  ListSettingsResponse,
  UpdateSettingRequest,
  UpdateSettingResponse,
} from '../api/pending-contracts'
import type {
  PolicySetting,
  SettingAction,
  SettingChangeEvent,
  SettingSectionCode,
  StoredSetting,
} from '../model/types'
import {
  findThresholdOrderViolation,
  formatSettingValue,
  nextPolicyVersion,
  validateReason,
  validateSettingValue,
} from '../lib/policy'
import type { SettingsSlice } from './fixtures'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>
  constructor(fieldErrors: Record<string, string[]>) {
    super('validation')
    this.fieldErrors = fieldErrors
  }
}
/** 422: бизнес-правило политики нарушено (не форма). */
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

const SLICE_NAME = 'settings'
const VIEW_PERMISSION = 'ops.settings.view'
/**
 * Право на раздел, а не на настройки целиком: правка политики наблюдений
 * меняет то, ЧТО ПОКАЗАНО на аналитике, а правка правил конфликтов — ИСХОД
 * операции планирования (назначение отвергается либо требует обоснования).
 * Одно право на оба означало бы, что доступ к безобидной панели порогов
 * открывает и правила, которыми блокируется работа.
 */
const MANAGE_PERMISSION: Record<SettingSectionCode, string> = {
  ATTENTION_POLICY: 'ops.settings.manage',
  CONFLICT_RULES: 'ops.settings.manage_conflict_rules',
}

const NO_PERMISSION_REASON: Record<SettingSectionCode, string> = {
  ATTENTION_POLICY: 'Право на администрирование политики наблюдений не выдано.',
  CONFLICT_RULES: 'Право на изменение правил конфликтов не выдано.',
}

/** Решение о доступности правки принимает сервер (см. `SettingAction`). */
function buildAction(setting: StoredSetting, actorUserId: string | null): SettingAction {
  // Замок правила проверяется ПЕРВЫМ: иначе причина отказа зависела бы от прав
  // смотрящего, и администратор без права видел бы «нет права» там, где
  // правило не редактируется ни для кого.
  if (!setting.editable) {
    return { canEdit: false, disabledReason: setting.lockedReason }
  }
  if (!hasPermission(actorUserId, MANAGE_PERMISSION[setting.sectionCode])) {
    return { canEdit: false, disabledReason: NO_PERMISSION_REASON[setting.sectionCode] }
  }
  return { canEdit: true, disabledReason: null }
}

function readSlice(envelope: DemoStateEnvelope): SettingsSlice {
  const slice = envelope.slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as SettingsSlice
}

export function createSettingsRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  async function listSettings(actorUserId: string | null): Promise<ListSettingsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение настроек до инициализации demo-состояния')
    }
    const slice = readSlice(envelope)
    // Порядок задаёт СЕРВЕР (раздел → группа → поле), а не порядок вставки:
    // экран печатает список как пришёл.
    const order: Record<StoredSetting['field'], number> = {
      MODE: 0,
      PARAMETER: 1,
      WARNING_FROM: 2,
      CRITICAL_FROM: 3,
    }
    const results: PolicySetting[] = [...slice.settings]
      .sort(
        (a, b) =>
          a.sectionCode.localeCompare(b.sectionCode) ||
          a.groupCode.localeCompare(b.groupCode) ||
          order[a.field] - order[b.field],
      )
      .map((setting) => ({ ...setting, action: buildAction(setting, actorUserId) }))
    return {
      results,
      policyVersion: slice.policyVersion,
      conflictPolicyVersion: slice.conflictPolicyVersion,
    }
  }

  async function listChangeLog(
    actorUserId: string | null,
  ): Promise<ListSettingChangeLogResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: чтение журнала настроек до инициализации demo-состояния')
    }
    const slice = readSlice(envelope)
    // Новые сверху: журнал читают с последнего изменения.
    const results = [...slice.changeLog].sort(
      (a, b) => b.changedAt.localeCompare(a.changedAt) || b.id.localeCompare(a.id),
    )
    return { results }
  }

  async function updateSetting(
    settingCode: string,
    request: UpdateSettingRequest,
    actorUserId: string | null,
  ): Promise<UpdateSettingResponse> {
    // Раздел записи известен только после её чтения, поэтому право раздела
    // проверяется ниже. Но актору, не имеющему НИ ОДНОГО права на изменение,
    // отказывают раньше поиска: иначе 404 против 403 отвечал бы ему, какие
    // коды настроек существуют.
    const sections = Object.keys(MANAGE_PERMISSION) as SettingSectionCode[]
    if (!sections.some((section) => hasPermission(actorUserId, MANAGE_PERMISSION[section]))) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION.ATTENTION_POLICY)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: правка настроек до инициализации demo-состояния')
    }
    const slice = readSlice(envelope)
    const existing = slice.settings.find((item) => item.settingCode === settingCode)
    if (existing === undefined) {
      throw new RepositoryNotFoundError(settingCode)
    }
    // Замок правила проверяется ПЕРВЫМ — в том же порядке, что в `buildAction`:
    // §21.34 запрещает ослаблять hard-конфликт кому бы то ни было, поэтому
    // отказ одинаков и для wildcard-персоны. Проверь право раньше — и причина
    // отказа зависела бы от того, кто спросил (тот же приём, что у замка
    // закрытого обращения §28).
    if (!existing.editable) {
      throw new RepositoryBusinessRuleError(
        'SETTING_RULE_LOCKED',
        existing.lockedReason ?? 'Правило не редактируется.',
      )
    }
    if (!hasPermission(actorUserId, MANAGE_PERMISSION[existing.sectionCode])) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION[existing.sectionCode])
    }

    const fieldErrors = {
      ...validateSettingValue(existing, request.value),
      ...validateReason(request.reason),
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new RepositoryValidationError(fieldErrors)
    }
    const nextValue = request.value
    const reason = request.reason.trim()

    // Пустая правка отвергается, а не «применяется»: иначе журнал наполнялся
    // бы записями «53 → 53», а версия политики росла бы без смены методики —
    // снимок аналитики стал бы отличаться от предыдущего без причины.
    if (nextValue === existing.value) {
      throw new RepositoryBusinessRuleError(
        'SETTING_VALUE_UNCHANGED',
        'Значение совпадает с действующим — изменять нечего.',
      )
    }

    const orderViolation = findThresholdOrderViolation(slice.settings, settingCode, nextValue)
    if (orderViolation !== null) {
      throw new RepositoryBusinessRuleError('SETTING_THRESHOLD_ORDER_INVALID', orderViolation)
    }

    let response!: UpdateSettingResponse
    await runMutation(adapter, clock, (current) => {
      const currentSlice = readSlice(current)
      const now = clock.now()
      // Растёт версия ТОЛЬКО того раздела, к которому относится запись:
      // правка порога наблюдений не меняет методику конфликтов, и наоборот.
      const isConflictRule = existing.sectionCode === 'CONFLICT_RULES'
      const policyVersion = isConflictRule
        ? currentSlice.policyVersion
        : nextPolicyVersion(currentSlice.policyVersion)
      const conflictPolicyVersion = isConflictRule
        ? nextPolicyVersion(currentSlice.conflictPolicyVersion)
        : currentSlice.conflictPolicyVersion
      const updated = {
        ...existing,
        value: nextValue,
        updatedAt: now,
        updatedBy: actorUserId ?? 'demo',
      } as StoredSetting
      const event: SettingChangeEvent = {
        id: `setting-change-${current.revision + 1}-${currentSlice.changeLog.length + 1}`,
        settingCode,
        sectionCode: existing.sectionCode,
        safeLabel: existing.safeLabel,
        oldValue: formatSettingValue(existing, existing.value),
        newValue: formatSettingValue(existing, nextValue),
        reason,
        actorUserId: actorUserId ?? 'demo',
        changedAt: now,
        policyVersionAfter: isConflictRule ? conflictPolicyVersion : policyVersion,
      }
      response = {
        setting: { ...updated, action: buildAction(updated, actorUserId) },
        policyVersion,
        conflictPolicyVersion,
        event,
      }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          policyVersion,
          conflictPolicyVersion,
          settings: currentSlice.settings.map((item) =>
            item.settingCode === settingCode ? updated : item,
          ),
          changeLog: [...currentSlice.changeLog, event],
        } satisfies SettingsSlice,
      }
    })
    return response
  }

  return { listSettings, listChangeLog, updateSetting }
}
