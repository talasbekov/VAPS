"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { BarChart3, Download, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportSectionCard } from "@/components/reports/report-section-card";
import { opsApiClient } from "@/lib/ops-api";
import { friendlyOpsErrorMessage } from "@/lib/ops-errors";
import { useToast } from "@/shared/hooks/use-toast";
import { useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import { useOpsReadSnapshot } from "@/hooks/use-ops-read-snapshot";

type ReportKind = "staffing" | "absences";
type Filters = Record<string, string>;
interface ReportDivision { id: number; name: string; ancestors: string[] }
interface ReportEnvelope {
  count: number;
  page: number;
  page_size: number;
  next_page: number | null;
  previous_page: number | null;
  divisions: ReportDivision[];
  basis: "current_staffing";
  as_of: string;
}
interface StaffingReport extends ReportEnvelope {
  totals: { staff_total: number; occupied: number; vacancies: number; dismissed_in_slot: number };
  rows: {
    staff_unit_id: number;
    division_id: number;
    division_name: string;
    ancestors: string[];
    position: string | null;
    employee_name: string | null;
    personnel_number: string | null;
    rank: string | null;
    hire_date: string | null;
    occupancy: "occupied" | "vacant" | "dismissed_in_slot";
  }[];
}
interface AbsenceReport extends ReportEnvelope {
  date_from: string;
  date_to: string;
  totals: { person_days: number; unique_people: number };
  rows: { code: string; name: string; person_days: number; unique_people: number }[];
}

function reportUrl(kind: ReportKind, filters: Filters): string {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ""));
  return `/api/reports/reports/${kind}/?${query.toString()}`;
}

interface PersonnelPreview<T> { report: T | null; divisions: ReportDivision[]; asOf: string; filters: Filters }
const EMPTY_PREVIEW = { report: null, divisions: [] as ReportDivision[], asOf: "", filters: {} };

function usePersonnelReport<T extends ReportEnvelope>(kind: ReportKind, allowed: boolean, rightsLoading: boolean, filters: Filters) {
  const feature = useOpsReadAccess(kind === "staffing" ? "orgstructure.view" : "status.view");
  const snapshot = useOpsReadSnapshot<PersonnelPreview<T>>({ ...feature,
    allowed: feature.allowed && allowed && !rightsLoading }, EMPTY_PREVIEW);
  const { report, divisions, asOf } = snapshot.value;
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentFilters = useRef(filters);
  const loadedScope = useRef(feature.scope);
  currentFilters.current = filters;
  const requestVersion = useRef(0);
  const { toast } = useToast();

  const invalidate = useCallback(() => {
    requestVersion.current += 1;
    snapshot.setValue(previous => ({ ...previous, report: null }));
    setError(null);
    setLoading(false);
  }, [snapshot.setValue]);

  const load = useCallback(async (filters: Filters = {}, page = 1) => {
    if (!snapshot.isCurrent()) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    snapshot.setValue(previous => ({ ...previous, report: null }));
    try {
      const result = await opsApiClient.get<T>(reportUrl(kind, { ...filters, page: String(page) }));
      if (version !== requestVersion.current || !snapshot.isCurrent()) return;
      snapshot.setValue({ report: result, divisions: result.divisions, asOf: result.as_of, filters: { ...filters } });
    } catch (failure) {
      if (version === requestVersion.current && snapshot.isCurrent()) {
        const status = (failure as { status?: number } | null)?.status;
        if (status === 401 || status === 403 || status === 404) snapshot.setValue(EMPTY_PREVIEW);
        setError(friendlyOpsErrorMessage(failure, "Нет доступа к данным этого отчёта в выбранной области."));
      }
    } finally {
      if (version === requestVersion.current && snapshot.isCurrent()) setLoading(false);
    }
  }, [kind, snapshot.isCurrent, snapshot.setValue]);

  useEffect(() => {
    const changedScope = loadedScope.current !== feature.scope;
    loadedScope.current = feature.scope;
    setExporting(false);
    if (!rightsLoading && allowed) void load(changedScope
      ? { ...currentFilters.current, division_id: "" } : currentFilters.current);
    else invalidate();
    return () => { requestVersion.current += 1; };
  }, [allowed, rightsLoading, feature.scope, load, invalidate]);

  const download = async () => {
    if (kind !== "staffing" || report === null || loading || exporting || !snapshot.canUseValue()) return;
    setExporting(true);
    setError(null);
    // Export the same loaded filters; preview page limits never affect the file.
    const filters: Filters = { ...snapshot.value.filters, export: "xlsx" };
    try {
      const { blob, filename } = await opsApiClient.download(reportUrl(kind, filters));
      if (!snapshot.canUseValue()) return;
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename ?? "staffing.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Отчёт скачан", description: "В файл включены все записи выбранной области." });
    } catch (failure) {
      if (snapshot.canUseValue()) setError(friendlyOpsErrorMessage(failure, "Нет доступа к выгрузке этого отчёта."));
    } finally {
      if (snapshot.isCurrent()) setExporting(false);
    }
  };

  return { report, divisions, asOf, loading, exporting, error, load, invalidate, download, scope: feature.scope };
}

