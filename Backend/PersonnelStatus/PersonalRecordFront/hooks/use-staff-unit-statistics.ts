import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { apiClient, type StaffUnitStatistics } from "@/lib/api";
import { retryUnlessClientError } from "@/lib/query-retry";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

/**
 * Счётчики штата по области актора. Кормит список отделов у фильтра на
 * `/employees` и `/statuses` и всю сводку `/organization`.
 *
 * `retry` — не украшение (Plane №339): ручка отвечает 400 «область не
 * определена», когда у человека её нет, и react-query переспрашивал трижды.
 * Обход 28 ролевых учёток 30.08.2026 дал за раз 140 таких отказов в консоли —
 * настоящая ошибка в ней потерялась бы.
 */
export function useStaffUnitStatistics() {
  const { status } = useSession();
  const { hasPermission, isLoading, error } = useOpsPermissions();
  return useQuery<StaffUnitStatistics>({
    queryKey: ["staff-unit-statistics"],
    enabled: status === "authenticated" && !isLoading && !error &&
      (hasPermission("orgstructure.view") || hasPermission("status.view")),
    queryFn: async () => {
      return await apiClient.getStaffUnitStatistics();
    },
    retry: retryUnlessClientError,
  });
}











