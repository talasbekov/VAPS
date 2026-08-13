"use client";

// Чтение нарядов. Подписка через useSyncExternalStore, а не useState+useEffect:
// модалка статусов и карточка объекта могут быть открыты одновременно, и
// карточка должна увидеть заступление сразу, без перезагрузки страницы.

import { useMemo, useSyncExternalStore } from "react";
import {
  getDutyAssignmentsServerSnapshot,
  getDutyAssignmentsSnapshot,
  isAssignmentActiveOn,
  subscribeToDutyAssignments,
  type DutyAssignment,
  type DutyForcesDepartment,
} from "@/entities/duty-assignment";

export function useDutyAssignments(): DutyAssignment[] {
  return useSyncExternalStore(
    subscribeToDutyAssignments,
    getDutyAssignmentsSnapshot,
    getDutyAssignmentsServerSnapshot
  );
}

/** Наряд конкретного сотрудника — тем, кто открывает модалку статусов. */
export function useDutyAssignment(
  employeeKey: string | null
): DutyAssignment | null {
  const assignments = useDutyAssignments();
  return useMemo(
    () =>
      employeeKey
        ? assignments.find((item) => item.employeeKey === employeeKey) ?? null
        : null,
    [assignments, employeeKey]
  );
}

/**
 * Дежурные силы объекта на дату: департамент → пост/группа → сотрудники.
 * Порядок внутри каждого уровня — по алфавиту: устойчивый и не зависит от
 * того, в каком порядке оформляли наряды.
 */
export function useObjectDutyForces(
  objectId: string,
  date: string
): DutyForcesDepartment[] {
  const assignments = useDutyAssignments();

  return useMemo(() => {
    const onObject = assignments.filter(
      (item) => item.objectId === objectId && isAssignmentActiveOn(item, date)
    );

    const byDepartment = new Map<string, Map<string, DutyAssignment[]>>();

    for (const assignment of onObject) {
      const department = assignment.departmentName || "Подразделение не указано";
      const placementKey =
        assignment.dutyKind === "POST"
          ? `post:${assignment.postId ?? ""}`
          : `group:${assignment.groupId ?? ""}`;

      let placements = byDepartment.get(department);
      if (!placements) {
        placements = new Map();
        byDepartment.set(department, placements);
      }
      const bucket = placements.get(placementKey);
      if (bucket) bucket.push(assignment);
      else placements.set(placementKey, [assignment]);
    }

    return Array.from(byDepartment.entries())
      .map(([departmentName, placements]) => ({
        departmentName,
        placements: Array.from(placements.entries())
          .map(([key, items]) => ({
            key,
            label: placementLabel(items[0]),
            assignments: [...items].sort((a, b) =>
              a.employeeName.localeCompare(b.employeeName, "ru")
            ),
          }))
          .sort((a, b) => a.label.localeCompare(b.label, "ru")),
      }))
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName, "ru"));
  }, [assignments, objectId, date]);
}

function placementLabel(assignment: DutyAssignment): string {
  if (assignment.dutyKind === "POST") {
    return assignment.postName || "Пост не указан";
  }
  return assignment.groupName || "Группа не указана";
}
