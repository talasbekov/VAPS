"use client";

// «Свод по Службе» (Plane №992 → №1223 → №1232) — рабочее место ОПЕРАТИВНОГО
// ДЕЖУРНОГО: готовность сдачи расхода ПО ВСЕЙ ОРГАНИЗАЦИИ на завтра, на любую
// дату или на диапазон дат. Видимость требует права рабочего места,
// status.view и подтверждённой сервером области корня организации.
//
// Диапазон (№1232, макет заказчика): ПЛИТКИ дневных срезов — одна на дату, с
// итогом «сдали N из M»; открыт срез нажатой плитки. Каждая дата хранит свои
// версии и источники (§20.4 п.8), между днями ничего не суммируется.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OpsApiError } from "@/lib/ops-errors";
import { ServiceSummaryRootActionContext, ServiceSummaryRootContext, ServiceSummaryWorkspaceReadyContext, useServiceSummaryContext } from "../model/workspace-context";
import { LoadFailure } from "@/components/load-failure";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { moduleOpenFor } from "@/entities/portal-access";
import { formatIsoDate, localIsoDate, parseIsoDate } from "@/shared/lib/date";
import { useServiceDateRange } from "../model/date-range";
import { useServiceTree } from "../model/use-service-tree";
import { DaySummarySection } from "./DaySummarySection";

function dateLabel(iso: string): string {
  const parsed = parseIsoDate(iso);
  return parsed === null ? iso : format(parsed, "dd MMMM yyyy", { locale: ru });
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Плитка дневного среза: итог «сдали N из M» и состояние свода Службы. */
function DayTile({ date, isDefault, selected, onSelect }: { date: string; isDefault: boolean; selected: boolean; onSelect: () => void }) {
  const tree = useServiceTree(date);
  const departments = tree.rootId !== null ? tree.childrenOf.get(tree.rootId) ?? [] : [];
  const submitted = departments.filter((node) => tree.submissionByDivision.has(String(node.division_id))).length;
  const assembled = tree.rootId !== null && tree.submissionByDivision.has(String(tree.rootId));
  const tone = tree.isPending ? "bg-slate-400" : departments.length > 0 && submitted === departments.length ? "bg-emerald-600" : submitted > 0 ? "bg-amber-600" : "bg-red-600";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`grid min-w-[150px] gap-0.5 rounded-lg border bg-card px-3 py-2 text-left ${selected ? "border-primary ring-1 ring-primary" : ""}`}
    >
      <b className="tabular-nums">{formatIsoDate(date)}{isDefault ? " · завтра" : ""}</b>
      <small className="text-muted-foreground">
        <span className={`mr-1 inline-block h-2 w-2 rounded-full ${tone}`} />
        {tree.isPending ? "загрузка…" : tree.isError ? "нет данных" : `Сдали ${submitted} из ${departments.length}${assembled ? " · свод собран" : ""}`}
      </small>
    </button>
  );
}

