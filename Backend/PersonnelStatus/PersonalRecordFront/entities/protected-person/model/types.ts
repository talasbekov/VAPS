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
  /** Снимок лица под `/media/` (Plane №951); null — не загружен. */
  photoUrl: string | null;
  /** Данные образца заказчика (Plane №952): страна, должность и строки
   * «параметр = значение». Сводка ГВО подставляет их при выборе лица;
   * страна лица становится страной сводки. */
  country: string;
  position: string;
  facts: ProtectedPersonFact[];
}

export interface ProtectedPersonFact {
  key: string;
  value: string;
}

/** Параметры образца «Сводные данные» — в порядке печати. Форма заведения
 * лица предлагает ровно их; пустые не сохраняются. */
export const PROTECTED_PERSON_FACT_KEYS = [
  "Дата и место рождения",
  "Группа крови",
  "Рост",
  "Размер обуви",
  "Ограничения в питании",
  "Предпочтения в питании",
  "Аллергии",
] as const;

/** Заведение лица с экрана (Plane №951): `POST /protected-persons/`. */
export interface CreateProtectedPersonRequest extends Record<string, unknown> {
  name: string;
  category: ProtectedPersonCategory;
  callsign?: string;
  bio?: string;
  country?: string;
  position?: string;
  facts?: ProtectedPersonFact[];
}

/** Снимок лица (Plane №951): `POST /protected-persons/{id}/photo/`, multipart, поле `photo`. */
export function protectedPersonPhotoPath(id: string): string {
  return `${PROTECTED_PERSONS_PATH}${encodeURIComponent(id)}/photo/`;
}

// ── Контракты API (бэк живой с 20.08.2026; режим мока — lib/ops-env.ts) ─────────────

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
