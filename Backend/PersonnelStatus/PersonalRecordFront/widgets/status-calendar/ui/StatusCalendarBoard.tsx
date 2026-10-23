"use client";

// Календарь статусов: два вида взамен прежнего «Календаря статусов»
// (Plane №270) — месячная сетка с панелью занятости и матрица
// «сотрудник × день».
//
// Выбранный день живёт ЗДЕСЬ, а не внутри сетки: его читает и сетка
// (подсветка выбора), и панель — два состояния одного выбора разошлись бы на
// первом же клике.
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadFailure } from "@/components/load-failure";
import { useStatusCalendarDivisions } from "@/hooks/use-status-calendar";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import type { StatusCalendarDivisionOption } from "@/entities/status-calendar";
import { statusCalendarHref, validStatusCalendarDate } from "@/entities/status-calendar/navigation";
import { formatIsoDate } from "@/shared/lib/date";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusDayPanel } from "./StatusDayPanel";
import { StatusMatrix } from "./StatusMatrix";
import { StatusMonthGrid, isoDate, isoMonth } from "./StatusMonthGrid";

function divisionLabel(row: StatusCalendarDivisionOption, rows: StatusCalendarDivisionOption[]): string {
  const parts = [row.name], visited = new Set([row.id]);
  let parent = row.parent_id;
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    const found = rows.find(item => item.id === parent);
    if (!found) break;
    parts.unshift(found.name); parent = found.parent_id;
  }
  return parts.join(" / ");
}

