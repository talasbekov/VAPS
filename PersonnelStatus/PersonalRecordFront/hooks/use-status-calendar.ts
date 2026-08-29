"use client";

// Календарь статусов (Plane №270): месяц по дням и занятость на дату.
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import {
  statusCalendarDayPath,
  statusCalendarMonthPath,
  type StatusCalendarDay,
  type StatusCalendarGroupKey,
  type StatusCalendarMonth,
} from "@/entities/status-calendar";

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
}) {
  const { month, divisionId = null, page = 1, enabled = true } = params;
  return useQuery<StatusCalendarMonth>({
    queryKey: ["status-calendar-month", month, divisionId, page],
    enabled: enabled && Boolean(month),
    queryFn: async () => {
      const body = await opsApiClient.get<MonthResponse>(
        statusCalendarMonthPath({ month, divisionId, page })
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
    },
  });
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
}) {
  const { date, divisionId = null, enabled = true } = params;
  return useQuery<StatusCalendarDay>({
    queryKey: ["status-calendar-day", date, divisionId],
    enabled: enabled && Boolean(date),
    queryFn: async () => {
      const body = await opsApiClient.get<DayResponse>(
        statusCalendarDayPath({ date: date as string, divisionId })
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
    },
  });
}

function mapGroup(group: DayResponse["groups"][StatusCalendarGroupKey]) {
  return {
    count: group.count,
    hasMore: group.has_more,
    employees: group.employees,
  };
}
