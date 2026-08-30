import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";

/**
 * Секции бланка расстановки из справочника раздела (Plane №242).
 *
 * ВТОРАЯ КООРДИНАТА МЕСТА: роль отвечает «кем человек идёт», секция — «где».
 * «Көшпелі күзетінің жауаптысы» есть у восьми выездных охран подряд, и по
 * одной роли документ ставил первого назначенного в первую охрану наугад.
 *
 * Читается ОБЩАЯ ручка справочников, а не свой эндпоинт, — по тому же доводу,
 * что и у ролей (`use-placement-roles`): справочник ведут там же, где
 * остальные, и второй путь к тем же строкам разошёлся бы с первым при первой
 * же правке.
 *
 * Снятые значения сюда не попадают: назначить секцию, которую убрали из
 * справочника, сервер и не даст (`_validated_placement_section`).
 */
export interface PlacementSection {
  code: string;
  label: string;
}

export function usePlacementSections(enabled = true) {
  return useQuery<PlacementSection[]>({
    queryKey: ["ops-dictionaries", "PLACEMENT_SECTIONS"],
    queryFn: async () => {
      const payload = await opsApiClient.get<{
        results: { code: string; label: string; isActive?: boolean }[];
      }>("/api/ops/dictionaries/PLACEMENT_SECTIONS/entries/");
      return (payload.results ?? [])
        .filter((row) => row.isActive !== false)
        .map((row) => ({ code: row.code, label: row.label }));
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}
