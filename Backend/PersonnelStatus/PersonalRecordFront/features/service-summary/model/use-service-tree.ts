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
import { useQuery } from "@tanstack/react-query";
import { apiClient, type TrafficLightNode } from "@/lib/api";
import { opsApiClient } from "@/lib/ops-api";
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
  const dateValid = businessDate !== null;

  const treeQuery = useQuery({
    queryKey: ["service-summary", "tree", businessDate],
    queryFn: () =>
      apiClient.getTrafficLightTree({ businessDate: businessDate as string }),
    enabled: dateValid,
  });

  const submissionsQuery = useQuery({
    queryKey: ["service-summary", "submissions", businessDate],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?business_date=${encodeURIComponent(
          businessDate as string
        )}`
      ),
    enabled: dateValid,
  });

  const nodes = treeQuery.data?.nodes ?? [];
  const { roots, childrenOf } = buildDivisionForest(nodes);
  const root = resolveOrganizationRoot(roots, childrenOf);
  const nodeById = new Map(nodes.map((node) => [node.division_id, node]));

  const submissionByDivision = new Map<string, DaySubmission>();
  for (const submission of parseSubmissionList(submissionsQuery.data)) {
    submissionByDivision.set(submission.division_id, submission);
  }

  return {
    isPending: treeQuery.isPending || submissionsQuery.isPending,
    isError: treeQuery.isError || submissionsQuery.isError,
    rootId: root?.division_id ?? null,
    childrenOf,
    nodeById,
    submissionByDivision,
  };
}
