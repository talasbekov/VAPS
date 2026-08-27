import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";

/**
 * Роли наряда из справочника раздела (Plane №239).
 *
 * Читается ОБЩАЯ ручка справочников, а не свой эндпоинт: справочник ролей
 * ведут там же, где остальные (`/security-ops/dictionaries`), и второй путь
 * к тем же строкам разошёлся бы с первым при первой же правке — например
 * когда роль снимут с публикации.
 *
 * Снятые значения сюда не попадают: назначать роль, которую убрали из
 * справочника, сервер и не даст (`_validated_placement_role`).
 */
export interface PlacementRole {
  code: string;
  label: string;
}

export function usePlacementRoles(enabled = true) {
  return useQuery<PlacementRole[]>({
    queryKey: ["ops-dictionaries", "PLACEMENT_ROLES"],
    queryFn: async () => {
      const payload = await opsApiClient.get<{
        results: { code: string; label: string; isActive?: boolean }[];
      }>("/api/ops/dictionaries/PLACEMENT_ROLES/entries/");
      return (payload.results ?? [])
        .filter((row) => row.isActive !== false)
        .map((row) => ({ code: row.code, label: row.label }));
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}
