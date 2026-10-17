/**
 * Кадровые справочники модуля «Справочники» (Plane №274, Ш-1).
 *
 * Отдельная сущность от справочников раздела ОМ: у тех generic-реестр
 * «код → значение» с одной ручкой на все коды, у этих — своя таблица на
 * каждый и свои поля (у должности и звания есть УРОВЕНЬ, которого у значений
 * ОМ нет вовсе). Сводить их к одному типу значило бы придумать поле, которого
 * нет у половины.
 */
import type { DictionaryUsage } from "@/entities/dictionary";

export interface StaffDictionaryRow {
  id: number;
  name: string;
  /** Казахское наименование (UC-REF-001); пустая строка — перевода нет. */
  name_kk: string;
  code: string;
  level: number;
  is_active: boolean;
  inactive_since: string | null;
  supersedes: number | null;
  superseded_by: number | null;
  usage: DictionaryUsage;
  lastChange?: import("@/entities/dictionary").DictionaryChange | null;
  replacementFamily?: { rootId: string; currentId: string; memberIds: string[]; totalCount: number };
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

/** Записываемые поля строки: жизненный цикл ставит сервер, а не форма. */
export type StaffDictionaryWrite = Pick<
  StaffDictionaryRow,
  "name" | "name_kk" | "code" | "level"
> & { confirmSimilar?: boolean };

/** Ответ DELETE: 204 — удалено; 200 с телом — деактивировано по связям. */
export type RemoveStaffDictionaryRowResult =
  | { result: "deleted" }
  | { result: "deactivated"; row: StaffDictionaryRow };

export function staffDictionaryRowActionPath(
  kind: string,
  id: number,
  action: "set-active" | "supersede"
): string {
  return `${staffDictionaryRowPath(kind, id)}${action}/`;
}

/** Ответ ручки: DRF-пагинация либо голый список — зависит от настроек. */
export interface StaffDictionaryResponse {
  count?: number;
  results?: StaffDictionaryRow[];
}
