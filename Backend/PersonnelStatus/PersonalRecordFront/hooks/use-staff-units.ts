import { apiClient, type StaffUnit } from "@/lib/api";
import { useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";

export function useStaffUnits() {
  const access = useOpsReadAccess("orgstructure.view");
  return useOpsProtectedRead<StaffUnit[]>(["staff-units", "all"], [], access,
    signal => apiClient.getStaffUnits(undefined, undefined, signal), { staleTime: 60_000 });
}
