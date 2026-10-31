"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, MousePointer2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LoadFailure } from "@/components/load-failure";
import { STATUS_LETTERS, letterForStatus } from "@/entities/status-calendar";
import { useStatusCalendarMonth } from "@/hooks/use-status-calendar";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { canManageStatusInDivision } from "@/entities/status/access";
import { EditStatusDialog } from "@/features/employee-status-update/ui/EditStatusDialog";
import { useToast } from "@/shared/hooks/use-toast";
import { MONTH_NAMES, isoDate } from "./StatusMonthGrid";

interface Props {
  month: string;
  divisionId?: string | null;
  search?: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}
type Cell = { id: string; date: string };
const humanDate = (date: string) => new Date(date + "T12:00:00")
  .toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const keyOf = (id: string, date: string) => id + "|" + date;
function statusTone(code: string) {
  if (code === "IN_SERVICE") return "text-muted-foreground";
  if (code === "DUTY" || code === "GEV" || code.startsWith("DUTY_")) return "bg-blue-50/70 text-blue-900  ";
  if (code === "REST_AFTER_DUTY") return "bg-sky-50/70 text-sky-900  ";
  if (["IN_EVENT", "EVENT_ASSIGNMENT", "EVENT_ASSIGNMENT_GROUP"].includes(code)) return "bg-violet-50/70 text-violet-900  ";
  if (code === "SICK_LEAVE") return "bg-rose-50/60 text-rose-900  ";
  if (code === "COMMAND") return "bg-slate-100/70 text-slate-800  ";
  return "bg-amber-50/70 text-amber-900  ";
}

