"use client";

// Строка дерева «Свод по Службе» — РЕКУРСИВНАЯ (Plane №992): узел, у
// которого есть потомки в лесу (`childrenOf`), раскрывается в свои дочерние
// узлы; узел БЕЗ потомков — лист (управление/отдел без вложенных
// подразделений) — раскрывается в поимённый список сотрудников со статусом
// на дату. READ-ONLY по всей глубине: ни окна правки статуса, ни кнопки
// сдачи здесь нет вовсе — рабочее место дежурного смотрит, а не правит
// (§20.4 п.10, `[РАСХ-РШ-05]`).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiClient, type TrafficLightNode } from "@/lib/api";
import { opsApiClient } from "@/lib/ops-api";
import { DAILY_EMPLOYEES_PATH, type DaySubmission } from "@/entities/daily-grid";
import { formatIsoDateTime } from "@/shared/lib/date";

interface DailyEmployeesResponse {
  results: { id: string; full_name: string; rank_code: string }[];
}

/**
 * Подпись зависит от того, ЛИСТ это или узел с потомками (Plane №992):
 * лист сдаёт СВОЙ день (`submit_day` — `sent_at` у него не бывает вовсе,
 * отправка есть только у свода), узел с потомками СОБИРАЕТ его из детей
 * (`assemble_summary`) и может ПОЙТИ ДАЛЬШЕ — быть отправлен дежурному.
 * Один и тот же undefined/defined читался бы по-разному на разных уровнях,
 * если бы подпись не знала, кто перед ней.
 */
function submissionBadge(submission: DaySubmission | undefined, isLeaf: boolean) {
  if (submission === undefined) {
    return <Badge variant="outline">{isLeaf ? "Не сдано" : "Не собран"}</Badge>;
  }
  if (!isLeaf && submission.sent_at !== null) {
    return <Badge variant="secondary">Отправлено дежурному</Badge>;
  }
  return <Badge>{isLeaf ? "Сдано" : "Собран"}</Badge>;
}

function LeafEmployees({
  divisionId,
  businessDate,
}: {
  divisionId: number;
  businessDate: string;
}) {
  const employeesQuery = useQuery({
    queryKey: ["service-summary", "employees", divisionId],
    queryFn: () =>
      opsApiClient.get<DailyEmployeesResponse>(
        `${DAILY_EMPLOYEES_PATH}?division_id=${divisionId}`
      ),
  });
  const statusesQuery = useQuery({
    queryKey: ["service-summary", "statuses", divisionId, businessDate],
    queryFn: () => apiClient.getOpsStatusesOn({ businessDate, divisionId }),
  });

  if (employeesQuery.isPending || statusesQuery.isPending) {
    return <p className="py-2 pl-8 text-sm text-muted-foreground">Загрузка личного состава…</p>;
  }
  if (employeesQuery.isError || statusesQuery.isError) {
    return (
      <p role="alert" className="py-2 pl-8 text-sm text-muted-foreground">
        Не удалось прочитать личный состав или статусы
      </p>
    );
  }
  const people = employeesQuery.data?.results ?? [];
  const statusByEmployee = new Map(
    (statusesQuery.data ?? []).map((row) => [String(row.employee_id), row.status_type_code])
  );
  if (people.length === 0) {
    return <p className="py-2 pl-8 text-sm text-muted-foreground">В подразделении никого нет</p>;
  }
  return (
    <ul role="list" className="space-y-1 py-1 pl-8">
      {people.map((person) => (
        <li key={person.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1">{person.full_name}</span>
          <span className="text-muted-foreground">{person.rank_code}</span>
          <Badge variant="outline">
            {statusByEmployee.get(person.id) ?? "В строю"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export interface DivisionRowProps {
  node: TrafficLightNode;
  depth: number;
  childrenOf: Map<number, TrafficLightNode[]>;
  submissionByDivision: Map<string, DaySubmission>;
  businessDate: string;
}

export function DivisionRow({
  node,
  depth,
  childrenOf,
  submissionByDivision,
  businessDate,
}: DivisionRowProps) {
  const [open, setOpen] = useState(false);
  const children = childrenOf.get(node.division_id) ?? [];
  const isLeaf = children.length === 0;
  const submission = submissionByDivision.get(String(node.division_id));

  return (
    <div role="group" aria-label={node.name}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
        style={{ paddingLeft: `${8 + depth * 20}px` }}
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="flex-1">{node.name}</span>
        {submissionBadge(submission, isLeaf)}
        {!isLeaf && submission?.sent_at !== null && submission?.sent_at !== undefined && (
          <span className="text-xs text-muted-foreground">
            {formatIsoDateTime(submission.sent_at)} · {submission.sent_by}
          </span>
        )}
      </button>
      {open && isLeaf && (
        <LeafEmployees divisionId={node.division_id} businessDate={businessDate} />
      )}
      {open &&
        !isLeaf &&
        children.map((child) => (
          <DivisionRow
            key={child.division_id}
            node={child}
            depth={depth + 1}
            childrenOf={childrenOf}
            submissionByDivision={submissionByDivision}
            businessDate={businessDate}
          />
        ))}
    </div>
  );
}
