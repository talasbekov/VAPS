// Pending-контракты «Личный состав» (§7.5): это СОБСТВЕННЫЕ ресурсы Smart
// Josparlau поверх донорских кадровых данных, backend их не существует —
// статус `backend-contract-pending`.
//
// Почему своя проекция, а не донорский `/api/core/employees/`: §20.29 требует
// «list endpoint должен возвращать безопасную проекцию, а не полную карточку»,
// а донорский список несёт полный `iin` (его контракт нам не принадлежит, см.
// ARCH-FE-011 — типы из схемы). Читая донора напрямую, экран получал бы
// чувствительное значение на клиент независимо от прав смотрящего. Поэтому
// Smart Josparlau ходит в СВОЙ ресурс, который проецирует те же данные без
// `iin`, а раскрытие делает отдельной операцией с правом, целью, сроком и
// аудитом (§20.27/§20.28/§20.33).
import type { IdentityDisclosure, IdentityDisclosureRecord } from '../lib/identity'

/**
 * ⚠️ НЕ `/api/ops/personnel/` — этот путь уже занят: так называется узкий
 * ростер кандидатов на посты в `features/security-events` (там своё
 * ID-пространство и своя форма, см. A26/A44-A46). Коллизия не абстрактная:
 * MSW отдаёт ПЕРВЫЙ совпавший handler, и экраны личного состава молча
 * получали бы чужой ответ. Поймано e2e, не рассуждением.
 */
export const PERSONNEL_DIRECTORY_PATH = '/api/ops/personnel-directory/'

export function personnelEntryPath(id: string): string {
  return `${PERSONNEL_DIRECTORY_PATH}${id}/`
}
export function personnelDisclosePath(id: string): string {
  return `${PERSONNEL_DIRECTORY_PATH}${id}/identity-disclosure/`
}
export function personnelDisclosureLogPath(id: string): string {
  return `${PERSONNEL_DIRECTORY_PATH}${id}/identity-disclosures/`
}

/**
 * Безопасная проекция сотрудника (§20.29). Полного `iin` в ней НЕТ — только
 * маска, посчитанная сервером. Остальные поля §20.27 («полный номер телефона,
 * домашний адрес, дата рождения, медицинские сведения, кадровые документы,
 * семейные сведения») в проекции отсутствуют не по недосмотру: их нет и в
 * донорской модели, поэтому скрывать нечего — и выдумывать тоже.
 */
export interface PersonnelDirectoryEntry {
  id: string
  fullName: string
  rankCode: string
  positionCode: string
  divisionId: string | null
  personnelNumber: string | null
  hireDate: string | null
  dismissalDate: string | null
  employmentStatus: 'WORKING' | 'FIRED' | 'ARCHIVED'
  /** §20.27 «ИИН по умолчанию маскирован». Маскирует сервер. */
  iinMasked: string
  /** Есть ли у смотрящего право раскрыть ИИН — считает сервер (тот же принцип,
   * что action policy шапки плана §21.28: доступность приходит, а не выводится). */
  canRevealIin: boolean
}

export interface ListPersonnelResponse {
  results: PersonnelDirectoryEntry[]
}

export type PersonnelEntryResponse = PersonnelDirectoryEntry

/** §20.27: раскрытие требует цели. `type`, а не `interface` — переменные
 * `useApiMutation` обязаны удовлетворять `Record<string, unknown>`. */
export type DiscloseIdentityRequest = {
  purpose: string
}

export type DiscloseIdentityResponse = IdentityDisclosure

export interface ListIdentityDisclosuresResponse {
  results: IdentityDisclosureRecord[]
}
