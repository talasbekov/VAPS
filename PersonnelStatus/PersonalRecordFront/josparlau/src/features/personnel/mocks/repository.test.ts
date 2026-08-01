// Repository личного состава: безопасная проекция (§20.29), раскрытие
// sensitive identity (§20.27/§20.28) и журнал раскрытий (§20.33).
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createPersonnelRepository,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'
import { EMPLOYEES } from './fixtures'

const VIEWER = 'viewer-user'
const REVEALER = 'revealer-user'
const AUDITOR = 'auditor-user'
const NOBODY = 'nobody-user'

const EMPLOYEE_ID = EMPLOYEES[0].id
const PURPOSE = 'Сверка данных при оформлении допуска'

function seedEnvelope(): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 19,
    seed_version: 'test-v19',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: { personnel: { disclosures: [] } },
  }
}

async function setup() {
  const adapter = createMemoryPersistence()
  await adapter.reset(seedEnvelope())
  const clock = new DemoClock('2026-07-20T08:00:00+05:00')
  return { repository: createPersonnelRepository(adapter, clock), adapter, clock }
}

beforeEach(() => {
  registerRbacDirectory([
    { userId: VIEWER, permissions: ['status.view'] },
    { userId: REVEALER, permissions: ['status.view', 'personnel.identity.reveal'] },
    { userId: AUDITOR, permissions: ['status.view', 'personnel.identity.audit'] },
    { userId: NOBODY, permissions: [] },
  ])
})

describe('безопасная проекция личного состава (§20.29)', () => {
  it('список НЕ содержит полного ИИН ни у одной строки — даже у того, кто вправе его раскрыть', async () => {
    const { repository } = await setup()
    for (const actor of [VIEWER, REVEALER]) {
      const response = await repository.listPersonnel(actor)
      const payload = JSON.stringify(response)
      // Проверяется САМ ОТВЕТ, а не то, что рисует экран: маскирование в
      // вёрстке маскированием не является — значение всё равно доехало бы до
      // клиента и осело в query cache.
      for (const employee of EMPLOYEES) {
        expect(payload).not.toContain(employee.iin)
      }
      expect(response.results.every((entry) => !('iin' in entry))).toBe(true)
      expect(response.results[0].iinMasked).toMatch(/^•+\d{4}$/)
    }
  })

  it('карточка тоже отдаёт только маску', async () => {
    const { repository } = await setup()
    const entry = await repository.getPersonnelEntry(EMPLOYEE_ID, REVEALER)
    expect(JSON.stringify(entry)).not.toContain(EMPLOYEES[0].iin)
    expect(entry.iinMasked.endsWith(EMPLOYEES[0].iin.slice(-4))).toBe(true)
  })

  it('право раскрытия приходит В ОТВЕТЕ и зависит от актора', async () => {
    const { repository } = await setup()
    expect((await repository.getPersonnelEntry(EMPLOYEE_ID, VIEWER)).canRevealIin).toBe(false)
    expect((await repository.getPersonnelEntry(EMPLOYEE_ID, REVEALER)).canRevealIin).toBe(true)
  })

  it('список и карточка требуют права просмотра', async () => {
    const { repository } = await setup()
    await expect(repository.listPersonnel(NOBODY)).rejects.toThrow(RepositoryPermissionError)
    await expect(repository.getPersonnelEntry(EMPLOYEE_ID, NOBODY)).rejects.toThrow(
      RepositoryPermissionError,
    )
  })

  it('несуществующий сотрудник — 404, а не пустая карточка', async () => {
    const { repository } = await setup()
    await expect(repository.getPersonnelEntry('employee-ghost', VIEWER)).rejects.toThrow(
      RepositoryNotFoundError,
    )
  })
})

