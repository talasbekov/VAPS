import { apiClient, type StaffUnitStatistics } from "@/lib/api";
import { useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";

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
  const structure = useOpsReadAccess("orgstructure.view");
  const status = useOpsReadAccess("status.view");
  return useOpsProtectedRead<StaffUnitStatistics>(["staff-unit-statistics", "summary"], [],
    { ...structure, allowed: structure.allowed || status.allowed },
    () => apiClient.getStaffUnitStatistics(), { staleTime: 60_000 });
}











