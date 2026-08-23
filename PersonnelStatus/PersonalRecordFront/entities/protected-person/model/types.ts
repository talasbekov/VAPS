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
