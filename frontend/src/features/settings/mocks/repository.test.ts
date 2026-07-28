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
const THRESHOLDS_ONLY = 'thresholds-admin-user'
const WILDCARD = 'wildcard-user'

const REST_MODE_CODE = 'CONFLICT.REST_AFTER_DUTY.MODE'
const PASSPORT_INTERVAL_CODE = 'PASSPORT.FRESHNESS.PARAMETER'
const OBJECTS_ADMIN = 'objects-admin-user'
const OVERLAP_MODE_CODE = 'CONFLICT.DUTY_OVERLAP.MODE'

const CLOCK_ISO = '2026-07-20T08:00:00+05:00'

const PARAMETER_CODE = 'ATTENTION.ACKNOWLEDGEMENT_MISSING.PARAMETER'
const WARNING_CODE = 'ATTENTION.CONFLICT_SHARE.WARNING_FROM'
const CRITICAL_CODE = 'ATTENTION.CONFLICT_SHARE.CRITICAL_FROM'

const REASON = 'Порог занижен по решению руководителя службы'

function seedEnvelope(): DemoStateEnvelope {
  const { sliceName, data } = buildSettingsSeed()
  return {
    application: 'smart-josparlau',
    schema_version: 28,
    seed_version: 'test-v28',
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
    {
      userId: ADMIN,
      permissions: [
        'ops.settings.view',
        'ops.settings.manage',
        'ops.settings.manage_conflict_rules',
      ],
    },
    { userId: NOBODY, permissions: [] },
    // §29: раздел правил конфликтов управляется ОТДЕЛЬНЫМ правом. Эта persona —
    // администратор порогов наблюдений, которому правила конфликтов закрыты:
    // без неё разделение прав было бы недостижимо (у wildcard открыто всё).
    {
      userId: THRESHOLDS_ONLY,
      permissions: ['ops.settings.view', 'ops.settings.manage'],
    },
    { userId: WILDCARD, permissions: ['*'] },
    // §21.7: политикой паспортов владеет тот, кто ВЕДЁТ объекты. Ему закрыты и
    // наблюдения, и правила конфликтов — зеркально к THRESHOLDS_ONLY.
    {
      userId: OBJECTS_ADMIN,
      permissions: ['ops.settings.view', 'ops.settings.manage_passport_policy'],
    },
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

  it('право на правку приходит С СЕРВЕРА в КАЖДОЙ записи и различает две роли', async () => {
    const { repository } = await makeRepository()
    const forViewer = (await repository.listSettings(VIEWER)).results
    const forAdmin = (await repository.listSettings(ADMIN)).results
    const threshold = (list: typeof forViewer) =>
      list.find((item) => item.settingCode === PARAMETER_CODE)
    expect(threshold(forViewer)?.action.canEdit).toBe(false)
    expect(threshold(forAdmin)?.action.canEdit).toBe(true)
  })

  it('порядок задаёт сервер: детектор, затем допуск → предупреждение → критично', async () => {
    const { repository } = await makeRepository()
    const codes = (await repository.listSettings(VIEWER)).results
      .filter((item) => item.groupCode === 'ACKNOWLEDGEMENT_MISSING')
      .map((item) => item.field)
    expect(codes).toEqual(['PARAMETER', 'WARNING_FROM', 'CRITICAL_FROM'])
    // Фикстура задана в другом порядке — иначе ассерт был бы вакуумен.
    const seedFields = POLICY_SETTINGS.filter(
      (item) => item.groupCode === 'CONFLICT_SHARE',
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
    expect(result.sectionVersions.ATTENTION_POLICY).not.toBe(before.sectionVersions.ATTENTION_POLICY)

    // Персистентность — ПОВТОРНЫМ чтением, не по возвращённому объекту.
    const after = await repository.listSettings(ADMIN)
    expect(after.results.find((item) => item.settingCode === PARAMETER_CODE)?.value).toBe(7)
    expect(after.sectionVersions.ATTENTION_POLICY).toBe(result.sectionVersions.ATTENTION_POLICY)
    expect(after.results.find((item) => item.settingCode === PARAMETER_CODE)?.updatedBy).toBe(
      ADMIN,
    )

    const log = await repository.listChangeLog(ADMIN)
    expect(log.results).toHaveLength(1)
    expect(log.results[0]).toMatchObject({
      settingCode: PARAMETER_CODE,
      oldValue: '3',
      newValue: '7',
      reason: REASON,
      actorUserId: ADMIN,
      policyVersionAfter: result.sectionVersions.ATTENTION_POLICY,
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
    expect(afterSecond.sectionVersions.ATTENTION_POLICY).toBe(afterFirst.sectionVersions.ATTENTION_POLICY)
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
    expect((await repository.listSettings(ADMIN)).sectionVersions.ATTENTION_POLICY).toBe(
      buildSettingsSeed().data.sectionVersions.ATTENTION_POLICY,
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
    expect(new Set([first.sectionVersions.ATTENTION_POLICY, second.sectionVersions.ATTENTION_POLICY]).size).toBe(2)

    const log = await repository.listChangeLog(ADMIN)
    expect(log.results.map((event) => event.newValue)).toEqual(['5', '4'])
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

describe('правила конфликтов §29/§21.34-21.35', () => {
  it('правка режима — ОТДЕЛЬНОЕ право: администратор порогов правила не трогает', async () => {
    const { repository } = await makeRepository()
    // Тот же актор МЕНЯЕТ порог наблюдений успешно — значит отказ ниже вызван
    // разделением прав, а не отсутствием доступа к разделу вообще.
    await expect(
      repository.updateSetting(PARAMETER_CODE, { value: 6, reason: REASON }, THRESHOLDS_ONLY),
    ).resolves.toBeDefined()
    await expect(
      repository.updateSetting(REST_MODE_CODE, { value: 'HARD_BLOCK', reason: REASON }, THRESHOLDS_ONLY),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('запертое правило §21.34 не правится ДАЖЕ wildcard-персоной', async () => {
    const { repository } = await makeRepository()
    // Замок — свойство правила, а не прав: hard-конфликт нельзя обойти никому.
    await expect(
      repository.updateSetting(
        OVERLAP_MODE_CODE,
        { value: 'HARD_BLOCK', reason: REASON },
        WILDCARD,
      ),
    ).rejects.toMatchObject({ errorCode: 'SETTING_RULE_LOCKED' })
  })

  it('причина отказа у запертого правила ОДНА для всех — замок проверяется первым', async () => {
    const { repository } = await makeRepository()
    // Иначе смотрящий без права узнавал бы «нет права» там, где правило не
    // редактируется ни для кого, — причина зависела бы от того, кто спросил.
    await expect(
      repository.updateSetting(
        OVERLAP_MODE_CODE,
        { value: 'HARD_BLOCK', reason: REASON },
        THRESHOLDS_ONLY,
      ),
    ).rejects.toMatchObject({ errorCode: 'SETTING_RULE_LOCKED' })
    const locked = (await repository.listSettings(WILDCARD)).results.find(
      (item) => item.settingCode === OVERLAP_MODE_CODE,
    )
    expect(locked?.action).toEqual({
      canEdit: false,
      disabledReason: expect.stringContaining('hard-конфликт'),
    })
  })

  it('версии разделов растут ПОРОЗНЬ — правка режима не двигает методику наблюдений', async () => {
    const { repository } = await makeRepository()
    const before = await repository.listSettings(WILDCARD)
    const response = await repository.updateSetting(
      REST_MODE_CODE,
      { value: 'HARD_BLOCK', reason: REASON },
      WILDCARD,
    )
    expect(response.sectionVersions.CONFLICT_RULES).not.toBe(before.sectionVersions.CONFLICT_RULES)
    expect(response.sectionVersions.ATTENTION_POLICY).toBe(before.sectionVersions.ATTENTION_POLICY)

    // И обратно: правка порога не двигает версию правил конфликтов.
    const thresholds = await repository.updateSetting(
      PARAMETER_CODE,
      { value: 6, reason: REASON },
      WILDCARD,
    )
    expect(thresholds.sectionVersions.ATTENTION_POLICY).not.toBe(before.sectionVersions.ATTENTION_POLICY)
    expect(thresholds.sectionVersions.CONFLICT_RULES).toBe(response.sectionVersions.CONFLICT_RULES)
  })

  it('журнал печатает ПОДПИСЬ режима и раздел, а не код варианта', async () => {
    const { repository } = await makeRepository()
    await repository.updateSetting(
      REST_MODE_CODE,
      { value: 'HARD_BLOCK', reason: REASON },
      WILDCARD,
    )
    const event = (await repository.listChangeLog(VIEWER)).results[0]
    expect(event.oldValue).toBe('Обход с обоснованием')
    expect(event.newValue).toBe('Жёсткий запрет')
    expect(event.sectionCode).toBe('CONFLICT_RULES')
    // Версия в записи — версия СВОЕГО раздела.
    expect(event.policyVersionAfter).toContain('conflict-rules')
  })

  it('режим вне списка вариантов отвергается как ошибка ФОРМЫ', async () => {
    const { repository } = await makeRepository()
    await expect(
      repository.updateSetting(REST_MODE_CODE, { value: 'BEFORE_DUTY', reason: REASON }, WILDCARD),
    ).rejects.toBeInstanceOf(RepositoryValidationError)
  })
})

describe('свежесть паспортов §29/§21.7', () => {
  it('третий раздел — третье право: ведущий объекты правит СВОЁ и не трогает чужое', async () => {
    const { repository } = await makeRepository()
    await expect(
      repository.updateSetting(
        PASSPORT_INTERVAL_CODE,
        { value: 200, reason: REASON },
        OBJECTS_ADMIN,
      ),
    ).resolves.toBeDefined()
    // Тот же актор: наблюдения и правила конфликтов ему закрыты.
    await expect(
      repository.updateSetting(PARAMETER_CODE, { value: 6, reason: REASON }, OBJECTS_ADMIN),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
    await expect(
      repository.updateSetting(
        REST_MODE_CODE,
        { value: 'HARD_BLOCK', reason: REASON },
        OBJECTS_ADMIN,
      ),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('и наоборот: администратор наблюдений политику паспортов не правит', async () => {
    // Без этой половины «отдельное право» доказывалось бы только в одну сторону.
    const { repository } = await makeRepository()
    await expect(
      repository.updateSetting(
        PASSPORT_INTERVAL_CODE,
        { value: 200, reason: REASON },
        THRESHOLDS_ONLY,
      ),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('версия двигается ТОЛЬКО у своего раздела — карта разделов, а не общее поле', async () => {
    const { repository } = await makeRepository()
    const before = (await repository.listSettings(WILDCARD)).sectionVersions
    const after = (
      await repository.updateSetting(
        PASSPORT_INTERVAL_CODE,
        { value: 200, reason: REASON },
        WILDCARD,
      )
    ).sectionVersions
    expect(after.PASSPORT_FRESHNESS).not.toBe(before.PASSPORT_FRESHNESS)
    expect(after.ATTENTION_POLICY).toBe(before.ATTENTION_POLICY)
    expect(after.CONFLICT_RULES).toBe(before.CONFLICT_RULES)
  })

  it('порог «скоро» и интервал — РАЗНЫЕ записи с разными диапазонами', async () => {
    // Иначе долю можно было бы выставить в 730 (границы интервала), и окно
    // предупреждения перекрыло бы весь срок.
    const { repository } = await makeRepository()
    const records = (await repository.listSettings(VIEWER)).results.filter(
      (item) => item.sectionCode === 'PASSPORT_FRESHNESS',
    )
    expect(records).toHaveLength(2)
    const percent = records.find((item) => item.field === 'WARNING_FROM')
    expect(percent?.kind === 'NUMBER' ? percent.maxValue : null).toBe(90)
    expect(percent?.valueType).toBe('PERCENT')
  })
})