export function StatusCalendarBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const [defaultDate] = useState(() => isoDate(new Date()));
  const explicitDate = params.get("statusDate");
  const dateValid = explicitDate === null || validStatusCalendarDate(explicitDate);
  const selectedDate = dateValid && explicitDate !== null ? explicitDate : defaultDate;
  const month = dateValid ? selectedDate.slice(0, 7) : "";
  const setSelectedDate = (date: string) => {
    if (validStatusCalendarDate(date)) router.replace(statusCalendarHref(date, new URLSearchParams(params)), { scroll: false });
  };
  const [divisionId, setDivisionId] = useState("");
  const divisionFilterInitialized = useRef(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const divisions = useStatusCalendarDivisions();
  const access = useOpsPermissions();
  const client = useQueryClient();
  useEffect(() => {
    if (divisionFilterInitialized.current || access.isLoading || access.error ||
      divisions.isLoading || divisions.isError || !divisions.data) return;
    divisionFilterInitialized.current = true;
    if (access.hasGlobalPermission("status.view")) return;
    const visibleIds = new Set(divisions.data.results.map(row => row.id));
    const scopes = [...new Set(access.roles
      .filter(role => role.scope_division_id !== null)
      .map(role => String(role.scope_division_id))
      .filter(id => visibleIds.has(id)))];
    if (scopes.length === 1) setDivisionId(scopes[0]);
  }, [access.isLoading, access.error, access.hasGlobalPermission, access.roles,
    divisions.isLoading, divisions.isError, divisions.data]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const selectMonth = (value: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || Number(value.slice(0, 4)) < 1) return;
    const end = new Date(`${value}-01T12:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    setSelectedDate(value + "-" + String(Math.min(Number(selectedDate.slice(8)), end.getUTCDate())).padStart(2, "0"));
  };
  const stepMonth = (step: number) => {
    if (!dateValid) return;
    const date = new Date(month + "-01T12:00:00");
    date.setMonth(date.getMonth() + step);
    selectMonth(isoMonth(date));
  };
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all(["status-calendar-month", "status-calendar-day", "status-calendar-divisions"]
        .map(key => client.invalidateQueries({ queryKey: [key] })));
    } finally { setRefreshing(false); }
  };
  const options = divisions.isError ? [] : divisions.data?.results ?? [];
  const scope = { month, divisionId: divisionId || null, search, selectedDate, onSelectDate: setSelectedDate };

  return (
    <section className="min-w-0 space-y-3" aria-label="Календарь занятости сотрудников">
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-end">
        <div className="flex min-w-0 items-start justify-between gap-2 xl:contents">
          <div className="flex min-w-0 flex-wrap items-center gap-1 xl:order-1 xl:shrink-0">
            <Button variant="outline" size="icon" className="h-10 w-10 xl:h-9 xl:w-9" aria-label="Предыдущий месяц" disabled={!dateValid} onClick={() => stepMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <label className="sr-only" htmlFor="status-calendar-month">Месяц календаря</label>
            <input id="status-calendar-month" type="month" value={month} className="h-10 w-28 min-w-0 rounded-md border bg-background px-1 text-sm sm:w-36 sm:px-2 xl:h-9"
              onChange={event => selectMonth(event.target.value)} />
            <Button variant="outline" size="icon" className="h-10 w-10 xl:h-9 xl:w-9" aria-label="Следующий месяц" disabled={!dateValid} onClick={() => stepMonth(1)}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" className="h-10 px-2 xl:h-9" onClick={() => setSelectedDate(isoDate(new Date()))}>Сегодня</Button>
          </div>
          <Button variant="outline" size="sm" aria-label="Обновить календарь" title="Обновить календарь" className="h-10 w-10 shrink-0 p-0 sm:w-auto sm:px-3 xl:order-3 xl:h-9 xl:w-9 xl:p-0" disabled={refreshing} onClick={refresh}><RefreshCw className="h-4 w-4" /><span className="sr-only sm:not-sr-only xl:sr-only">Обновить календарь</span></Button>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:order-2 xl:flex-1">
          <div className="grid min-w-0 gap-1 text-xs"><label htmlFor="status-calendar-division">Подразделение календаря</label>
            <select id="status-calendar-division" className="h-10 min-w-0 w-full rounded-md border bg-background px-2 text-sm xl:h-9" value={divisionId}
              disabled={divisions.isLoading || divisions.isError} onChange={event => { divisionFilterInitialized.current = true; setDivisionId(event.target.value); }}>
              <option value="">{divisions.isError ? "Список подразделений недоступен" : "Все доступные подразделения"}</option>
              {divisionId && !options.some(row => row.id === divisionId) && <option value={divisionId}>Выбранное подразделение — список недоступен</option>}
              {options.map(row => <option key={row.id} value={row.id}>{divisionLabel(row, options)}</option>)}
            </select>
          </div>
          <label className="grid min-w-0 gap-1 text-xs">Поиск сотрудника в календаре
            <input type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Фамилия, имя или отчество" className="h-10 min-w-0 w-full rounded-md border bg-background px-3 text-sm xl:h-9" />
          </label>
        </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>Поиск охватывает всё выбранное подразделение и его сотрудников на всех страницах.</p>
          {(divisionId || query) && <Button variant="ghost" size="sm" className="min-h-10 lg:min-h-8" onClick={() => { divisionFilterInitialized.current = true; setDivisionId(""); setQuery(""); setSearch(""); }}>Сбросить фильтры</Button>}
        </div>
        {query.trim() !== search && <p role="status" className="text-xs text-muted-foreground">Применяем поиск…</p>}
        {divisions.isError && <LoadFailure what="список подразделений" onRetry={() => { void divisions.refetch(); }} isRetrying={divisions.isFetching} />}
      </div>
    {!dateValid ? <p role="alert" className="rounded-lg border p-3 text-sm">В ссылке указана некорректная дата календаря. Выберите месяц или нажмите «Сегодня».</p> : <>
    <p className="text-sm" aria-label="Выбранный день календаря">Выбранный день: {formatIsoDate(selectedDate)}</p>
    <Tabs defaultValue="matrix" className="min-w-0 space-y-3">
      <TabsList className="grid h-auto w-full grid-cols-2 sm:w-80">
        <TabsTrigger className="min-h-10 lg:min-h-8" value="matrix">Шахматка</TabsTrigger>
        <TabsTrigger className="min-h-10 lg:min-h-8" value="month">Месяц</TabsTrigger>
      </TabsList>

      <TabsContent value="month">
        {/* Панель шириной в колонку рядом с сеткой на широком экране и под ней
            на узком: на телефоне колонка в 320px оставила бы сетке 40 пикселей. */}
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <StatusMonthGrid {...scope} />
          <StatusDayPanel date={selectedDate} divisionId={scope.divisionId} search={search} />
        </div>
      </TabsContent>

      <TabsContent value="matrix" className="min-w-0">
        <StatusMatrix key={JSON.stringify([month, divisionId, search])} {...scope} />
        <details className="mt-4 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Занятость за выбранный день</summary>
          <div className="mt-3"><StatusDayPanel date={selectedDate} divisionId={scope.divisionId} search={search} /></div>
        </details>
      </TabsContent>
    </Tabs>
    </>}
    </section>
  );
}
