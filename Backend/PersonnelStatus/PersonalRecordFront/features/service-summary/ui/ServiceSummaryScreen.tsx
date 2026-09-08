"use client";

// «Свод по Службе» (Plane №992) — рабочее место оперативного дежурного:
// готовность сдачи расхода ПО ВСЕЙ ОРГАНИЗАЦИИ на дату или диапазон дат.
// Видимость — по РОЛИ (DUTY_OFFICER), тем же приёмом, что у вкладки «Свод
// департамента» (Plane №990): право `daily_report.generate` шире одной этой
// роли, и гейт по праву открыл бы экран, например, ответственному за сбор
// сил — которому здесь смотреть не на что (его область — один департамент).
import { Suspense, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { localIsoDate, parseIsoDate } from "@/shared/lib/date";
import { useServiceDateRange } from "../model/date-range";
import { DaySummarySection } from "./DaySummarySection";

function dateLabel(iso: string): string {
  const parsed = parseIsoDate(iso);
  return parsed === null ? iso : format(parsed, "dd MMMM yyyy", { locale: ru });
}

function ServiceSummaryBody() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("dateFrom") ?? undefined;
  const toParam = searchParams.get("dateTo") ?? undefined;

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value === "") next.delete(key);
      else next.set(key, value);
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );
  // ОДНИМ вызовом снимает ОБА параметра: два последовательных `setParam`
  // читали бы один и тот же устаревший `searchParams` (React ещё не
  // перерендерил между ними) — второй вызов отменил бы эффект первого,
  // сняв только `dateTo`.
  const resetDates = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("dateFrom");
    next.delete("dateTo");
    const query = next.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  }, [router, pathname, searchParams]);

  const range = useServiceDateRange(fromParam, toParam);
  const { hasPermission, isLoading: permissionsLoading, roles } = useOpsPermissions();
  const isDutyOfficer = roles.some((role) => role.code === "DUTY_OFFICER");
  const canRead = hasPermission("status.view");

  if (permissionsLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка прав…</p>;
  }
  if (!canRead || !isDutyOfficer) {
    return (
      <p className="text-sm text-muted-foreground">
        «Свод по Службе» открыт только оперативному дежурному.
      </p>
    );
  }

  const effectiveFrom = fromParam ?? range.defaultDate ?? "";

  return (
    <section role="region" aria-label="Свод по Службе" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
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
              onSelect={(date) => date && setParam("dateFrom", localIsoDate(date))}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        <span className="text-sm text-muted-foreground">по</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-auto justify-start text-left font-normal">
              <CalendarIcon className="mr-2 h-4 w-4" />
              {toParam !== undefined ? dateLabel(toParam) : "та же дата"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={toParam !== undefined ? (parseIsoDate(toParam) ?? undefined) : undefined}
              onSelect={(date) => date && setParam("dateTo", localIsoDate(date))}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        {(fromParam !== undefined || toParam !== undefined) && (
          <Button variant="ghost" size="sm" onClick={resetDates}>
            Вернуть «завтра»
          </Button>
        )}
      </div>

      {range.isResolving && (
        <p className="text-sm text-muted-foreground">Загрузка даты по умолчанию…</p>
      )}
      {!range.isResolving &&
        range.dates.map((date) => <DaySummarySection key={date} businessDate={date} />)}
    </section>
  );
}

export function ServiceSummaryScreen() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ServiceSummaryBody />
    </Suspense>
  );
}
