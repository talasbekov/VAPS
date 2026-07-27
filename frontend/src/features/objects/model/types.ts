// Служба → Объекты и паспорта (мастер-промпт §21, Этап 5). Объект —
// постоянная сущность Smart Josparlau (§21.3 Objects Repository), НЕ донор —
// mock-only-demo runtime, как security-events. §21.5: состояние объекта,
// состояние паспорта и актуальность — РАЗНЫЕ поля, не один бейдж.
export type ObjectState = 'ACTIVE' | 'ARCHIVED'

/** §21.5: красный/жёлтый/зелёный — паспорт, НЕ состояние объекта. */
export type PassportState = 'RED' | 'YELLOW' | 'GREEN'

/** Пост постоянного дежурства на секторе объекта (§21.2 «секторы, постоянные посты»). */
export interface SecurityPost {
  id: string
  name: string
  task: string
  requirements: string
}

export interface ObjectSector {
  id: string
  name: string
  posts: SecurityPost[]
}

/**
 * Опубликованная версия паспорта (§8.5 `publishPassportVersion`, §8.10
 * «версия паспорта неизменяема после публикации», «у паспорта определена не
 * более чем одна действующая опубликованная версия на дату»).
 *
 * `sectors` — СНИМОК на момент публикации, а не ссылка на живой паспорт:
 * дальнейшее редактирование объекта версию не трогает (мастер-промпт L4475
 * «историческая версия паспорта сохраняется», L3787 «публикация новой версии
 * паспорта не переписывает действующую расстановку»).
 */
export interface PassportVersion {
  id: string
  versionNumber: number
  /** Дата, с которой версия действует (YYYY-MM-DD). */
  effectiveFrom: string
  publishedAt: string
  /** Идентификатор опубликовавшего (actorUserId) — ФИО в demo-модели нет. */
  publishedBy: string
  note: string
  sectors: ObjectSector[]
}

export interface SecurityObject {
  id: string
  name: string
  code: string
  type: string
  region: string
  address: string
  objectState: ObjectState
  passportState: PassportState
  /** Действующая редакция (черновик): её и правит форма паспорта. */
  sectors: ObjectSector[]
  /** История публикаций, по возрастанию номера версии. Неизменяема. */
  passportVersions: PassportVersion[]
  createdAt: string
  updatedAt: string
}
