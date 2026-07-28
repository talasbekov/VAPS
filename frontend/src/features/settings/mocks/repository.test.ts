import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createSettingsRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'
import { POLICY_SETTINGS, buildSettingsSeed } from './fixtures'

const VIEWER = 'viewer-user'
const ADMIN = 'admin-user'
const NOBODY = 'nobody-user'

const CLOCK_ISO = '2026-07-20T08:00:00+05:00'

const PARAMETER_CODE = 'ATTENTION.ACKNOWLEDGEMENT_MISSING.PARAMETER'
const WARNING_CODE = 'ATTENTION.CONFLICT_SHARE.WARNING_FROM'
const CRITICAL_CODE = 'ATTENTION.CONFLICT_SHARE.CRITICAL_FROM'

const REASON = 'Порог занижен по решению руководителя службы'

function seedEnvelope(): DemoStateEnvelope {
  const { sliceName, data } = buildSettingsSeed()
  return {
    application: 'smart-josparlau',
    schema_version: 26,
    seed_version: 'test-v26',
    scenario: 'normal',
    revision: 0,
    created_at: CLOCK_ISO,
    updated_at: CLOCK_ISO,
    slices: { [sliceName]: data },
  }
}

async function makeRepository() {
  const adapter = createMemoryPersistence()
  await adapter.reset(seedEnvelope())
  return {
    repository: createSettingsRepository(adapter, new DemoClock(CLOCK_ISO)),
    adapter,
  }
}

beforeEach(() => {
  registerRbacDirectory([
    { userId: VIEWER, permissions: ['ops.settings.view'] },
    { userId: ADMIN, permissions: ['ops.settings.view', 'ops.settings.manage'] },
    { userId: NOBODY, permissions: [] },
  ])
})

