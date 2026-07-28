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
import type { PolicySetting, SettingChangeEvent } from '../model/types'
import {
  findThresholdOrderViolation,
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
const MANAGE_PERMISSION = 'ops.settings.manage'

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
    // Порядок задаёт СЕРВЕР (раздел → детектор → поле), а не порядок вставки:
    // экран печатает список как пришёл.
    const order: Record<PolicySetting['field'], number> = {
      PARAMETER: 0,
      WARNING_FROM: 1,
      CRITICAL_FROM: 2,
    }
    const results = [...slice.settings].sort(
      (a, b) =>
        a.sectionCode.localeCompare(b.sectionCode) ||
        a.detectorCode.localeCompare(b.detectorCode) ||
        order[a.field] - order[b.field],
    )
    return {
      results,
      policyVersion: slice.policyVersion,
      canManage: hasPermission(actorUserId, MANAGE_PERMISSION),
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
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
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
      const policyVersion = nextPolicyVersion(currentSlice.policyVersion)
      const updated: PolicySetting = {
        ...existing,
        value: nextValue,
        updatedAt: now,
        updatedBy: actorUserId ?? 'demo',
      }
      const event: SettingChangeEvent = {
        id: `setting-change-${current.revision + 1}-${currentSlice.changeLog.length + 1}`,
        settingCode,
        safeLabel: existing.safeLabel,
        oldValue: existing.value,
        newValue: nextValue,
        reason,
        actorUserId: actorUserId ?? 'demo',
        changedAt: now,
        policyVersionAfter: policyVersion,
      }
      response = { setting: updated, policyVersion, event }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          policyVersion,
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
