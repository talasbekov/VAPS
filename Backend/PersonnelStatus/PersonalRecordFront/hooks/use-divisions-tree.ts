import { useQuery } from "@tanstack/react-query";
import { apiClient, type Division } from "@/lib/api";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

export function useDivisionsTree() {
  const { hasPermission, hasGlobalPermission, isLoading, error } = useOpsPermissions();
  return useQuery<Division>({
    enabled: !isLoading && !error && (hasPermission("orgstructure.view") || hasGlobalPermission("admin.roles")),
    queryKey: ["divisions-tree"],
    queryFn: async () => {
      return await apiClient.getDivisionsTree();
    },
    // Справочник меняется реже, чем открывают экраны: минутный staleTime
    // заставлял перезапрашивать его на каждом переходе.
    staleTime: 10 * 60_000,
  });
}
