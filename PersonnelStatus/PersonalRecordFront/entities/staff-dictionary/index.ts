/**
 * Кадровые справочники модуля «Справочники» (Plane №274, Ш-1).
 *
 * Отдельная сущность от справочников раздела ОМ: у тех generic-реестр
 * «код → значение» с одной ручкой на все коды, у этих — своя таблица на
 * каждый и свои поля (у должности и звания есть УРОВЕНЬ, которого у значений
 * ОМ нет вовсе). Сводить их к одному типу значило бы придумать поле, которого
 * нет у половины.
 */
export interface StaffDictionaryRow {
  id: number;
  name: string;
  code: string;
  level: number;
}

export interface StaffDictionaryKindMeta {
  /** Часть адреса экрана. */
  kind: string;
  label: string;
  description: string;
  path: string;
}

export const STAFF_DICTIONARIES: StaffDictionaryKindMeta[] = [
  {
    kind: "positions",
    label: "Должности",
    description:
      "Основание штатного расписания: на должность ссылается каждая штатная единица.",
    path: "/api/dictionaries/positions/",
  },
  {
    kind: "ranks",
    label: "Звания",
    description: "Звания личного состава; печатаются в карточке и документах.",
    path: "/api/dictionaries/ranks/",
  },
];

export function staffDictionaryOf(kind: string): StaffDictionaryKindMeta | null {
  return STAFF_DICTIONARIES.find((row) => row.kind === kind) ?? null;
}

export function staffDictionaryRowPath(kind: string, id: number): string {
  const meta = staffDictionaryOf(kind);
  return meta === null ? "" : `${meta.path}${id}/`;
}

/** Ответ ручки: DRF-пагинация либо голый список — зависит от настроек. */
export interface StaffDictionaryResponse {
  count?: number;
  results?: StaffDictionaryRow[];
}
