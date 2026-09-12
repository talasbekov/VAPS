"use client";

// Строки дерева «Свод по Службе» (Plane №992 → №1232): ТАБЛИЦА, а не вложенные
// карточки — у каждого узла числовые колонки Список / В строю / Откл. и
// состояние сдачи. Узел с потомками раскрывается в дочерние строки; лист
// (управление/отдел без вложенных подразделений) — в поимённый список со
// статусом на дату. Департаменты и всё под ними — READ-ONLY (§20.4 п.10);
// исключение — «Руководство Службы» (№1223, `[РАСХ-РШ-07]`): `LeafEmployees`
// рисует «Проставить» ТОЛЬКО когда вызывающий передал `onPick`.
// «Руководство департамента» (№1232, `[РАСХ-РШ-10]`) и листы управлений/отделов
// (№1234, `[РАСХ-РШ-12]`) показывают ТОЛЬКО людей со статусом не «в строю»;
// остальных раскрывает «Показать всех». «Руководство Службы» — всех.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient, type TrafficLightNode } from "@/lib/api";
import { opsApiClient } from "@/lib/ops-api";
import { DAILY_EMPLOYEES_PATH, type DaySubmission } from "@/entities/daily-grid";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";
import { useOpsStatusTypes } from "@/hooks/use-ops-status-types";
import { effectiveDailyStatus } from "@/features/daily-expense/model/directorate-summary";
import type { NodeFigures, ServiceDay } from "../model/use-service-day";

interface DailyEmployeesResponse {
  results: { id: string; full_name: string; rank_code: string }[];
}

export const COLUMN_COUNT = 5;

function num(value: number | null, muted = false) {
  return (
    <td className={`px-2 py-2 text-right tabular-nums ${muted || value === 0 || value === null ? "text-muted-foreground" : ""}`}>
      {value === null ? "—" : value}
    </td>
  );
}

export function FiguresCells({ figures }: { figures: NodeFigures }) {
  return (
    <>
      {num(figures.listTotal)}
      {num(figures.inService)}
      {num(figures.deviations)}
    </>
  );
}