describe('раскрытие sensitive identity (§20.27/§20.28)', () => {
  it('право видеть карточку НЕ даёт права раскрыть ИИН', async () => {
    const { repository } = await setup()
    await expect(
      repository.discloseIdentity(EMPLOYEE_ID, { purpose: PURPOSE }, VIEWER),
    ).rejects.toThrow(RepositoryPermissionError)
  })

  it('раскрытие без содержательной цели отклоняется', async () => {
    const { repository } = await setup()
    for (const purpose of ['', '   ', '-', 'надо']) {
      await expect(
        repository.discloseIdentity(EMPLOYEE_ID, { purpose }, REVEALER),
      ).rejects.toMatchObject({ errorCode: 'PURPOSE_REQUIRED' })
    }
  })

  it('успешное раскрытие отдаёт значение и КОНЕЧНЫЙ срок полномочия', async () => {
    const { repository } = await setup()
    const disclosure = await repository.discloseIdentity(
      EMPLOYEE_ID,
      { purpose: PURPOSE },
      REVEALER,
    )
    expect(disclosure.iin).toBe(EMPLOYEES[0].iin)
    expect(Date.parse(disclosure.expiresAt)).toBeGreaterThan(Date.parse(disclosure.disclosedAt))
  })
})

describe('журнал раскрытий (§20.33)', () => {
  it('запись НЕ содержит самого значения — ни целиком, ни хвостом', async () => {
    const { repository } = await setup()
    await repository.discloseIdentity(EMPLOYEE_ID, { purpose: PURPOSE }, REVEALER)
    const log = await repository.listDisclosures(EMPLOYEE_ID, AUDITOR)
    const payload = JSON.stringify(log)
    expect(payload).not.toContain(EMPLOYEES[0].iin)
    expect(payload).not.toContain(EMPLOYEES[0].iin.slice(-4))
    expect(log.results[0]).toMatchObject({
      employeeId: EMPLOYEE_ID,
      actorUserId: REVEALER,
      purpose: PURPOSE,
    })
  })

  it('отказ НЕ оставляет записи: success audit не пишется до успеха (§20.33)', async () => {
    const { repository } = await setup()
    await expect(
      repository.discloseIdentity(EMPLOYEE_ID, { purpose: 'нет' }, REVEALER),
    ).rejects.toMatchObject({ errorCode: 'PURPOSE_REQUIRED' })
    await expect(
      repository.discloseIdentity(EMPLOYEE_ID, { purpose: PURPOSE }, VIEWER),
    ).rejects.toThrow(RepositoryPermissionError)
    expect((await repository.listDisclosures(EMPLOYEE_ID, AUDITOR)).results).toHaveLength(0)
  })

  it('журнал читается по СВОЕМУ праву: раскрывающий его не видит, контролёр не раскрывает', async () => {
    const { repository } = await setup()
    await repository.discloseIdentity(EMPLOYEE_ID, { purpose: PURPOSE }, REVEALER)
    await expect(repository.listDisclosures(EMPLOYEE_ID, REVEALER)).rejects.toThrow(
      RepositoryPermissionError,
    )
    await expect(
      repository.discloseIdentity(EMPLOYEE_ID, { purpose: PURPOSE }, AUDITOR),
    ).rejects.toThrow(RepositoryPermissionError)
    expect((await repository.listDisclosures(EMPLOYEE_ID, AUDITOR)).results).toHaveLength(1)
  })

  it('журнал одного сотрудника не показывает обращения к другому', async () => {
    const { repository } = await setup()
    await repository.discloseIdentity(EMPLOYEE_ID, { purpose: PURPOSE }, REVEALER)
    await repository.discloseIdentity(EMPLOYEES[1].id, { purpose: PURPOSE }, REVEALER)
    const log = await repository.listDisclosures(EMPLOYEE_ID, AUDITOR)
    expect(log.results).toHaveLength(1)
    expect(log.results[0].employeeId).toBe(EMPLOYEE_ID)
  })

  it('раскрытия накапливаются и переживают чтение: журнал в хранилище, а не в памяти', async () => {
    const { repository, adapter } = await setup()
    await repository.discloseIdentity(EMPLOYEE_ID, { purpose: PURPOSE }, REVEALER)
    await repository.discloseIdentity(EMPLOYEE_ID, { purpose: `${PURPOSE} повторно` }, REVEALER)
    const stored = (await adapter.load())?.slices.personnel as { disclosures: unknown[] }
    expect(stored.disclosures).toHaveLength(2)
    expect((await repository.listDisclosures(EMPLOYEE_ID, AUDITOR)).results).toHaveLength(2)
  })

  it('чтение журнала не поднимает ревизию состояния', async () => {
    const { repository, adapter } = await setup()
    const before = (await adapter.load())?.revision
    await repository.listDisclosures(EMPLOYEE_ID, AUDITOR)
    await repository.listPersonnel(VIEWER)
    expect((await adapter.load())?.revision).toBe(before)
  })
})
