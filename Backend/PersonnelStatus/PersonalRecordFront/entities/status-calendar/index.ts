// Календарь статусов (Plane №270): типы и пути ручек раздела ОМ.
//
// Коды статусов здесь КАНОНИЧЕСКИЕ (`DUTY`, `EVENT_ASSIGNMENT`, `VACATION`…),
// а не кадровые (`on_duty`, `vacation`): календарь читает
// `/api/ops/status-calendar/*`, который стоит на каноническом справочнике —
// только там существует участие в ОМ. Пространство кодов «Ежедневного
// расхода» (`entities/daily-grid`) то же самое; кадровое (`lib/status`) —
// другое, и смешивать их нельзя.

/** Строка справочника: код и подпись, которую правит заказчик. */
export interface StatusCalendarCatalogRow {
  code: string;
  name: string;
}

export interface StatusCalendarDivision {
  id: string;
  name: string;
}

/** Сотрудник месячной матрицы: код статуса на каждый день месяца. */
export interface StatusCalendarEmployeeMonth {
  id: string;
  name: string;
  rank: string;
  division: StatusCalendarDivision | null;
  /** Коды по дням — длина совпадает с `days` ответа. */
  days: string[];
}

/** Занятость одного дня по ВСЕЙ области — то, что рисуют точки в ячейке. */
export interface StatusCalendarDaySummary {
  date: string;
  onDuty: number;
  onEvent: number;
  absent: number;
  inService: number;
}

/**
 * Группы занятости в одном порядке для сетки, панели и легенды.
 *
 * Один список на всех читателей намеренно: порядок и подписи групп — это
 * контракт экрана, и второй его экземпляр разошёлся бы с первым.
 */
export const STATUS_CALENDAR_GROUPS = [
  { key: "on_duty" as const, label: "На дежурстве", hex: "#3b82f6" },
  { key: "on_event" as const, label: "Задействованы в ОМ", hex: "#8b5cf6" },
  { key: "absent" as const, label: "Отсутствуют", hex: "#f59e0b" },
];

export interface StatusCalendarMonth {
  /** ГГГГ-ММ. */
  month: string;
  /** Дни месяца, ISO-датами. */
  days: string[];
  catalog: StatusCalendarCatalogRow[];
  /** По дню на каждый день месяца, в порядке `days`. */
  summary: StatusCalendarDaySummary[];
  count: number;
  page: number;
  pageSize: number;
  results: StatusCalendarEmployeeMonth[];
}

/** Человек в группе занятости дня — с подписью СВОЕГО статуса. */
export interface StatusCalendarPerson {
  id: string;
  name: string;
  rank: string;
  division: StatusCalendarDivision | null;
  status: StatusCalendarCatalogRow;
}

export interface StatusCalendarGroup {
  /** Точный счёт группы — не длина списка: список подрезан потолком. */
  count: number;
  hasMore: boolean;
  employees: StatusCalendarPerson[];
}

/** Ключи групп панели занятости — закрытый мир ручки дня. */
export type StatusCalendarGroupKey = "on_duty" | "on_event" | "absent";

export interface StatusCalendarDay {
  date: string;
  groups: Record<StatusCalendarGroupKey, StatusCalendarGroup>;
  /** «В строю» — числом: поимённо это весь состав. */
  inService: number;
  total: number;
}

const BASE = "/api/ops/status-calendar";

export function statusCalendarMonthPath(params: {
  month: string;
  divisionId?: string | null;
  page?: number;
  pageSize?: number;
}): string {
  const query = new URLSearchParams({ month: params.month });
  if (params.divisionId) query.set("division_id", params.divisionId);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("page_size", String(params.pageSize));
  return `${BASE}/month/?${query.toString()}`;
}

export function statusCalendarDayPath(params: {
  date: string;
  divisionId?: string | null;
}): string {
  const query = new URLSearchParams({ date: params.date });
  if (params.divisionId) query.set("division_id", params.divisionId);
  return `${BASE}/day/?${query.toString()}`;
}
