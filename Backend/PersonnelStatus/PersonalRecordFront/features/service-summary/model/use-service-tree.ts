"use client";

// Дерево подразделений + состояние сдачи на ОДНУ дату (Plane №992).
//
// Иерархия — ЧЕРЕЗ УЖЕ СУЩЕСТВУЮЩИЙ лес (`buildDivisionForest` из
// `entities/daily-grid`, тот же, что считает три корзины светофора): дерево
// `traffic-light/tree` несёт РЕАЛЬНЫЙ `parent_id`, и второй разбор иерархии
// (по именам предков вручную) разошёлся бы с ним при первой же одноимённой
// паре («Второе сквозное управление» есть в каждом департаменте — Plane
// №235). Департамент — узел, чей родитель есть КОРЕНЬ леса (после снятия
// осиротевшего «Управление (стенд)», см. `resolveOrganizationRoot`), а не
// зашитый уровень типа: тип узла в ответе дерева не приходит вовсе.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useRef } from "react";
import { ServiceSummaryRootContext, ServiceSummaryWorkspaceReadyContext } from "./workspace-context";
import { apiClient, type TrafficLightNode, type TrafficLightTree } from "@/lib/api";
import { opsApiClient } from "@/lib/ops-api";
import { hasCurrentOpsReadAuthority, useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import { isReadAccessBlocked } from "@/lib/query-read-access";
import {
  DAILY_SUBMISSIONS_PATH,
  buildDivisionForest,
  parseSubmissionList,
  type DaySubmission,
} from "@/entities/daily-grid";

/**
 * Корень организации — узел БЕЗ родителя (Plane №307 признак `parent_id`,
 * не «нет предков в ancestors», тот же класс ошибки, что уже нашли и
 * закрыли для департамента). Кандидатов «без родителя» может быть НЕСКОЛЬКО
 * — сирота без предка тоже проходит это условие (`«Управление (стенд)»`,
 * см. докстринг `SummaryVersions.tsx`); настоящий корень отличает НАИБОЛЬШЕЕ
 * поддерево, а не наименьший id — id стенда-специфичен и на бою мог бы
 * стоять в любом порядке.
 */
export function resolveOrganizationRoot(
  roots: TrafficLightNode[],
  childrenOf: Map<number, TrafficLightNode[]>
): TrafficLightNode | null {
  if (roots.length === 0) return null;
  if (roots.length === 1) return roots[0];
  let best = roots[0];
  let bestSize = 0;
  for (const root of roots) {
    const size = subtreeSize(root.division_id, childrenOf);
    if (size > bestSize) {
      best = root;
      bestSize = size;
    }
  }
  return best;
}

function subtreeSize(
  divisionId: number,
  childrenOf: Map<number, TrafficLightNode[]>,
  seen: Set<number> = new Set()
): number {
  if (seen.has(divisionId)) return 0;
  seen.add(divisionId);
  const children = childrenOf.get(divisionId) ?? [];
  let total = children.length;
  for (const child of children) {
    total += subtreeSize(child.division_id, childrenOf, seen);
  }
  return total;
}

export interface ServiceTree {
  isPending: boolean;
  isError: boolean;
  readAllowed: boolean;
  readScope: string;
  readBlocked: boolean;
  canRetry: boolean;
  retryPending: boolean;
  /** Only this mounted day/context; never returns a protected payload. */
  retry: () => Promise<void>;
  /** null, пока дерево не загружено или корень не разрешился. */
  rootId: number | null;
  childrenOf: Map<number, TrafficLightNode[]>;
  nodeById: Map<number, TrafficLightNode>;
  /** Действующие сдачи/своды на дату, по division_id (строка — контракт
   * клиента). Совпадений быть не может — сервер держит НЕ БОЛЕЕ одной
   * текущей версии на (подразделение, день). */
  submissionByDivision: Map<string, DaySubmission>;
}

export function useServiceTree(businessDate: string | null): ServiceTree {
  const canonicalRootId = useContext(ServiceSummaryRootContext);
  const workspaceReady = useContext(ServiceSummaryWorkspaceReadyContext);
  const client = useQueryClient();
  const summaryAccess = useOpsReadAccess("service_summary.view");
  const statusAccess = useOpsReadAccess("status.view");
  const access = { ...summaryAccess, allowed: summaryAccess.allowed && statusAccess.allowed &&
    workspaceReady && canonicalRootId !== null && businessDate !== null };
  const identity = JSON.stringify([access.scope, canonicalRootId, businessDate]);
  const current = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  current.current = access.allowed ? identity : null;
  const isCurrent = () => mounted.current && current.current === identity && hasCurrentOpsReadAuthority(client, access);
  const readCurrent = async <T,>(signal: AbortSignal, read: () => Promise<T>): Promise<T> => {
    if (!isCurrent()) throw new Error("Область свода изменилась.");
    const data = await read();
    if (signal.aborted || !isCurrent()) throw new Error("Область свода изменилась.");
    return data;
  };
  const treeQuery = useOpsProtectedRead<TrafficLightTree>(["service-summary", "tree"], [businessDate, canonicalRootId], access,
    signal => readCurrent(signal, () => apiClient.getTrafficLightTree({ businessDate: businessDate as string })));
  const submissionsQuery = useOpsProtectedRead<unknown>(["service-summary", "submissions"], [businessDate, canonicalRootId], access,
    signal => readCurrent(signal, () => opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?business_date=${encodeURIComponent(
          businessDate as string
        )}`
      )));
  const readBlocked = treeQuery.readAccessBlocked || submissionsQuery.readAccessBlocked;
  const retryPending = treeQuery.isFetching || submissionsQuery.isFetching;
  const retry = useCallback(async () => {
    if (!isCurrent() || [treeQuery, submissionsQuery].some(source =>
      isReadAccessBlocked(client, source.readKey) || client.isFetching({ queryKey: source.readKey, exact: true }) > 0)) return;
    await Promise.all([treeQuery.refetch(), submissionsQuery.refetch()]);
  }, [identity, access.allowed, access.scope, client, treeQuery.refetch, submissionsQuery.refetch]);

  const nodes = treeQuery.data?.nodes ?? [];
  const { childrenOf } = buildDivisionForest(nodes);
  const root = nodes.find(node => node.division_id === canonicalRootId) ?? null;
  const nodeById = new Map(nodes.map((node) => [node.division_id, node]));

  const submissionByDivision = new Map<string, DaySubmission>();
  for (const submission of parseSubmissionList(submissionsQuery.data)) {
    // The adapter includes historical versions; their order must not replace
    // the current root/department submission used by the day view.
    if (!submission.is_current || submission.business_date !== businessDate) continue;
    submissionByDivision.set(submission.division_id, submission);
  }

  return {
    isPending: treeQuery.isPending || submissionsQuery.isPending,
    isError: treeQuery.isError || submissionsQuery.isError,
    readAllowed: access.allowed,
    readScope: access.scope,
    readBlocked,
    canRetry: access.allowed && !readBlocked && !retryPending,
    retryPending,
    retry,
    rootId: root?.division_id ?? null,
    childrenOf,
    nodeById,
    submissionByDivision,
  };
}
