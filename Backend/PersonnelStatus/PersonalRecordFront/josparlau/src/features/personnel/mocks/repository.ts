// Feature repository (§8.5): безопасная проекция личного состава (§20.29),
// раскрытие sensitive identity (§20.27/§20.28) и журнал раскрытий (§20.33).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import {
  disclosureExpiry,
  isValidPurpose,
  maskIin,
  MIN_PURPOSE_LENGTH,
} from '../lib/identity'
import type { IdentityDisclosure, IdentityDisclosureRecord } from '../lib/identity'
import type {
  DiscloseIdentityRequest,
  ListIdentityDisclosuresResponse,
  ListPersonnelResponse,
  PersonnelDirectoryEntry,
} from '../api/pending-contracts'
import { EMPLOYEES } from './fixtures'
import type { PersonnelSlice } from './fixtures'
import type { Employee } from '../model/types'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

const SLICE_NAME = 'personnel'
/** Право открыть список/карточку — то же, за которым стоит маршрут (§20.28
 * «открытие списка сотрудников»). */
const VIEW_PERMISSION = 'status.view'
/** §20.28 «раскрытие sensitive identity» — ОТДЕЛЬНОЕ право. Право видеть
 * карточку не то же самое, что право видеть идентификатор человека. */
const REVEAL_PERMISSION = 'personnel.identity.reveal'
/** §20.33: журнал раскрытий — тоже чувствительный ресурс (он показывает, кто
 * кем интересовался), и своё право у него не совпадает с правом раскрывать:
 * контролёр читает журнал, не раскрывая, а раскрывающий не обязан видеть
 * чужие обращения. */
const AUDIT_PERMISSION = 'personnel.identity.audit'

/**
 * Слайс появляется пустым и наполняется только раскрытиями. Донорские
 * сотрудники в него НЕ копируются: личный состав Smart Josparlau не ведёт
 * (§20.1), он его читает — источником остаётся `EMPLOYEES`.
 */
function readSlice(slices: Record<string, unknown>): PersonnelSlice {
  const slice = slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as PersonnelSlice
}

function project(employee: Employee, canRevealIin: boolean): PersonnelDirectoryEntry {
  return {
    id: employee.id,
    fullName: employee.full_name,
    rankCode: employee.rank_code,
    positionCode: employee.position_code,
    divisionId: employee.division ?? null,
    personnelNumber: employee.personnel_number ?? null,
    hireDate: employee.hire_date ?? null,
    dismissalDate: employee.dismissal_date ?? null,
    employmentStatus: employee.employment_status ?? 'WORKING',
    iinMasked: maskIin(employee.iin),
    canRevealIin,
  }
}

export function createPersonnelRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  function findEmployee(id: string): Employee {
    const employee = EMPLOYEES.find((candidate) => candidate.id === id)
    if (employee === undefined) {
      throw new RepositoryNotFoundError(id)
    }
    return employee
  }

  async function listPersonnel(actorUserId: string | null): Promise<ListPersonnelResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const canReveal = hasPermission(actorUserId, REVEAL_PERMISSION)
    return { results: EMPLOYEES.map((employee) => project(employee, canReveal)) }
  }

  async function getPersonnelEntry(
    id: string,
    actorUserId: string | null,
  ): Promise<PersonnelDirectoryEntry> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    return project(findEmployee(id), hasPermission(actorUserId, REVEAL_PERMISSION))
  }

  /**
   * §20.27 «Раскрытие чувствительного поля требует: effective permission +
   * organization scope + purpose + authority period + audit».
   *
   * Что из пяти есть и чего нет:
   *   permission      — `personnel.identity.reveal`, отдельно от просмотра;
   *   purpose         — обязательная цель, не короче `MIN_PURPOSE_LENGTH`;
   *   authority period— срок в ответе (`expiresAt`), считает сервер;
   *   audit           — запись в журнал БЕЗ самого значения (§20.33);
   *   organization scope — НЕ реализован: RBAC demo-режима плоский, без
   *                     организационного scope (§8.9/D9). Это названо вслух в
   *                     документации и на экране, а не подменено молчаливым
   *                     «разрешено всем в пределах права».
   *
   * §20.33 «не записывай success audit до успешного ответа repository»: запись
   * пишется ВНУТРИ мутации, после всех проверок — отказ следа не оставляет.
   */
  async function discloseIdentity(
    id: string,
    request: DiscloseIdentityRequest,
    actorUserId: string | null,
  ): Promise<IdentityDisclosure> {
    if (!hasPermission(actorUserId, REVEAL_PERMISSION)) {
      throw new RepositoryPermissionError(REVEAL_PERMISSION)
    }
    const employee = findEmployee(id)
    const purpose = request.purpose.trim()
    if (!isValidPurpose(purpose)) {
      throw new RepositoryBusinessRuleError(
        'PURPOSE_REQUIRED',
        `Укажите цель раскрытия — не короче ${MIN_PURPOSE_LENGTH} символов.`,
      )
    }
    const disclosedAt = clock.now()
    let record!: IdentityDisclosureRecord
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      record = {
        disclosureId: `disclosure-${current.revision + 1}-${slice.disclosures.length + 1}`,
        employeeId: employee.id,
        // `actorUserId` здесь уже не null: без него не прошла бы проверка права.
        actorUserId: actorUserId ?? '',
        purpose,
        disclosedAt,
        expiresAt: disclosureExpiry(disclosedAt),
      }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          disclosures: [...slice.disclosures, record],
        } satisfies PersonnelSlice,
      }
    })
    return {
      disclosureId: record.disclosureId,
      employeeId: record.employeeId,
      // Значение отдаётся ТОЛЬКО здесь и только этому ответу: в журнале его
      // нет, в проекции списка его нет, в кэше списка его нет.
      iin: employee.iin,
      disclosedAt: record.disclosedAt,
      expiresAt: record.expiresAt,
    }
  }

  async function listDisclosures(
    id: string,
    actorUserId: string | null,
  ): Promise<ListIdentityDisclosuresResponse> {
    if (!hasPermission(actorUserId, AUDIT_PERMISSION)) {
      throw new RepositoryPermissionError(AUDIT_PERMISSION)
    }
    findEmployee(id)
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope.slices)
    const disclosures = (slice?.disclosures ?? []).filter((entry) => entry.employeeId === id)
    // Самое свежее обращение — первым: журнал читают, чтобы увидеть последнее.
    return {
      results: [...disclosures].sort((a, b) => b.disclosedAt.localeCompare(a.disclosedAt)),
    }
  }

  return { listPersonnel, getPersonnelEntry, discloseIdentity, listDisclosures }
}