function DivisionFilter({ id, value, divisions, disabled, onChange }: {
  id: string; value: string; divisions: ReportDivision[]; disabled?: boolean; onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2 min-w-0">
      <label htmlFor={id} className="text-sm font-medium">Подразделение</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
        className="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm">
        <option value="">Вся доступная область</option>
        {divisions.map((division) => <option key={division.id} value={division.id}>
          {[...division.ancestors, division.name].join(" › ")}
        </option>)}
      </select>
    </div>
  );
}

function ReportPagination({ report, disabled, onPage }: { report: ReportEnvelope; disabled: boolean; onPage: (page: number) => void }) {
  if (report.count <= report.page_size) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {Math.min((report.page - 1) * report.page_size + 1, report.count)}–{Math.min(report.page * report.page_size, report.count)} из {report.count}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={disabled || report.previous_page === null}
          onClick={() => report.previous_page !== null && onPage(report.previous_page)}>Предыдущая страница</Button>
        <Button variant="outline" size="sm" disabled={disabled || report.next_page === null}
          onClick={() => report.next_page !== null && onPage(report.next_page)}>Следующая страница</Button>
      </div>
    </div>
  );
}

const occupancyLabels = { occupied: "Занят", vacant: "Вакантен", dismissed_in_slot: "Занят уволенным" };

