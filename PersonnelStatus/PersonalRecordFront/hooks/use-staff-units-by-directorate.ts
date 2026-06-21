import { useQuery } from "@tanstack/react-query";
import { apiClient, type StaffUnit } from "@/lib/api";

export function useStaffUnitsByDirectorate() {
  return useQuery<{
    division: {
      id: number;
      name: string;
      code: string;
    };
    staff_units: StaffUnit[];
    total_count: number;
  }>({
    queryKey: ["staff-units-by-directorate"],
    queryFn: async () => {
      return await apiClient.getStaffUnitsByDirectorate();
    },
  });
}