/** Точка-индикатор сдачи слева от имени: тот же язык, что у ответственного. */
function Dot({ tone, title }: { tone: "ok" | "warn" | "bad" | "off"; title: string }) {
  const color = { ok: "bg-emerald-600", warn: "bg-amber-600", bad: "bg-red-600", off: "bg-slate-400" }[tone];
  return <span role="img" aria-label={title} title={title} className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${color}`} />;
}

function stateOf(submission: DaySubmission | undefined, isLeaf: boolean, stale: boolean): { tone: "ok" | "warn" | "bad"; label: string } {
  if (submission === undefined) return { tone: "bad", label: isLeaf ? "Не сдано" : "Не собран" };
  if (stale) return { tone: "warn", label: submission.sent_at !== null ? "Пересдано после отправки" : "Пересдано после сборки" };
  if (!isLeaf && submission.sent_at !== null) return { tone: "ok", label: "Отправлено дежурному" };
  if (isLeaf) return { tone: "ok", label: submission.late ? "Сдано · с опозданием" : "Сдано" };
  return { tone: "warn", label: "Собран" };
}

function badgeClass(tone: "ok" | "warn" | "bad") {
  return {
    ok: "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    warn: "border-transparent bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    bad: "border-transparent bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  }[tone];
}

export function LeafEmployees({
  divisionId,
  businessDate,
  onPick,
  onlyDeviations = false,
}: {
  divisionId: number;
  businessDate: string;
  /** Кому можно поставить статус отсюда — есть ТОЛЬКО у «Руководства Службы». */
  onPick?: (person: { id: string; name: string }) => void;
  /** «Руководство департамента»: показывать только людей со статусом не «в строю». */
  onlyDeviations?: boolean;
}) {
  const catalog = useOpsStatusTypes();
  // «Показать всех» (Plane №1234): по умолчанию список — только люди со
  // статусом не «в строю», остальные раскрываются ссылкой с их числом.
  const [showAll, setShowAll] = useState(false);
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

  if (employeesQuery.isPending || statusesQuery.isPending || catalog.isLoading) {
    return <p className="py-2 pl-8 text-sm text-muted-foreground">Загрузка личного состава…</p>;
  }
  if (employeesQuery.isError || statusesQuery.isError || catalog.isError) {
    return (
      <p role="alert" className="py-2 pl-8 text-sm text-muted-foreground">
        Не удалось прочитать личный состав или статусы
      </p>
    );
  }
  const statuses = statusesQuery.data ?? [];
  const lines = (employeesQuery.data?.results ?? []).map((person) => {
    let status: ReturnType<typeof effectiveDailyStatus> | undefined;
    try {
      status = effectiveDailyStatus(statuses.filter((row) => String(row.employee_id) === person.id), businessDate, catalog.all);
    } catch {
      status = undefined;
    }
    return { person, status };
  });
  const isDeviation = ({ status }: (typeof lines)[number]) =>
    status === undefined || (status !== null && status.status_type_code !== "IN_SERVICE");
  const hideInService = onlyDeviations && !showAll;
  const shown = hideInService ? lines.filter(isDeviation) : lines;
  const inServiceCount = lines.length - lines.filter(isDeviation).length;
  if (lines.length === 0) {
    return <p className="py-2 pl-8 text-sm text-muted-foreground">В подразделении никого нет</p>;
  }
  const showAllLink = onlyDeviations && inServiceCount > 0 && (
    <button type="button" className="min-h-9 text-xs text-primary underline-offset-2 hover:underline" onClick={() => setShowAll((prev) => !prev)}>
      {showAll ? "Скрыть тех, кто в строю" : `Показать всех · ${inServiceCount} в строю`}
    </button>
  );
  if (shown.length === 0) {
    return (
      <div className="py-2 pl-8 text-sm text-muted-foreground">
        Все в строю — отклонений нет{showAllLink && <> · {showAllLink}</>}
      </div>
    );
  }
  return (
    <ul role="list" className="space-y-1 py-1 pl-8">
      {showAllLink && <li className="list-none">{showAllLink}</li>}
      {shown.map(({ person, status }) => (
        <li key={person.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 font-medium">{person.full_name}</span>
          <span className="text-muted-foreground">{person.rank_code || "—"}</span>
          {status === undefined ? (
            <Badge variant="outline" className="text-red-700">статус не найден в справочнике</Badge>
          ) : status === null ? (
            <Badge variant="outline" className="text-muted-foreground">В строю</Badge>
          ) : (
            <Badge variant="outline">
              {catalog.labelOf(status.status_type_code)} · {formatIsoDate(status.date_start)}
              {status.date_end !== status.date_start ? ` – ${formatIsoDate(status.date_end)}` : ""}
            </Badge>
          )}
          {onPick && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Проставить статус: ${person.full_name}`}
              onClick={() => onPick({ id: person.id, name: person.full_name })}
            >
              Проставить
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Ячейка состояния сдачи: бейдж + версия · время · кто, «неполный» отдельно. */
export function StateCell({ submission, isLeaf, stale, hint }: { submission: DaySubmission | undefined; isLeaf: boolean; stale: boolean; hint?: string }) {
  const state = stateOf(submission, isLeaf, stale);
  return (
    <td className="px-2 py-2 text-right">
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge variant="outline" className={badgeClass(state.tone)}>{state.label}</Badge>
        {submission !== undefined && submission.incomplete_reason !== "" && (
          <Badge variant="outline" className={badgeClass("warn")}>неполный: «{submission.incomplete_reason}»</Badge>
        )}
        {submission !== undefined && (
          <span className="font-mono">
            v{submission.version} · {formatIsoDateTime(submission.sent_at ?? submission.submitted_at)}
          </span>
        )}
        {submission !== undefined && <span>{submission.sent_by || submission.submitted_by}</span>}
        {hint !== undefined && <span>{hint}</span>}
      </div>
    </td>
  );
}

