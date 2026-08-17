import { useQuery } from "@tanstack/react-query";
import { apiClient, type Rank } from "@/lib/api";

export function useRanks() {
  return useQuery<Rank[]>({
    queryKey: ["ranks"],
    queryFn: async () => {
      const data = await apiClient.getRanks();
      return data.results;
    },
    // Справочник меняется реже, чем открывают экраны: минутный staleTime
    // заставлял перезапрашивать пачки по 200 строк на каждый переход.
    staleTime: 10 * 60_000,
  });
}
