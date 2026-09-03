// Домен «Охраняемое лицо» — каталог профилей лиц, в отношении которых
// организуются охранные мероприятия. Это справочник, а не участник процесса:
// с 23.08.2026 ОМ хоста несёт ссылку на лицо (SecurityEvent.protectedPersonId,
// выбирается в окне «Создать бюллетень»), но у ОМ, заведённых раньше, её нет —
// связь с мероприятиями там по-прежнему восстанавливается по сводкам ГВО
// (см. app/security-ops/persons/page.tsx).

/** «Наши» / «Иностранные» — единственное деление каталога в прототипе. */
export const PROTECTED_PERSON_CATEGORIES = ["OURS", "FOREIGN"] as const;

export type ProtectedPersonCategory =
  (typeof PROTECTED_PERSON_CATEGORIES)[number];

export const PROTECTED_PERSON_CATEGORY_LABEL: Record<
  ProtectedPersonCategory,
  string
> = {
  OURS: "Наши",
  FOREIGN: "Иностранные",
};

export interface ProtectedPerson {
  id: string;
  /** Код `OL-N` (Plane №417): выдаётся сервером, руками не правится. */
  code: string;
  name: string;
  /** Позывной лица; в карточке показывается как «Позывной «Сокол»». */
  callsign: string;
  category: ProtectedPersonCategory;
  bio: string;
}

// ── Контракты API (реального бэка нет — см. lib/api-gaps.ts) ─────────────

export const PROTECTED_PERSONS_PATH = "/api/ops/protected-persons/";

export interface ListProtectedPersonsResponse {
  results: ProtectedPerson[];
}

// ── История мероприятий (задача заказчика Plane №38) ─────────────────────

/**
 * Строка истории: ЗАКРЫТОЕ мероприятие и то, что связывает его с карточкой,
 * из которой историю открыли. У охраняемого лица это объекты, которые он ЛИЧНО
 * посетил (в мероприятии их может быть больше — чужие сюда не едут); у объекта
 * — лица, посещавшие именно его.
 */
export interface EventHistoryRow {
  eventId: string;
  code: string;
  title: string;
  kind: string | null;
  businessDate: string;
  businessDateEnd: string | null;
  closedAt: string | null;
  chiefName: string;
}

export interface PersonHistoryRow extends EventHistoryRow {
  objects: {
    visitObjectId: string;
    objectId: string | null;
    objectName: string;
    visitDay: string | null;
    note: string;
  }[];
}

export interface ObjectHistoryRow extends EventHistoryRow {
  persons: {
    personId: string | null;
    name: string;
    visitDay: string | null;
  }[];
}

export function protectedPersonHistoryPath(id: string): string {
  return `${PROTECTED_PERSONS_PATH}${encodeURIComponent(id)}/history/`;
}

export interface ListPersonHistoryResponse {
  results: PersonHistoryRow[];
}

export interface ListObjectHistoryResponse {
  results: ObjectHistoryRow[];
}
