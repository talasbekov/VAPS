import { useQuery } from "@tanstack/react-query";
import { apiClient, type StaffUnitStatistics } from "@/lib/api";

export function useStaffUnitStatistics() {
  return useQuery<StaffUnitStatistics>({
    queryKey: ["staff-unit-statistics"],
    queryFn: async () => {
      return await apiClient.getStaffUnitStatistics();
    },
  });
}











