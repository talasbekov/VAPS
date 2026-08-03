// Служба → Объекты и паспорта (мастер-промпт §21, Этап 5). Объект —
// постоянная сущность Smart Josparlau (§21.3 Objects Repository), НЕ донор —
// mock-only-demo runtime, как security-events. §21.5: состояние объекта,
// состояние паспорта и актуальность — РАЗНЫЕ поля, не один бейдж.
export type ObjectState = 'ACTIVE' | 'ARCHIVED'

/** §21.5: красный/жёлтый/зелёный — паспорт, НЕ состояние объекта. */
export type PassportState = 'RED' | 'YELLOW' | 'GREEN'

/**
 * §21.7 «Срок актуальности должен приходить от policy», с ПРЯМЫМ запретом
 * фиксированного frontend-периода («Паспорт старше 90 дней»). Поэтому интервал —
 * ХРАНИМАЯ настройка со своей версией, а не константа в коде: политику можно
 * поменять, и каждый посчитанный по ней результат несёт `freshnessPolicyVersion`,
 * по которой видно, чем именно он посчитан.
 */
export interface PassportFreshnessPolicy {
  version: string
  verificationIntervalDays: number
  /**
   * Порог «скоро проверка» — ДОЛЯ интервала (проценты), а не своё число дней:
   * иначе рядом с настраиваемым интервалом стояла бы вторая константа периода,
   * ровно то, что §21.7 запрещает; и, растянув интервал, администратор молча
   * получил бы прежнее окно предупреждения. Владелец — раздел «Настройки»
   * (§29), сюда приходит узкой проекцией (`mocks/settingsSlice.ts`).
   */
  dueSoonPercent: number
}

/**
 * §21.7 — ПРОИЗВОДНОЕ состояние актуальности паспорта. У объекта не хранится:
 * пересчитывается на каждом чтении от бизнес-даты (хранимый флаг протух бы
 * молча ровно в тот день, когда он и должен был измениться — тот же принцип,
 * что `DutyPassportStatus.stale` в features/duties).
 *
 * `NO_PUBLISHED_VERSION` — отдельный исход, а не «просрочен»: паспорт, который
 * ни разу не публиковали, не устарел — у него другой дефект, и лечится он
 * иначе.
 */
export type PassportFreshnessState = 'FRESH' | 'DUE_SOON' | 'OVERDUE' | 'NO_PUBLISHED_VERSION'

export interface PassportFreshness {
  objectId: string
  state: PassportFreshnessState
  /** Дата следующей обязательной проверки; `null` — публикаций не было. */
  verificationDueAt: string | null
  freshnessPolicyVersion: string
}

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
