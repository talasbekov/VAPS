"use client";

// Маршрут журнала изменений порта. Сам журнал — features/ops-changelog:
// у вью есть проп-шов fixes (порт обратной связи заменит дефолт на запрос),
// а page-экспорт Next пропов, кроме params/searchParams, не принимает.
//
// ГЕЙТ ДОБАВЛЕН В Plane №350. Экран был открыт каждому вошедшему, а пункт
// стоит в категории «Система», которую заказчик назвал недоступной шести
// персонам из семи. Право берётся из общей карты — тем же ключом, которым
// меню решает, показывать ли пункт: спрятанный пункт при открытом экране
// означал бы, что модуль всё ещё доступен по прямому адресу.
import { ChangelogView } from "@/features/ops-changelog/changelog-view";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION } from "@/entities/portal-access";

export default function OpsChangelogPage() {
  const { hasPermission, isLoading } = useOpsPermissions();

  if (!isLoading && !hasPermission(MODULE_PERMISSION["/security-ops/changelog"])) {
    return <OpsAccessDenied what="журнала изменений" />;
  }

  return <ChangelogView />;
}
