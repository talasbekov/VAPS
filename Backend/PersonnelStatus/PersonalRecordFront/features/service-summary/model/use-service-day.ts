"use client";

// Один дневной срез «Свода по Службе» для дежурного (Plane №1232, макет
// одобрен заказчиком 12.09.2026): дерево сдач (`useServiceTree`) + расход
// по подразделениям (`useStrengthReport`, точные строки) + справочник статусов
// (колонка «в строю»). Числа узла — СУММА точных строк его поддерева, тем же
// правилом, что `summarizeDivision` у ответственного (№1197): расход считает
// подразделение точно, а дерево показывает вложенные итоги.
//
// «Пересдано после отправки/сборки» — по времени: действующая сдача ребёнка
// МОЛОЖЕ действующего свода узла. Это ось `superseded` ручки
// `/daily-summaries/freshness/`; своя ручка на каждый департамент дала бы
// N запросов на срез, а признак тот же (см. Decisions №1232).
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { StrengthReportRow, TrafficLightNode } from "@/lib/api";
import { useStrengthReport } from "@/hooks/use-strength-report";
import { useOpsStatusTypes } from "@/hooks/use-ops-status-types";
import { hasCurrentOpsReadAuthority, useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import { isReadAccessBlocked } from "@/lib/query-read-access";
import type { DaySubmission } from "@/entities/daily-grid";
import { useServiceTree, type ServiceTree } from "./use-service-tree";
import { ServiceSummaryRootContext } from "./workspace-context";

export interface NodeFigures {
  listTotal: number;
  inService: number | null;
  deviations: number | null;
}

export interface ServiceDay extends ServiceTree {
  reportPending: boolean;
  reportError: boolean;
  reportReadBlocked: boolean;
  reportRetryPending: boolean;
  canRetryReport: boolean;
  retryReport: () => Promise<void>;
  /** Числа поддерева узла: список, в строю, отклонения. */
  figures: (divisionId: number) => NodeFigures;
  /** Точная строка расхода подразделения (без потомков). */
  exactFigures: (divisionId: number) => NodeFigures;
  /** Итог по всей Службе из `totals` расхода. */
  totals: NodeFigures | null;
  inServiceCode: string | undefined;
  labelOf: (code: string) => string;
  /** Ребёнок пересдал день после того, как узел собрал/отправил свод. */
  isStale: (divisionId: number) => boolean;
  departments: TrafficLightNode[];
  submittedDepartments: TrafficLightNode[];
  laggardDepartments: TrafficLightNode[];
  staleDepartments: TrafficLightNode[];
  incompleteDepartments: TrafficLightNode[];
  rootSubmission: DaySubmission | undefined;
}

const EMPTY: NodeFigures = { listTotal: 0, inService: null, deviations: null };

function figuresOfRows(rows: StrengthReportRow[], inServiceColumn: string | undefined): NodeFigures {
  let listTotal = 0;
  let inService = 0;
  let deviations = 0;
  for (const row of rows) {
    listTotal += row.list_total;
    for (const [code, count] of Object.entries(row.columns)) {
      if (inServiceColumn !== undefined && code === inServiceColumn) inService += count;
      else deviations += count;
    }
  }
  return {
    listTotal,
    inService: inServiceColumn === undefined ? null : inService,
    deviations: inServiceColumn === undefined ? null : deviations,
  };
}

export function useServiceDay(businessDate: string): ServiceDay {
  const tree = useServiceTree(businessDate);
  const report = useStrengthReport(tree.readAllowed, businessDate);
  const client = useQueryClient();
  const access = useOpsReadAccess("status.view");
  const canonicalRootId = useContext(ServiceSummaryRootContext);
  const identity = JSON.stringify([access.scope, canonicalRootId, businessDate]);
  const current = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  current.current = tree.readAllowed ? identity : null;
  const retryReport = useCallback(async () => {
    if (!mounted.current || current.current !== identity || !hasCurrentOpsReadAuthority(client, access) ||
      isReadAccessBlocked(client, report.readKey) || client.isFetching({ queryKey: report.readKey, exact: true }) > 0) return;
    await report.refetch();
  }, [identity, access.allowed, access.scope, client, report.refetch]);
  const catalog = useOpsStatusTypes(tree.readAllowed);
  const inServiceColumn = catalog.all.find((row) => row.code === "IN_SERVICE")?.report_column_code;

  const rowsById = useMemo(() => {
    const map = new Map<number, StrengthReportRow>();
    for (const row of report.data?.rows ?? []) map.set(row.division_id, row);
    return map;
  }, [report.data]);

  const subtreeIds = useCallback(
    (divisionId: number): number[] => {
      const out: number[] = [];
      const stack = [divisionId];
      const seen = new Set<number>();
      while (stack.length > 0) {
        const next = stack.pop() as number;
        if (seen.has(next)) continue;
        seen.add(next);
        out.push(next);
        for (const child of tree.childrenOf.get(next) ?? []) stack.push(child.division_id);
      }
      return out;
    },
    [tree.childrenOf]
  );

  const figures = useCallback(
    (divisionId: number): NodeFigures => {
      if (report.data === undefined) return EMPTY;
      const rows = subtreeIds(divisionId)
        .map((id) => rowsById.get(id))
        .filter((row): row is StrengthReportRow => row !== undefined);
      return figuresOfRows(rows, inServiceColumn);
    },
    [report.data, rowsById, subtreeIds, inServiceColumn]
  );

  const exactFigures = useCallback(
    (divisionId: number): NodeFigures => {
      const row = rowsById.get(divisionId);
      return row === undefined ? EMPTY : figuresOfRows([row], inServiceColumn);
    },
    [rowsById, inServiceColumn]
  );

  const totals = useMemo<NodeFigures | null>(() => {
    const t = report.data?.totals;
    if (t === undefined) return null;
    let inService = 0;
    let deviations = 0;
    for (const [code, count] of Object.entries(t.columns)) {
      if (inServiceColumn !== undefined && code === inServiceColumn) inService += count;
      else deviations += count;
    }
    return {
      listTotal: t.list_total,
      inService: inServiceColumn === undefined ? null : inService,
      deviations: inServiceColumn === undefined ? null : deviations,
    };
  }, [report.data, inServiceColumn]);

  const isStale = useCallback(
    (divisionId: number): boolean => {
      const own = tree.submissionByDivision.get(String(divisionId));
      if (own === undefined) return false;
      for (const child of tree.childrenOf.get(divisionId) ?? []) {
        const theirs = tree.submissionByDivision.get(String(child.division_id));
        if (theirs !== undefined && theirs.submitted_at > own.submitted_at) return true;
      }
      return false;
    },
    [tree.submissionByDivision, tree.childrenOf]
  );

  const departments = tree.rootId !== null ? tree.childrenOf.get(tree.rootId) ?? [] : [];
  const has = (node: TrafficLightNode) => tree.submissionByDivision.has(String(node.division_id));
  const submittedDepartments = departments.filter(has);
  const laggardDepartments = departments.filter((node) => !has(node));
  const staleDepartments = departments.filter((node) => isStale(node.division_id));
  const incompleteDepartments = departments.filter(
    (node) => (tree.submissionByDivision.get(String(node.division_id))?.incomplete_reason ?? "") !== ""
  );
  const rootSubmission = tree.rootId !== null ? tree.submissionByDivision.get(String(tree.rootId)) : undefined;

  return {
    ...tree,
    reportPending: report.isPending,
    reportError: report.isError,
    reportReadBlocked: report.readAccessBlocked,
    reportRetryPending: report.isFetching,
    canRetryReport: tree.readAllowed && !report.readAccessBlocked && !report.isFetching,
    retryReport,
    figures,
    exactFigures,
    totals,
    inServiceCode: "IN_SERVICE",
    labelOf: catalog.labelOf,
    isStale,
    departments,
    submittedDepartments,
    laggardDepartments,
    staleDepartments,
    incompleteDepartments,
    rootSubmission,
  };
}
