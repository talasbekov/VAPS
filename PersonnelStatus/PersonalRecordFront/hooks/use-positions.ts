import { useQuery } from "@tanstack/react-query";
import { apiClient, type Position } from "@/lib/api";

export function usePositions() {
  return useQuery<Position[]>({
    queryKey: ["positions"],
    queryFn: async () => {
      const data = await apiClient.getPositions();
      return data.results;
    },
  });
}
