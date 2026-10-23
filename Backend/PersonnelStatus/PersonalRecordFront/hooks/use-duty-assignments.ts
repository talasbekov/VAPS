"use client";

import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import type { ServerDutyAssignment, DutyForcesDepartment, DutyAssignment } from "@/entities/duty-assignment";
import { dutyIntervalsOnDate } from "@/features/employee-status-update/model/duty-intervals";

export const DUTY_ASSIGNMENTS_QUERY_KEY = ["status-duty-assignments"] as const;

export function invalidateDutyViews(client: QueryClient) {
  return Promise.all(['status-duty-assignments', 'duty-register', 'duty-dispatch', 'service-combat-duty']
    .map(key => client.invalidateQueries({ queryKey: [key] })));
}

function useDutyAssignments(filters: { object_id?: string; employee_id?: number; date: string }, enabled: boolean, employeeReadOnly = false) {
  const permissions = useOpsPermissions();
  // Scoped employee reads do not grant access to the object catalog or legacy editor.
  const allowed = !permissions.isLoading && permissions.hasPermission("status.view") &&
    (employeeReadOnly || permissions.hasPermission("object.view"));
  const query = useQuery<{ results: ServerDutyAssignment[] }, OpsApiFailure>({
    queryKey: [...DUTY_ASSIGNMENTS_QUERY_KEY, filters],
    queryFn: () => {
      const params = new URLSearchParams({ date: filters.date });
      if (filters.object_id) params.set("object_id", filters.object_id);
      if (filters.employee_id) params.set("employee_id", String(filters.employee_id));
      return opsApiClient.get(`/api/statuses/statuses/duty-assignments/?${params}`);
    },
    enabled: enabled && allowed && Boolean(filters.date),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  // Cached data is not authority after permissions are lost.
  return { ...query, data: allowed ? query.data : undefined, allowed, permissionsLoading: permissions.isLoading };
}

export function useDutyAssignment(employeeId: number | null, date: string, enabled = true) {
  const query = useDutyAssignments({ employee_id: employeeId ?? undefined, date }, enabled && employeeId !== null);
  // The legacy status editor must not copy an independently managed dispatch shift.
  const assignment = query.data?.results.find(row => row.status_id != null && row.dispatch_assignment_id == null && row.source?.toUpperCase() !== "DISPATCH") ?? null;
  return { ...query, assignment };
}

/** Employee history may contain several dispatcher shifts on the same date. */
export function useEmployeeDutyAssignments(employeeId: number, date: string) {
  const query = useDutyAssignments({ employee_id: employeeId, date }, Number.isInteger(employeeId) && employeeId > 0, true);
  return { ...query, assignments: query.data?.results ?? [] };
}

export function useObjectDutyForces(objectId: string, date: string) {
  const query = useDutyAssignments({ object_id: objectId, date }, Boolean(objectId));
  const departments = useMemo<DutyForcesDepartment[]>(() => {
    const byDepartment = new Map<string, Map<string, DutyAssignment[]>>();
    for (const row of query.data?.results ?? []) {
      const placement = row.placement;
      const dispatch = row.dispatch_assignment_id != null || row.source?.toUpperCase() === "DISPATCH";
      const intervals = dispatch || placement.intervals === undefined ? undefined : dutyIntervalsOnDate(placement.intervals, date);
      if (intervals?.length === 0) continue;
      const assignment: DutyAssignment = {
        employeeKey: row.dispatch_assignment_id ? `dispatch:${row.dispatch_assignment_id}` : String(row.status_id), employeeName: row.employee_name,
        shiftStart: row.start_at, shiftEnd: row.end_at, timeZone: row.time_zone,
        intervals,
        rankName: row.rank_name, positionName: row.position_name, departmentName: row.department_name,
        dutyKind: placement.kind, objectId: placement.object_id, objectName: placement.object_name,
        postId: placement.post_id, postName: placement.post_name,
        groupId: placement.group_id, groupName: placement.group_name,
        startDate: row.start_date, endDate: row.end_date, assignedAt: row.assigned_at,
      };
      const department = assignment.departmentName || "Подразделение не указано";
      const placementKey = placement.kind === "POST" ? `post:${placement.post_id}:${placement.sector_name}:${placement.post_name}` : `group:${placement.group_id}`;
      let placements = byDepartment.get(department);
      if (!placements) { placements = new Map(); byDepartment.set(department, placements); }
      const bucket = placements.get(placementKey);
      if (bucket) bucket.push(assignment);
      else placements.set(placementKey, [assignment]);
    }
    return Array.from(byDepartment.entries()).map(([departmentName, placements]) => ({
      departmentName,
      placements: Array.from(placements.entries()).map(([key, items]) => ({
        key, label: items[0].dutyKind === "POST" ? items[0].postName || "Пост не указан" : items[0].groupName || "Группа не указана",
        assignments: [...items].sort((a, b) => a.employeeName.localeCompare(b.employeeName, "ru")),
      })).sort((a, b) => a.label.localeCompare(b.label, "ru")),
    })).sort((a, b) => a.departmentName.localeCompare(b.departmentName, "ru"));
  }, [query.data, date]);
  return { ...query, departments };
}
