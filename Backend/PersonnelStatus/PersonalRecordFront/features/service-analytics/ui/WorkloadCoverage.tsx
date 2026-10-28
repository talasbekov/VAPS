"use client";

import { useState } from "react";
import type { WorkloadCoverageData } from "@/entities/service-analytics";
import { coverageMinutes, coverageTimestamp, paginateCoverage, validateCoveragePeriod, type WorkloadCoveragePeriod } from "@/features/service-analytics/model/workload-coverage";

const states: Record<string, string> = { PLANNED: "Запланировано", ACKNOWLEDGED: "Ознакомлен",
  ACTIVE: "Действует", COMPLETED: "Завершено", CANCELLED: "Отменено" };

export function WorkloadCoverage({ data, period, onPeriodChange, errorMessage, loading = false, onRetry }: {
  data?: WorkloadCoverageData;
  period?: WorkloadCoveragePeriod | null;
  onPeriodChange: (period: WorkloadCoveragePeriod) => void;
  errorMessage?: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const activePeriod = data?.period ?? period;
  const [from, setFrom] = useState(activePeriod?.from ?? "");
  const [to, setTo] = useState(activePeriod?.to ?? "");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  if (!activePeriod) return <div className="mt-4 text-sm text-muted-foreground" role="status">
    {errorMessage ?? "Сводка источников пока недоступна."}
    {onRetry && <button type="button" className="ml-2 underline" onClick={onRetry}>Повторить</button>}
  </div>;
  const pageData = paginateCoverage(data?.employees ?? [], page);
  const omitted = data?.sources.filter(source => source.state !== "INCLUDED").map(source => source.label) ?? [];
  return <section className="mt-6 border-t pt-4" aria-label="Источники занятости">
    <h3 className="text-sm font-semibold">Учтённое время и даты занятости</h3>
    <p className="mt-1 text-xs text-muted-foreground">
      {activePeriod.from} — {activePeriod.to}
      {data && <> · {data.scopeLabel} · время {data.timeZone}
        {" · "}Сформировано {coverageTimestamp(data.generatedAt, data.timeZone)}</>}
    </p>
    <form className="my-3 flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      const invalid = validateCoveragePeriod(from, to);
      setError(invalid);
      if (!invalid) onPeriodChange({ from, to });
    }}>
      <label className="flex flex-col gap-1 text-xs">С даты
        <input type="date" className="rounded-md border bg-background px-2 py-1.5 text-sm" value={from}
          required onChange={event => setFrom(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">По дату включительно
        <input type="date" className="rounded-md border bg-background px-2 py-1.5 text-sm" value={to}
          required onChange={event => setTo(event.target.value)} />
      </label>
      <button type="submit" disabled={loading} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">Показать период</button>
      <span className="py-1.5 text-xs text-muted-foreground">До {data?.maxPeriodDays ?? 31} дня</span>
    </form>
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
    {!data ? <p className="text-sm text-muted-foreground" role="status">{loading ? "Обновление сводки…" : errorMessage ?? "Сводка источников пока недоступна."}
      {onRetry && !loading && <button type="button" className="ml-2 underline" onClick={onRetry}>Повторить</button>}</p> : <>
    <p className="mb-2 text-xs text-muted-foreground">Точное время отражает только учтённые интервалы; записи без часов и недоступные источники не подтверждают свободное время.</p>
    {omitted.length > 0 && <p className="mb-3 text-xs font-medium" aria-label="Не включённые источники">Не включены: {omitted.join(", ")}. Сводка неполная.</p>}
    {data.state !== "AVAILABLE" ? <p className="rounded-md border p-3 text-sm" role="status">{data.reason}</p>
      : data.employees.length === 0 ? <p className="text-sm text-muted-foreground">За выбранный период в доступных источниках записей нет. Это не подтверждает свободное время сотрудников.</p>
      : <div className="space-y-3">{pageData.rows.map(person => <details key={person.employeeId} className="rounded-lg border">
        <summary className="cursor-pointer p-3 text-sm">
          <span className="font-medium">{person.safeLabel}</span><span className="text-muted-foreground"> · {person.divisionLabel}</span>
          <span className="mt-1 block text-xs">План по точным интервалам: {coverageMinutes(person.knownPlannedMinutes)}
            {" · "}Подтверждённый факт: {coverageMinutes(person.confirmedActualMinutes)}</span>
          <span className="mt-1 block text-xs text-muted-foreground">Без точного плана: {person.unknownPlannedRecords} записей
            {" · "}Без завершённого факта: {person.unknownActualRecords} записей</span>
        </summary>
        <div className="overflow-x-auto border-t">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Источники занятости: {person.safeLabel}</caption>
            <thead><tr className="border-b bg-muted/30">
              <th className="p-2" scope="col">Источник и даты</th><th className="p-2" scope="col">Состояние</th>
              <th className="p-2" scope="col">План в периоде</th><th className="p-2" scope="col">Факт в периоде</th>
            </tr></thead>
            <tbody>{person.records.map(record => <tr key={record.id} className="border-b last:border-0">
              <td className="p-2"><span className="font-medium">{record.sourceLabel}</span><span className="block">{record.label}</span>
                <span className="block text-muted-foreground">{record.dateFrom} — {record.dateTo}</span></td>
              <td className="p-2">{states[record.state] ?? record.state}
                {record.sourceChanged && <span className="block text-muted-foreground">Исходная запись изменена; план исключён.</span>}</td>
              <td className="p-2">{!record.includedInPlan ? "Не включён" : coverageMinutes(record.plannedMinutes)}
                <span className="block text-muted-foreground">{record.timing === "DATE_ONLY" ? "Время не задано" :
                  `${coverageTimestamp(record.plannedStartAt, data.timeZone)} — ${coverageTimestamp(record.plannedEndAt, data.timeZone)}`}</span></td>
              <td className="p-2">{coverageMinutes(record.actualMinutes)}
                {record.actualStartAt && <span className="block text-muted-foreground">{coverageTimestamp(record.actualStartAt, data.timeZone)}
                  {" — "}{coverageTimestamp(record.actualEndAt, data.timeZone)}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>)}</div>}
    {data.state === "AVAILABLE" && pageData.pages > 1 && <nav aria-label="Страницы сотрудников" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span>Страница {pageData.page} из {pageData.pages} · Всего сотрудников с записями: {data.employees.length}</span>
      <div className="flex gap-2">
        <button type="button" disabled={pageData.page === 1} className="rounded-md border px-3 py-1.5 disabled:opacity-50" onClick={() => setPage(pageData.page - 1)}>Назад</button>
        <button type="button" disabled={pageData.page === pageData.pages} className="rounded-md border px-3 py-1.5 disabled:opacity-50" onClick={() => setPage(pageData.page + 1)}>Далее</button>
      </div>
    </nav>}
    <details className="mt-3 text-xs text-muted-foreground" aria-label="Источники и ограничения">
      <summary className="cursor-pointer py-1 font-medium">Источники и ограничения</summary>
      <ul className="mt-2 space-y-1">
        {data.sources.map(source => <li key={source.code}>
          <span className="font-medium">{source.label}: {source.state === "INCLUDED" ? "включены в доступной области" : "не включены"}.</span>{" "}{source.reason}
        </li>)}
      </ul>
      <ul className="mt-2 space-y-1">{data.limitations.map(note => <li key={note}>{note}</li>)}</ul>
    </details>
    </>}
  </section>;
}