export function StatusMatrix({ month, divisionId = null, search = "", selectedDate, onSelectDate }: Props) {
  const [page, setPage] = useState(1);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [active, setActive] = useState<Cell | null>(null);
  const [editor, setEditor] = useState<{ id: string; name: string; divisionId: number | undefined; date: string; code: string } | null>(null);
  const access = useOpsPermissions(), client = useQueryClient(), { toast } = useToast();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const { data, isLoading, isError, refetch, isFetching } = useStatusCalendarMonth({ month, divisionId, page, search });
  const names = useMemo(() => new Map((data?.catalog ?? []).map(row => [row.code, row.name])), [data?.catalog]);
  const seen = useMemo(() => [...new Set((data?.results ?? []).flatMap(row => row.days))].sort(), [data?.results]);
  const title = MONTH_NAMES[Number(month.slice(5)) - 1] + " " + month.slice(0, 4);
  const today = isoDate(new Date());
  const pageCount = data ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1;
  const selected = data?.results.find(row => row.id === employeeId);
  const dayIndex = data?.days.indexOf(selectedDate) ?? -1;
  const code = selected?.days[dayIndex];
  const totals = selected ? [...new Set(selected.days)].map(status => ({
    code: status, count: selected.days.filter(value => value === status).length,
  })) : [];
  const fallback = data?.results[0] && { id: data.results[0].id,
    date: data.days.includes(selectedDate) ? selectedDate : data.days[0] };
  const activeCell = active && data?.results.some(row => row.id === active.id) && data.days.includes(active.date) ? active : fallback;
  const canEdit = (id: string | undefined) => !access.isLoading && !access.error &&
    canManageStatusInDivision(access, id && Number.isSafeInteger(Number(id)) ? Number(id) : undefined);
  const edit = (row: NonNullable<typeof data>["results"][number], date: string, status: string) => {
    if (!canEdit(row.division?.id) || isFetching) return;
    setEmployeeId(row.id); onSelectDate(date);
    setEditor({ id: row.id, name: row.name, divisionId: row.division ? Number(row.division.id) : undefined, date, code: status });
  };
  const saved = () => {
    setEditor(null);
    for (const key of ["status-calendar-month", "status-calendar-day", "calendar-status-editor", "staff-units-page", "staff-units-by-directorate", "ops-daily", "strength-report", "ops-statuses", "daily-expense-board", "service-summary", "traffic-light"]) {
      void client.invalidateQueries({ queryKey: [key] });
    }
    toast({ title: "Статус сохранён", description: "Календарь и расход обновляются." });
  };

  const move = (event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, columnIndex: number) => {
    if (!data?.results.length || !data.days.length) return;
    let row = rowIndex, column = columnIndex;
    switch (event.key) {
      case "ArrowLeft": column--; break;
      case "ArrowRight": column++; break;
      case "ArrowUp": row--; break;
      case "ArrowDown": row++; break;
      case "Home": column = 0; if (event.ctrlKey) row = 0; break;
      case "End": column = data.days.length - 1; if (event.ctrlKey) row = data.results.length - 1; break;
      default: return;
    }
    event.preventDefault();
    row = Math.max(0, Math.min(data.results.length - 1, row));
    column = Math.max(0, Math.min(data.days.length - 1, column));
    const next = { id: data.results[row].id, date: data.days[column] };
    setActive(next);
    const button = buttons.current.get(keyOf(next.id, next.date));
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return <section className="min-w-0 space-y-3" aria-label="Шахматка статусов">
    {isError ? <LoadFailure what="шахматку статусов" onRetry={() => { void refetch(); }} isRetrying={isFetching} /> : <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{title}</h3>
      {data && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <span>Показаны {data.results.length} из {data.count}{pageCount > 1 && ` · страница ${data.page} из ${pageCount}`}</span>
        {pageCount > 1 && <>
        <Button variant="outline" size="sm" className="min-h-10 lg:min-h-8" disabled={data.page <= 1 || isFetching}
          onClick={() => { setPage(value => Math.max(1, value - 1)); setEmployeeId(null); }}>Назад</Button>
        <Button variant="outline" size="sm" className="min-h-10 lg:min-h-8" disabled={data.page >= pageCount || isFetching}
          onClick={() => { setPage(value => value + 1); setEmployeeId(null); }}>Вперёд</Button>
        </>}
      </div>}
    </div>
    <p className="text-xs text-muted-foreground" id="status-matrix-help">
      Нажмите ячейку, чтобы изменить статус. Без права изменения появятся сведения для просмотра.
      <span className="hidden sm:inline"> Стрелки перемещают по дням и сотрудникам, Enter открывает ячейку.</span>
      <span className="block lg:hidden">Прокручивайте таблицу по горизонтали — ФИО остаётся слева.</span>
    </p>
    {isLoading ? <p role="status" className="rounded-md border p-6 text-sm text-muted-foreground">Загружаем шахматку…</p>
      : data?.results.length ? <div role="region" aria-label={"Матрица статусов за " + title}
        className="max-h-[65vh] min-w-0 max-w-full overflow-auto rounded-lg border bg-background [--status-name:9rem] [--status-day:2.875rem] scroll-pl-[var(--status-name)] scroll-pt-12 lg:[--status-name:12rem] lg:[--status-day:1.75rem]"
        aria-busy={isFetching}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-xs"
          style={{ minWidth: `calc(var(--status-name) + ${data.days.length} * var(--status-day))` }}
          aria-describedby="status-matrix-help">
          <caption className="sr-only">Статусы сотрудников по дням, {title}</caption>
          <colgroup><col className="w-[var(--status-name)]" /><col span={data.days.length} /></colgroup>
          <thead><tr>
            <th scope="col" className="sticky left-0 top-0 z-30 border-b bg-muted px-2 py-2 text-left font-medium shadow-[1px_0_0_0_hsl(var(--border))]">Сотрудник · ФИО</th>
            {(data?.days ?? []).map(date => {
              const weekend = [0, 6].includes(new Date(date + "T12:00:00").getDay());
              return <th key={date} scope="col" title={humanDate(date)} aria-label={humanDate(date)} aria-current={date === today ? "date" : undefined}
                className={["sticky top-0 z-20 border-b px-0.5 py-1.5 text-center font-medium tabular-nums",
                  date === selectedDate ? "bg-primary/10 text-primary shadow-[inset_0_-2px_0_0_hsl(var(--primary))]" : weekend ? "bg-muted text-muted-foreground" : "bg-background text-muted-foreground"].join(" ")}>
                <span className={"mx-auto block w-6 rounded leading-5 " + (date === today ? "bg-primary text-primary-foreground" : "")}>{Number(date.slice(8))}</span>
                <span className={weekend ? "block text-[10px] font-normal leading-3" : "block text-[10px] font-normal leading-3 opacity-70"}>
                  {new Date(date + "T12:00:00").toLocaleDateString("ru-RU", { weekday: "short" })}
                </span>
              </th>;
            })}
          </tr></thead>
          <tbody>{data.results.map((row, rowIndex) => <tr key={row.id}>
            <th scope="row" title={[row.name, row.division?.name].filter(Boolean).join(" · ")}
              className={"sticky left-0 z-10 overflow-hidden border-b px-2 py-1 text-left font-normal shadow-[1px_0_0_0_hsl(var(--border))] " + (employeeId === row.id ? "bg-accent" : "bg-background")}>
              <span className="block truncate font-medium leading-4 text-foreground">{row.name}</span>
              <span className="block truncate text-[10px] leading-3 text-muted-foreground">{row.division?.name || "Без подразделения"}</span>
            </th>
            {row.days.map((status, column) => {
              const date = data.days[column], label = names.get(status) ?? status;
              const chosen = row.id === employeeId && date === selectedDate;
              const weekend = [0, 6].includes(new Date(date + "T12:00:00").getDay());
              return <td key={date} title={row.name + " · " + humanDate(date) + " · " + label}
                className={["border-b border-l p-0 text-center", weekend ? "bg-muted/40" : "",
                  date === selectedDate ? "bg-primary/5" : "", date === today ? "border-l-primary/30" : ""].join(" ")}>
                <button type="button" aria-label={row.name + ", " + humanDate(date) + ", " + label}
                  aria-pressed={chosen} tabIndex={activeCell?.id === row.id && activeCell.date === date ? 0 : -1}
                  ref={element => { const key = keyOf(row.id, date); if (element) buttons.current.set(key, element); else buttons.current.delete(key); }}
                  onFocus={() => setActive({ id: row.id, date })} onKeyDown={event => move(event, rowIndex, column)}
                  onClick={() => { setEmployeeId(row.id); onSelectDate(date); edit(row, date, status); }}
                  className={["block h-11 w-full rounded-sm px-0.5 font-medium leading-none hover:ring-1 hover:ring-inset hover:ring-primary/40 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary lg:h-8",
                    chosen ? "bg-primary/15 font-semibold text-primary ring-2 ring-inset ring-primary" : statusTone(status)].join(" ")}>
                  {letterForStatus(status, label)}
                </button>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div> : <p className="rounded-lg border p-6 text-sm text-muted-foreground">
        {data?.count ? "На этой странице сотрудников нет. Вернитесь на предыдущую страницу." : "Сотрудники не найдены. Измените поиск или подразделение."}
      </p>}
    {Boolean(data?.results.length) && (selected && code ? <section aria-label="Выбранная ячейка" className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 break-words"><h4 className="text-sm font-semibold">{selected.name}</h4>
          <p className="text-xs text-muted-foreground">{[selected.rank, selected.division?.name].filter(Boolean).join(" · ") || "Подразделение не указано"}</p>
          <p className="mt-1 text-sm">{humanDate(selectedDate)} · <strong>{names.get(code) ?? code}</strong></p></div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link className="inline-flex min-h-10 items-center text-xs text-primary underline underline-offset-4 lg:min-h-8" href={"/security-ops/profile/" + encodeURIComponent(selected.id) + "/"}>Открыть профиль</Link>
          {canEdit(selected.division?.id) ? <Button size="sm" className="min-h-10 lg:min-h-8" disabled={isFetching} onClick={() => edit(selected, selectedDate, code)}><Pencil className="mr-1 h-4 w-4" />Изменить статус</Button>
            : <span className="text-xs text-muted-foreground">Только просмотр — изменение доступно ответственному подразделения.</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Дней по статусам за месяц">{totals.map(row => <span key={row.code}>{names.get(row.code) ?? row.code} <strong className="tabular-nums">{row.count}</strong></span>)}</div>
    </section> : <div className="flex items-center gap-2 text-xs text-muted-foreground"><MousePointer2 className="h-4 w-4 shrink-0" /><p>Выберите ячейку: здесь появятся статус, итоги месяца и действия.</p></div>)}
    {data && <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs" aria-label="Обозначения статусов">
      {seen.map(status => <li className="inline-flex items-center gap-1.5" key={status}><strong className={"inline-flex h-5 min-w-6 items-center justify-center rounded border px-1 " + statusTone(status)}>{letterForStatus(status, names.get(status) ?? status)}</strong><span>{names.get(status) ?? status}</span></li>)}
      {data.results.length > 0 && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-4 w-4 rounded border bg-muted" />Выходные</li>}
    </ul>}
    {data && <p className="text-xs text-muted-foreground">«{STATUS_LETTERS.IN_SERVICE}» — в строю по данным статусов. Здесь показан итог дня; часы смен и фактическое заступление смотрите в журнале дежурств.</p>}
    </>}
    {editor && data && !access.error && canManageStatusInDivision(access, editor.divisionId) && <EditStatusDialog
      key={editor.id + "|" + editor.date} open employeeId={editor.id} employeeName={editor.name}
      calendar={{ date: editor.date, code: editor.code }}
      onOpenChange={open => { if (!open) setEditor(null); }} onSuccess={saved} />}
  </section>;
}