function StaffingCard({ allowed, rightsLoading }: { allowed: boolean; rightsLoading: boolean }) {
  const [division, setDivision] = useState("");
  const filters = { division_id: division };
  const state = usePersonnelReport<StaffingReport>("staffing", allowed, rightsLoading, filters);
  useEffect(() => setDivision(""), [state.scope]);
  return (
    <ReportSectionCard className="md:col-span-2 lg:col-span-3" role="region" aria-label="Штатное расписание"
      icon={Users} iconClassName="text-purple-600" title="Штатное расписание"
      description="Текущий штат: сотрудники, должности, звания и свободные единицы. Excel содержит всю выбранную область.">
      {rightsLoading ? <p role="status">Проверка доступа…</p> : !allowed ?
        <p className="text-sm text-muted-foreground">Нет доступа к данным штатного расписания.</p> : <>
          <div className="flex flex-wrap items-end gap-3">
            <DivisionFilter id="staffing-division" value={division} divisions={state.divisions} disabled={state.exporting}
              onChange={(value) => { setDivision(value); state.invalidate(); }} />
            <Button onClick={() => void state.load(filters)} disabled={state.loading || state.exporting}>
              {state.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Показать штат
            </Button>
            <Button variant="outline" onClick={() => void state.download()} disabled={state.report === null || state.loading || state.exporting}>
              {state.exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Скачать Excel
            </Button>
          </div>
          {state.error && <p role="alert" className="text-sm text-destructive-ink">{state.error}</p>}
          {state.loading && <p role="status" className="text-sm text-muted-foreground">Загрузка штатного расписания…</p>}
          {state.report && <>
            <p className="text-sm font-medium">Штат: {state.report.totals.staff_total} · Занято: {state.report.totals.occupied} · Вакансии: {state.report.totals.vacancies}</p>
            {state.report.totals.dismissed_in_slot > 0 && <p className="text-sm text-amber-700">
              Заняты уволенными: {state.report.totals.dismissed_in_slot}. Эти единицы учтены как вакансии.
            </p>}
            {state.report.rows.length === 0 ? <p className="text-sm text-muted-foreground">Штатные единицы в выбранной области не найдены.</p> :
              <Table aria-label="Штатные единицы">
                <TableHeader><TableRow>
                  <TableHead>Подразделение</TableHead><TableHead>Должность</TableHead><TableHead>Сотрудник</TableHead>
                  <TableHead>Табельный №</TableHead><TableHead>Звание</TableHead><TableHead>Состояние</TableHead>
                </TableRow></TableHeader>
                <TableBody>{state.report.rows.map((row) => <TableRow key={row.staff_unit_id}>
                  <TableCell>{row.division_name}{row.ancestors.length > 0 && <span className="block text-xs text-muted-foreground">{row.ancestors.join(" › ")}</span>}</TableCell>
                  <TableCell>{row.position ?? "—"}</TableCell><TableCell>{row.employee_name || "—"}</TableCell>
                  <TableCell>{row.personnel_number ?? "—"}</TableCell><TableCell>{row.rank ?? "—"}</TableCell>
                  <TableCell className={row.occupancy === "dismissed_in_slot" ? "text-amber-700" : undefined}>{occupancyLabels[row.occupancy]}</TableCell>
                </TableRow>)}</TableBody>
              </Table>}
            <ReportPagination report={state.report} disabled={state.loading || state.exporting} onPage={(page) => void state.load(filters, page)} />
          </>}
        </>}
    </ReportSectionCard>
  );
}

function AbsenceCard({ allowed, rightsLoading }: { allowed: boolean; rightsLoading: boolean }) {
  const [division, setDivision] = useState("");
  // The server owns the business timezone and the default 30-day interval.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filters = { division_id: division, date_from: dateFrom, date_to: dateTo };
  const state = usePersonnelReport<AbsenceReport>("absences", allowed, rightsLoading, filters);
  useEffect(() => setDivision(""), [state.scope]);
  useEffect(() => {
    if (state.report) { setDateFrom(state.report.date_from); setDateTo(state.report.date_to); }
  }, [state.report]);
  const today = state.asOf || format(new Date(), "yyyy-MM-dd");
  const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000 + 1;
  const periodError = !dateFrom || !dateTo ? "Выберите обе даты." : dateFrom > dateTo ? "Начало периода должно быть не позже окончания." :
    dateTo > today ? "Выберите период до сегодняшней даты." : !Number.isFinite(days) || days > 366 ? "Период не должен превышать 366 дней." : null;
  return (
    <ReportSectionCard className="md:col-span-2 lg:col-span-3" role="region" aria-label="Статистика отсутствий"
      icon={BarChart3} iconClassName="text-blue-600" title="Статистика отсутствий"
      description="Фактические отсутствия за период по текущему составу подразделений. Даты включаются целиком; период — до 366 дней.">
      {rightsLoading ? <p role="status">Проверка доступа…</p> : !allowed ?
        <p className="text-sm text-muted-foreground">Нет доступа к статусам сотрудников.</p> : <>
          <div className="flex flex-wrap items-end gap-3">
            <DivisionFilter id="absences-division" value={division} divisions={state.divisions}
              onChange={(value) => { setDivision(value); state.invalidate(); }} />
            <div className="space-y-2"><label htmlFor="absences-from" className="text-sm font-medium">С</label>
              <Input id="absences-from" type="date" className="w-40" max={today} value={dateFrom}
                onChange={(event) => { setDateFrom(event.target.value); state.invalidate(); }} /></div>
            <div className="space-y-2"><label htmlFor="absences-to" className="text-sm font-medium">По</label>
              <Input id="absences-to" type="date" className="w-40" max={today} value={dateTo}
                onChange={(event) => { setDateTo(event.target.value); state.invalidate(); }} /></div>
            <Button onClick={() => void state.load(filters)} disabled={state.loading || periodError !== null}>
              {state.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сформировать
            </Button>
          </div>
          {periodError && !state.loading && <p role="alert" className="text-sm text-destructive-ink">{periodError}</p>}
          {state.error && <p role="alert" className="text-sm text-destructive-ink">{state.error}</p>}
          <p className="text-sm text-muted-foreground">Один день отсутствия одного сотрудника — один человеко-день. В общем итоге каждый сотрудник считается один раз; по разным типам он может встречаться повторно. Исторические статусы сопоставляются с текущим штатом.</p>
          {state.loading && <p role="status" className="text-sm text-muted-foreground">Формирование статистики…</p>}
          {state.report && <>
            <p className="text-sm font-medium">Дней отсутствия: {state.report.totals.person_days} · Сотрудников: {state.report.totals.unique_people}</p>
            {state.report.rows.length === 0 ? <p className="text-sm text-muted-foreground">За выбранный период фактических отсутствий в этой области не найдено.</p> :
              <Table aria-label="Отсутствия по типам">
                <TableHeader><TableRow><TableHead>Тип отсутствия</TableHead><TableHead>Человеко-дни</TableHead><TableHead>Уникальные сотрудники</TableHead><TableHead>Доля дней</TableHead></TableRow></TableHeader>
                <TableBody>{state.report.rows.map((row) => {
                  const share = state.report!.totals.person_days > 0 ? row.person_days / state.report!.totals.person_days * 100 : 0;
                  return <TableRow key={row.code}>
                    <TableCell>{row.name}</TableCell><TableCell className="tabular-nums">{row.person_days}</TableCell><TableCell className="tabular-nums">{row.unique_people}</TableCell>
                    <TableCell className="min-w-40"><div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-muted" aria-hidden="true"><div className="h-2 rounded-full bg-blue-500" style={{ width: `${share}%` }} /></div>
                      <span className="text-xs tabular-nums">{share.toFixed(1)}%</span>
                    </div></TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>}
            <ReportPagination report={state.report} disabled={state.loading} onPage={(page) => void state.load(filters, page)} />
          </>}
        </>}
    </ReportSectionCard>
  );
}

export function PersonnelReportCards({ canReadStaffing, canReadAbsences, permissionsLoading }: {
  canReadStaffing: boolean; canReadAbsences: boolean; permissionsLoading: boolean;
}) {
  return <>
    <AbsenceCard allowed={canReadAbsences} rightsLoading={permissionsLoading} />
    <StaffingCard allowed={canReadStaffing} rightsLoading={permissionsLoading} />
  </>;
}