function ServiceSummaryBody({ workspaceReady }: { workspaceReady: boolean }) {
  const [fromCalendarOpen, setFromCalendarOpen] = useState(false);
  const [toCalendarOpen, setToCalendarOpen] = useState(false);
  useEffect(() => {
    if (!workspaceReady) {
      setFromCalendarOpen(false);
      setToCalendarOpen(false);
    }
  }, [workspaceReady]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("dateFrom") ?? undefined;
  const toParam = searchParams.get("dateTo") ?? undefined;
  const dayParam = searchParams.get("day") ?? undefined;

  const replaceParams = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams);
      mutate(next);
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );
  const setParam = useCallback((key: string, value: string) => replaceParams((next) => (value === "" ? next.delete(key) : next.set(key, value))), [replaceParams]);
  // ОДНИМ вызовом снимает ВСЕ параметры: два последовательных `setParam`
  // читали бы один и тот же устаревший `searchParams`.
  const resetDates = useCallback(() => replaceParams((next) => { next.delete("dateFrom"); next.delete("dateTo"); next.delete("day"); }), [replaceParams]);

  const range = useServiceDateRange(fromParam, toParam);

  const effectiveFrom = fromParam ?? range.defaultDate ?? "";
  const rangeMode = toParam !== undefined && toParam !== effectiveFrom;
  const activeDate = rangeMode && dayParam !== undefined && range.dates.includes(dayParam) ? dayParam : range.dates[0];

  return (
    <section role="region" aria-label="Свод по Службе" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Режим" className="inline-flex overflow-hidden rounded-md border bg-card">
          <button type="button" aria-pressed={!rangeMode} className={`min-h-9 px-3 text-sm ${!rangeMode ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`} onClick={() => replaceParams((next) => { next.delete("dateTo"); next.delete("day"); })}>День</button>
          <button type="button" aria-pressed={rangeMode} className={`min-h-9 px-3 text-sm ${rangeMode ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`} onClick={() => effectiveFrom !== "" && setParam("dateTo", addDays(effectiveFrom, 2))}>Диапазон</button>
        </div>
        <Popover open={workspaceReady && fromCalendarOpen} onOpenChange={setFromCalendarOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-auto justify-start text-left font-normal">
              <CalendarIcon className="mr-2 h-4 w-4" />
              {effectiveFrom === "" ? "Загрузка даты…" : dateLabel(effectiveFrom)}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={effectiveFrom === "" ? undefined : (parseIsoDate(effectiveFrom) ?? undefined)}
              onSelect={(date) => date && replaceParams((next) => { next.set("dateFrom", localIsoDate(date)); next.delete("day"); })}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        {rangeMode && (
          <>
            <span className="text-sm text-muted-foreground">по</span>
            <Popover open={workspaceReady && toCalendarOpen} onOpenChange={setToCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-auto justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateLabel(toParam as string)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={parseIsoDate(toParam as string) ?? undefined}
                  onSelect={(date) => date && replaceParams((next) => { next.set("dateTo", localIsoDate(date)); next.delete("day"); })}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </>
        )}
        {(fromParam !== undefined || toParam !== undefined) && (
          <Button variant="ghost" size="sm" onClick={resetDates}>
            Вернуть «завтра»
          </Button>
        )}
      </div>

      {range.isResolving && (
        <p className="text-sm text-muted-foreground">Загрузка даты по умолчанию…</p>
      )}
      {!range.isResolving && rangeMode && (
        <div role="tablist" aria-label="Дневные срезы диапазона" className="flex flex-wrap gap-2">
          {range.dates.map((date) => (
            <DayTile key={date} date={date} isDefault={date === range.defaultDate} selected={date === activeDate} onSelect={() => setParam("day", date)} />
          ))}
        </div>
      )}
      {!range.isResolving && activeDate !== undefined && <DaySummarySection key={activeDate} businessDate={activeDate} />}
    </section>
  );
}

export function ServiceSummaryScreen() {
  const access = useOpsPermissions();
  const queryClient = useQueryClient();
  const allowed = !access.error && !access.isLoading && moduleOpenFor('/security-ops/service-summary', access.hasPermission);
  const context = useServiceSummaryContext(allowed);
  const denied = context.error instanceof OpsApiError && context.error.status === 403;
  const [admittedRoot, setAdmittedRoot] = useState<number | null>(null);
  useEffect(() => {
    if (!allowed || denied) setAdmittedRoot(null);
    else if (context.isSuccess && !context.isFetching) setAdmittedRoot(context.data.root_division_id);
  }, [allowed, denied, context.isSuccess, context.isFetching, context.data]);
  // Keep all business-data hooks unmounted until a successful permission read.
  if (access.error) {
    return <LoadFailure what="права доступа к своду" onRetry={() => void queryClient.resetQueries({ queryKey: ["ops-me"], exact: true })} />;
  }
  if (access.isLoading || access.permissions === undefined) {
    return <p role="status" className="text-sm text-muted-foreground">Загрузка прав…</p>;
  }
  if (!allowed) {
    return <p className="text-sm text-muted-foreground">Недостаточно прав для просмотра свода по Службе.</p>;
  }
  if (denied) {
    return <p role="alert">Для свода по Службе нужен доступ к корню организации.</p>;
  }
  // Admit only a fresh context. Later transient refreshes preserve mounted drafts,
  // hidden and disabled until revalidated; a scope denial removes them entirely.
  const ready = context.isSuccess && !context.isFetching && admittedRoot === context.data.root_division_id;
  return (
    <>
      {context.isError
        ? <LoadFailure what="область свода по Службе" onRetry={() => void context.refetch()} isRetrying={context.isFetching} />
        : !ready && <p role="status">Проверка области свода по Службе…</p>}
      {admittedRoot !== null && (
        <fieldset hidden={!ready} disabled={!ready} className="min-w-0 border-0 p-0 m-0">
          <ServiceSummaryRootContext.Provider key={admittedRoot} value={admittedRoot}>
            <ServiceSummaryRootActionContext.Provider value={ready && context.data?.can_generate_root_summary === true}>
            <ServiceSummaryWorkspaceReadyContext.Provider value={ready}>
            <Suspense fallback={<div className="min-h-screen bg-background" />}>
              <ServiceSummaryBody workspaceReady={ready} />
            </Suspense>
            </ServiceSummaryWorkspaceReadyContext.Provider>
            </ServiceSummaryRootActionContext.Provider>
          </ServiceSummaryRootContext.Provider>
        </fieldset>
      )}
    </>
  );
}
