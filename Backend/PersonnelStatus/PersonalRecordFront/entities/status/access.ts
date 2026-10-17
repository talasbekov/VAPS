import type { UseOpsPermissionsResult } from "@/hooks/use-ops-permissions";

export function canManageStatusInDivision(
  access: Pick<UseOpsPermissionsResult, "statusManageDivisionIds" | "hasPermission" | "hasGlobalPermission">,
  divisionId: number | null | undefined,
): boolean {
  if (!access.hasPermission("status.manage")) return false;
  const scope = access.statusManageDivisionIds;
  if (scope === null) return true;
  if (scope === undefined) return access.hasGlobalPermission("status.manage");
  return divisionId != null && scope.includes(divisionId);
}

type StatusStaffUnit = {
  id: number;
  division?: { id: number } | null;
  employee?: { id: number } | null;
  employees?: Array<{ employee?: { id: number } | null }>;
};

export function canManageStatusSelection(
  access: Parameters<typeof canManageStatusInDivision>[0],
  selected: readonly string[],
  units: readonly StatusStaffUnit[],
): boolean {
  return selected.length > 0 && selected.every((key) => {
    const match = /^(\d+)-(\d+)$/.exec(key);
    if (!match) return false;
    const unit = units.find((row) => row.id === Number(match[1]));
    if (!unit || !canManageStatusInDivision(access, unit.division?.id)) return false;
    const employeeId = Number(match[2]);
    return unit.employee?.id === employeeId || unit.employees?.some((row) => row.employee?.id === employeeId) === true;
  });
}
