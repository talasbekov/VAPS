"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { opsApiClient } from "@/lib/ops-api";
import { statusPeriod } from "./StatusDetails";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const fallbackDivision = (id: number) => `Подразделение №${id}`;

/** Read immutable people and pinned child versions, never today's status API. */
export function VersionSnapshot({ id, labelOfDivision = fallbackDivision, ancestors = [] }: {
  id: number;
  labelOfDivision?: (id: number) => string;
  ancestors?: number[];
}) {
  const access = useOpsPermissions();
  const allowed = !access.isLoading && !access.error && access.hasPermission("status.view");
  const cyclic = ancestors.includes(id) || ancestors.length >= 16;
  const [openSource, setOpenSource] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const detail = useQuery({
    queryKey: ["daily-expense-board", "summary-snapshot", id],
    queryFn: () => opsApiClient.get<unknown>(`/api/operations/daily-submissions/${id}/`),
    enabled: allowed && !cyclic,
    retry: false,
  });
  if (!allowed) return <p className="text-sm text-muted-foreground">Для просмотра состава требуется доступ к статусам.</p>;
  if (cyclic) return <p role="alert">Не удалось открыть состав: некорректная цепочка версий.</p>;
  if (detail.isPending) return <p role="status" className="text-sm text-muted-foreground">Загрузка снимка версии…</p>;
  if (detail.isError) return <div role="alert" className="space-y-2 text-sm">
    <p>Не удалось открыть снимок версии</p>
    <Button variant="outline" size="sm" disabled={detail.isFetching} onClick={() => void detail.refetch()}>Повторить загрузку состава</Button>
  </div>;
  const response = record(detail.data);
  const snapshot = record(response?.snapshot);
  const roster = Array.isArray(snapshot?.roster) ? snapshot.roster.map(record) : null;
  const facts = Array.isArray(snapshot?.rows) ? snapshot.rows.map(record) : null;
  const sources = snapshot?.sources === undefined ? [] : Array.isArray(snapshot.sources) ? snapshot.sources.map(record) : null;
  if (!roster || !facts || !sources || roster.some(row => !row || !positiveId(row.employee_id)) ||
      facts.some(row => !row || !positiveId(row.employee_id) || !text(row.status_type_code)) ||
      sources.some(row => !row || !positiveId(row.submission_id) || !positiveId(row.division_id) || !positiveId(row.version))) {
    return <p role="alert" className="text-sm">Не удалось показать состав этой версии. Обновите страницу и повторите попытку.</p>;
  }
  const people = roster as RecordValue[];
  const rows = facts as RecordValue[];
  const pins = sources as RecordValue[];
  const employeeIds = new Set(people.map(person => person.employee_id));
  if (employeeIds.size !== people.length || rows.some(row => !employeeIds.has(row.employee_id))) {
    return <p role="alert" className="text-sm">Не удалось показать состав этой версии. Обновите страницу и повторите попытку.</p>;
  }
  const catalog = new Map<string, string>();
  for (const entry of Array.isArray(snapshot?.catalog) ? snapshot.catalog : []) {
    const status = record(entry);
    if (status && text(status.code) && text(status.name)) catalog.set(text(status.code), text(status.name));
  }
  const names = (person: RecordValue) => text(person.full_name) || `Сотрудник №${person.employee_id}`;
  const matching = people.filter(person => `${names(person)} ${text(person.rank)} ${text(person.position_name)}`.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")));
  const count = Math.max(1, Math.ceil(matching.length / 20));
  const current = Math.min(page, count);
  return <div className="min-w-0 space-y-3 rounded-lg border bg-background p-3 text-sm">
    <div>
      {text(snapshot?.division_title) && <p className="font-medium">{text(snapshot?.division_title)}</p>}
      <p className="text-muted-foreground">{pins.length > 0 ? "Непосредственный состав: " : "В списке "}{people.length}, отклонений {rows.length}{text(response?.reason) && ` · причина: ${text(response?.reason)}`}{text(response?.sanction) && ` · санкция: ${text(response?.sanction)}`}</p>
      {pins.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Ниже — непосредственный состав. Сдачи управлений открываются отдельно в версиях, включённых в этот свод.</p>}
    </div>
    {people.length > 20 && <input aria-label="Поиск в сохранённом составе" className="h-9 w-full rounded-md border bg-background px-3" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="ФИО, звание или должность" />}
    {people.length === 0 ? <p>{pins.length > 0 ? "В непосредственном составе нет сотрудников. Состав управлений — в сдачах ниже." : "В сохранённом составе нет сотрудников."}</p> : <>
      <ul aria-label="Сохранённый состав" className="max-h-80 divide-y overflow-y-auto">
        {matching.slice((current - 1) * 20, current * 20).map(person => {
          const statuses = rows.filter(row => row.employee_id === person.employee_id);
          return <li key={String(person.employee_id)} className="space-y-1 py-2">
            <p className="font-medium">{names(person)}</p>
            <p className="text-xs text-muted-foreground">{[text(person.rank), text(person.position_name)].filter(Boolean).join(" · ")}</p>
            {statuses.length === 0 ? <p>{catalog.get("IN_SERVICE") || "В строю"}</p> : statuses.map((row, index) => <p key={index}>
              {catalog.get(text(row.status_type_code)) || text(row.status_type_code)}
              {text(row.date_start) && <> · {statusPeriod({ date_start: text(row.date_start), date_end: text(row.date_end) })}</>}
              {text(row.destination) && <> · {text(row.destination)}</>}
            </p>)}
          </li>;
        })}
      </ul>
      {matching.length === 0 && <p>По этим условиям сотрудников нет.</p>}
      {count > 1 && <nav aria-label="Страницы сохранённого состава" className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={current === 1} onClick={() => setPage(current - 1)}>Назад</Button><span>{current} / {count} · Всего {matching.length}</span><Button variant="outline" size="sm" disabled={current === count} onClick={() => setPage(current + 1)}>Далее</Button>
      </nav>}
    </>}
    {pins.length > 0 && <div className="space-y-2 border-t pt-3">
      <p className="font-medium">Сдачи, включённые в свод</p>
      {pins.map(pin => <div key={Number(pin.submission_id)} className="space-y-2">
        <Button variant="outline" size="sm" className="h-auto max-w-full whitespace-normal text-left" aria-expanded={openSource === pin.submission_id} onClick={() => setOpenSource(openSource === pin.submission_id ? null : Number(pin.submission_id))}>{labelOfDivision(Number(pin.division_id))} · версия {String(pin.version)}</Button>
        {openSource === pin.submission_id && <VersionSnapshot key={Number(pin.submission_id)} id={Number(pin.submission_id)} labelOfDivision={labelOfDivision} ancestors={[...ancestors, id]} />}
      </div>)}
    </div>}
  </div>;
}
