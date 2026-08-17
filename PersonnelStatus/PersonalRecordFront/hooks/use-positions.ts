import { useQuery } from "@tanstack/react-query";
import { apiClient, type Position } from "@/lib/api";

export function usePositions() {
  return useQuery<Position[]>({
    queryKey: ["positions"],
    queryFn: async () => {
      const data = await apiClient.getPositions();
      return data.results;
    },
    // Справочник меняется реже, чем открывают экраны: минутный staleTime
    // заставлял перезапрашивать его на каждом переходе.
    staleTime: 10 * 60_000,
  });
}