function ToggleName({ name, open, onToggle, depth, bold }: { name: string; open: boolean; onToggle: () => void; depth: number; bold: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${name}`}
      onClick={onToggle}
      className={`inline-flex min-h-9 items-center gap-1 text-left ${bold ? "font-semibold" : "font-medium"} hover:text-primary`}
      style={{ paddingLeft: depth * 22 }}
    >
      <ChevronRight aria-hidden size={14} className={`text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
      {name}
    </button>
  );
}

/** «Руководство департамента» — прямые сотрудники департамента со статусом. */
function DepartmentLeadershipRows({ node, day, businessDate, depth }: { node: TrafficLightNode; day: ServiceDay; businessDate: string; depth: number }) {
  const [open, setOpen] = useState(false);
  const figures = day.exactFigures(node.division_id);
  return (
    <>
      <tr className="bg-muted/30" aria-level={depth + 1}>
        <td className="px-2 py-1.5">
          <Dot tone="off" title="Сдача не требуется" />
          <ToggleName name="Руководство департамента" open={open} onToggle={() => setOpen((prev) => !prev)} depth={depth} bold={false} />
          <span className="ml-2 rounded-full border px-2 text-[11px] text-muted-foreground">в знаменатель не входит</span>
        </td>
        <FiguresCells figures={figures} />
        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">только просмотр · показаны со статусом</td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td colSpan={COLUMN_COUNT} className="px-2 pb-2" style={{ paddingLeft: depth * 22 + 8 }}>
            <LeafEmployees divisionId={node.division_id} businessDate={businessDate} onlyDeviations />
          </td>
        </tr>
      )}
    </>
  );
}

export interface DivisionRowProps {
  node: TrafficLightNode;
  depth: number;
  day: ServiceDay;
  businessDate: string;
}

export function DivisionRow({ node, depth, day, businessDate }: DivisionRowProps) {
  const [open, setOpen] = useState(false);
  const children = day.childrenOf.get(node.division_id) ?? [];
  const isLeaf = children.length === 0;
  const submission = day.submissionByDivision.get(String(node.division_id));
  const stale = day.isStale(node.division_id);
  const figures = day.figures(node.division_id);
  const tone = submission === undefined ? "bad" : stale ? "warn" : !isLeaf && submission.sent_at === null ? "warn" : "ok";
  const submittedChildren = children.filter((child) => day.submissionByDivision.has(String(child.division_id))).length;
  const hint = !isLeaf && submission === undefined ? `сдали ${submittedChildren} из ${children.length}` : undefined;
  return (
    <>
      <tr aria-level={depth + 1} className={depth === 0 ? "" : "bg-muted/20"}>
        <td className="px-2 py-1.5">
          <Dot tone={tone} title={submission === undefined ? "Не сдано" : "Сдано"} />
          <ToggleName name={node.name} open={open} onToggle={() => setOpen((prev) => !prev)} depth={depth} bold={depth === 0} />
        </td>
        <FiguresCells figures={figures} />
        <StateCell submission={submission} isLeaf={isLeaf} stale={stale} hint={hint} />
      </tr>
      {open && depth === 0 && <DepartmentLeadershipRows node={node} day={day} businessDate={businessDate} depth={depth + 1} />}
      {open && !isLeaf && children.map((child) => (
        <DivisionRow key={child.division_id} node={child} depth={depth + 1} day={day} businessDate={businessDate} />
      ))}
      {open && isLeaf && (
        <tr className="bg-muted/20">
          <td colSpan={COLUMN_COUNT} className="px-2 pb-2" style={{ paddingLeft: depth * 22 + 8 }}>
            <LeafEmployees divisionId={node.division_id} businessDate={businessDate} onlyDeviations />
          </td>
        </tr>
      )}
    </>
  );
}
