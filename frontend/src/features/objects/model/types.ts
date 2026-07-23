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

export interface SecurityObject {
  id: string
  name: string
  code: string
  type: string
  region: string
  address: string
  objectState: ObjectState
  passportState: PassportState
  sectors: ObjectSector[]
  createdAt: string
  updatedAt: string
}
