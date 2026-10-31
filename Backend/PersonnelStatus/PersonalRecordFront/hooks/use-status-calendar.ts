"use client";

// Календарь статусов (Plane №270): месяц по дням и занятость на дату.
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { blockReadAccess, isReadAccessBlocked, readWithAccessCheck } from "@/lib/query-read-access";
import {
  statusCalendarDayPath,
  statusCalendarMonthPath,
  type StatusCalendarDay,
  type StatusCalendarGroupKey,
  type StatusCalendarMonth,
  type StatusCalendarDivisionOption,
  STATUS_CALENDAR_DIVISIONS_PATH,
} from "@/entities/status-calendar";

const CALENDAR_READS = new Set(["status-calendar-month", "status-calendar-day", "status-calendar-divisions"]);
async function readCalendar<T>(client: QueryClient, key: QueryKey, signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  try {
    return await readWithAccessCheck(client, key, signal, read);
  } catch (error) {
    const status = error !== null && typeof error === "object" && "status" in error ? error.status : undefined;
    if (!signal.aborted && (status === 401 || status === 403 || status === 404)) {
      const current = client.getQueryCache().find({ queryKey: key, exact: true });
      const related = (query: { queryKey: QueryKey }) => CALENDAR_READS.has(String(query.queryKey[0]));
      // A known denial also invalidates cached pages/months and the day panel.
      // Cancel old reads first so their delayed successes cannot restore data.
      await client.cancelQueries({ predicate: query => query !== current && related(query) });
      for (const query of client.getQueryCache().findAll({ predicate: related })) {
        blockReadAccess(client, query.queryKey, true);
      }
    }
    throw error;
  }
}

/** Ответ ручки — snake_case; клиент живёт в camelCase, перевод здесь. */
interface MonthResponse {
  month: string;
  days: string[];
  catalog: { code: string; name: string }[];
  summary: {
    date: string;
    on_duty: number;
    on_event: number;
    absent: number;
    in_service: number;
  }[];
  count: number;
  page: number;
  page_size: number;
  results: {
    id: string;
    name: string;
    rank: string;
    division: { id: string; name: string } | null;
    days: string[];
  }[];
}

interface DayResponse {
  date: string;
  groups: Record<
    StatusCalendarGroupKey,
    {
      count: number;
      has_more: boolean;
      employees: {
        combat_assignment?: import('@/entities/combat-duty').CombatAssignment | null;
        id: string;
        name: string;
        rank: string;
        division: { id: string; name: string } | null;
        status: { code: string; name: string };
      }[];
    }
  >;
  in_service: number;
  total: number;
}

/**
 * Месяц целиком: по каждому сотруднику код статуса на каждый день.
 *
 * Ключ запроса несёт месяц, подразделение и страницу — иначе переключение
 * месяца отдавало бы кэш соседнего.
 */
export function useStatusCalendarMonth(params: {
  month: string;
  divisionId?: string | null;
  page?: number;
  enabled?: boolean;
  search?: string;
}) {
  const { month, divisionId = null, page = 1, enabled = true, search = "" } = params;
  const client = useQueryClient();
  const key = ["status-calendar-month", month, divisionId, page, search];
  const query = useQuery<StatusCalendarMonth>({
    queryKey: key,
    enabled: enabled && Boolean(month),
    retry: false,
    queryFn: ({ signal }) => readCalendar(client, key, signal, async () => {
      const body = await opsApiClient.get<MonthResponse>(
        statusCalendarMonthPath({ month, divisionId, page, search })
      );
      return {
        month: body.month,
        days: body.days,
        catalog: body.catalog,
        summary: body.summary.map((row) => ({
          date: row.date,
          onDuty: row.on_duty,
          onEvent: row.on_event,
          absent: row.absent,
          inService: row.in_service,
        })),
        count: body.count,
        page: body.page,
        pageSize: body.page_size,
        results: body.results,
      };
    }),
  });
  const blocked = isReadAccessBlocked(client, key);
  return { ...query, data: blocked ? undefined : query.data, isError: query.isError || blocked };
}

/**
 * Занятость на дату: три группы поимённо и «в строю» числом.
 *
 * Отдельным запросом от месяца намеренно: панель меняется на каждый клик по
 * дню, а месяц при этом не перечитывается.
 */
export function useStatusCalendarDay(params: {
  date: string | null;
  divisionId?: string | null;
  enabled?: boolean;
  search?: string;
}) {
  const { date, divisionId = null, enabled = true, search = "" } = params;
  const client = useQueryClient();
  const key = ["status-calendar-day", date, divisionId, search];
  const query = useQuery<StatusCalendarDay>({
    queryKey: key,
    enabled: enabled && Boolean(date),
    retry: false,
    queryFn: ({ signal }) => readCalendar(client, key, signal, async () => {
      const body = await opsApiClient.get<DayResponse>(
        statusCalendarDayPath({ date: date as string, divisionId, search })
      );
      return {
        date: body.date,
        groups: {
          on_duty: mapGroup(body.groups.on_duty),
          on_event: mapGroup(body.groups.on_event),
          absent: mapGroup(body.groups.absent),
        },
        inService: body.in_service,
        total: body.total,
      };
    }),
  });
  const blocked = isReadAccessBlocked(client, key);
  return { ...query, data: blocked ? undefined : query.data, isError: query.isError || blocked };
}

export function useStatusCalendarDivisions() {
  const client = useQueryClient();
  const key = ["status-calendar-divisions"];
  const query = useQuery({
    queryKey: key, retry: false, staleTime: 60_000,
    queryFn: ({ signal }) => readCalendar(client, key, signal, () =>
      opsApiClient.get<{ results: StatusCalendarDivisionOption[] }>(STATUS_CALENDAR_DIVISIONS_PATH)),
  });
  const blocked = isReadAccessBlocked(client, key);
  return { ...query, data: blocked ? undefined : query.data, isError: query.isError || blocked };
}

function mapGroup(group: DayResponse["groups"][StatusCalendarGroupKey]) {
  return {
    count: group.count,
    hasMore: group.has_more,
    employees: group.employees,
  };
}
