import { useQuery } from "@tanstack/react-query";
import { apiClient, type Division } from "@/lib/api";

export function useDivisionsTree() {
  return useQuery<Division>({
    queryKey: ["divisions-tree"],
    queryFn: async () => {
      return await apiClient.getDivisionsTree();
    },
    // Справочник меняется реже, чем открывают экраны: минутный staleTime
    // заставлял перезапрашивать его на каждом переходе.
    staleTime: 10 * 60_000,
  });
}