describe('settings repository — чтение', () => {
  it('без ops.settings.view раздел закрыт целиком', async () => {
    const { repository } = await makeRepository()
    await expect(repository.listSettings(NOBODY)).rejects.toBeInstanceOf(RepositoryPermissionError)
    await expect(repository.listChangeLog(NOBODY)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('canManage приходит С СЕРВЕРА и различает две роли', async () => {
    const { repository } = await makeRepository()
    expect((await repository.listSettings(VIEWER)).canManage).toBe(false)
    expect((await repository.listSettings(ADMIN)).canManage).toBe(true)
  })

  it('порядок задаёт сервер: детектор, затем допуск → предупреждение → критично', async () => {
    const { repository } = await makeRepository()
    const codes = (await repository.listSettings(VIEWER)).results
      .filter((item) => item.detectorCode === 'ACKNOWLEDGEMENT_MISSING')
      .map((item) => item.field)
    expect(codes).toEqual(['PARAMETER', 'WARNING_FROM', 'CRITICAL_FROM'])
    // Фикстура задана в другом порядке — иначе ассерт был бы вакуумен.
    const seedFields = POLICY_SETTINGS.filter(
      (item) => item.detectorCode === 'CONFLICT_SHARE',
    ).map((item) => item.field)
    expect(seedFields).not.toContain('PARAMETER')
  })

  it('журнал изменений на старте пуст — сеяных «изменений» не бывает', async () => {
    const { repository } = await makeRepository()
    expect((await repository.listChangeLog(VIEWER)).results).toEqual([])
  })
})

describe('settings repository — изменение', () => {
  it('просмотра мало: PATCH требует ops.settings.manage', async () => {
    const { repository } = await makeRepository()
    await expect(
      repository.updateSetting(PARAMETER_CODE, { value: 5, reason: REASON }, VIEWER),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('неизвестный код настройки → 404', async () => {
    const { repository } = await makeRepository()
    await expect(
      repository.updateSetting('ATTENTION.NOPE.PARAMETER', { value: 5, reason: REASON }, ADMIN),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError)
  })

  it('значение вне диапазона и короткая причина → 400 по полям сразу обоим', async () => {
    const { repository } = await makeRepository()
    const error = await repository
      .updateSetting(PARAMETER_CODE, { value: 999, reason: 'ой' }, ADMIN)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RepositoryValidationError)
    expect(error).toMatchObject({
      fieldErrors: { value: expect.any(Array), reason: expect.any(Array) },
    })
  })

  it('сохраняет значение, пишет журнал и двигает версию политики', async () => {
    const { repository } = await makeRepository()
    const before = await repository.listSettings(ADMIN)

    const result = await repository.updateSetting(
      PARAMETER_CODE,
      { value: 7, reason: REASON },
      ADMIN,
    )
    expect(result.setting.value).toBe(7)
    expect(result.policyVersion).not.toBe(before.policyVersion)

    // Персистентность — ПОВТОРНЫМ чтением, не по возвращённому объекту.
    const after = await repository.listSettings(ADMIN)
    expect(after.results.find((item) => item.settingCode === PARAMETER_CODE)?.value).toBe(7)
    expect(after.policyVersion).toBe(result.policyVersion)
    expect(after.results.find((item) => item.settingCode === PARAMETER_CODE)?.updatedBy).toBe(
      ADMIN,
    )

    const log = await repository.listChangeLog(ADMIN)
    expect(log.results).toHaveLength(1)
    expect(log.results[0]).toMatchObject({
      settingCode: PARAMETER_CODE,
      oldValue: 3,
      newValue: 7,
      reason: REASON,
      actorUserId: ADMIN,
      policyVersionAfter: result.policyVersion,
    })
  })

  it('повтор того же значения отвергается: журнал не растёт, версия не двигается', async () => {
    const { repository } = await makeRepository()
    await repository.updateSetting(PARAMETER_CODE, { value: 7, reason: REASON }, ADMIN)
    const afterFirst = await repository.listSettings(ADMIN)

    const repeated = await repository
      .updateSetting(PARAMETER_CODE, { value: 7, reason: REASON }, ADMIN)
      .catch((e: unknown) => e)
    expect(repeated).toBeInstanceOf(RepositoryBusinessRuleError)
    expect(repeated).toMatchObject({ errorCode: 'SETTING_VALUE_UNCHANGED' })

    const afterSecond = await repository.listSettings(ADMIN)
    expect(afterSecond.policyVersion).toBe(afterFirst.policyVersion)
    expect((await repository.listChangeLog(ADMIN)).results).toHaveLength(1)
  })

  it('порог предупреждения не может обогнать критический — и наоборот', async () => {
    const { repository } = await makeRepository()
    // 40 внутри допустимого диапазона (1..100) — отказ идёт именно от пары.
    const violation = await repository
      .updateSetting(WARNING_CODE, { value: 40, reason: REASON }, ADMIN)
      .catch((e: unknown) => e)
    expect(violation).toBeInstanceOf(RepositoryBusinessRuleError)
    expect(violation).toMatchObject({ errorCode: 'SETTING_THRESHOLD_ORDER_INVALID' })
    await expect(
      repository.updateSetting(CRITICAL_CODE, { value: 10, reason: REASON }, ADMIN),
    ).rejects.toMatchObject({ errorCode: 'SETTING_THRESHOLD_ORDER_INVALID' })

    // Отказ не оставил следа: ни записи в журнале, ни новой версии.
    expect((await repository.listChangeLog(ADMIN)).results).toEqual([])
    expect((await repository.listSettings(ADMIN)).policyVersion).toBe(
      buildSettingsSeed().data.policyVersion,
    )
  })

  it('версия политики растёт на КАЖДОМ изменении, а журнал отдаётся новыми сверху', async () => {
    const { repository } = await makeRepository()
    const first = await repository.updateSetting(
      PARAMETER_CODE,
      { value: 4, reason: REASON },
      ADMIN,
    )
    const second = await repository.updateSetting(
      PARAMETER_CODE,
      { value: 5, reason: REASON },
      ADMIN,
    )
    expect(new Set([first.policyVersion, second.policyVersion]).size).toBe(2)

    const log = await repository.listChangeLog(ADMIN)
    expect(log.results.map((event) => event.newValue)).toEqual([5, 4])
  })

  it('причина сохраняется обрезанной, а не как её ввели', async () => {
    const { repository } = await makeRepository()
    await repository.updateSetting(
      PARAMETER_CODE,
      { value: 9, reason: `   ${REASON}   ` },
      ADMIN,
    )
    expect((await repository.listChangeLog(ADMIN)).results[0].reason).toBe(REASON)
  })

  it('журнал изменений виден и тому, кто менять не вправе', async () => {
    // §29: журнал — контрольная функция. Право менять и право читать след —
    // разные вещи, иначе контролёр не мог бы проверить администратора.
    const { repository } = await makeRepository()
    await repository.updateSetting(PARAMETER_CODE, { value: 6, reason: REASON }, ADMIN)
    expect((await repository.listChangeLog(VIEWER)).results).toHaveLength(1)
  })
})
