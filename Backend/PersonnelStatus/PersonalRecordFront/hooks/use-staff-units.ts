import { useQuery } from "@tanstack/react-query";
import { apiClient, type StaffUnit } from "@/lib/api";

export function useStaffUnits() {
  return useQuery<StaffUnit[]>({
    queryKey: ["staff-units"],
    queryFn: async ({ signal }) => {
      return await apiClient.getStaffUnits(undefined, undefined, signal);
    },
  });
}
