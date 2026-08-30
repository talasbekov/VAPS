import { useQuery } from "@tanstack/react-query";
import { ApiHttpError, apiClient, type StaffUnit } from "@/lib/api";
import { retryUnlessClientError } from "@/lib/query-retry";


/** Почему ручка отказала. Разные причины — разные починки (Plane №329).
 *
 * `permission` (403) — у роли нет права вести штатку: чинит администратор.
 * `scope` (400) — учётка не привязана к подразделению («Не удалось определить
 * подразделение пользователя»): роль может быть какой угодно, чинит кадровик.
 * До №329 экран печатал на оба один текст, и человека с непривязанной учёткой
 * отправляли выпрашивать право, которое у него уже есть.
 */
export type DirectorateDenial = "permission" | "scope";

export function directorateDenial(error: unknown): DirectorateDenial | null {
  if (!(error instanceof ApiHttpError)) return null;
  if (error.status === 403) return "permission";
  if (error.status === 400) return "scope";
  return null;
}


/**
 * ВЕСЬ состав подразделения. Отдельный хук страницы — `useStaffUnitsPage`.
 *
 * `enabled` появился в №228: на пяти тысячах сотрудников этот ответ весит
 * 2,7 МБ, и грузить его при открытии экрана, которому нужна одна страница,
 * незачем. Экраны, которым состав нужен целиком (календарь, массовая правка),
 * зовут хук без аргументов — поведение прежнее.
 */
export function useStaffUnitsByDirectorate(enabled = true) {
  return useQuery<{
    /** Подразделение, ОДНИМ КОТОРЫМ описывается ответ, либо `null`.
     *
     * `null` приходит, когда такого подразделения не существует: у
     * суперпользователя, видящего все деревья оргструктуры сразу (корней в базе
     * бывает несколько). Раньше сервер отдавал в этом случае первый корень —
     * и диалог статусов писал его в `related_division` всем подряд (Plane
     * №304). Читателю положен запасной путь: подразделение ШТАТНОЙ ЕДИНИЦЫ
     * сотрудника. */
    division: {
      id: number;
      name: string;
      code: string;
    } | null;
    staff_units: StaffUnit[];
    total_count: number;
  }>({
    queryKey: ["staff-units-by-directorate"],
    queryFn: async () => {
      return await apiClient.getStaffUnitsByDirectorate();
    },
    enabled,
    retry: retryUnlessClientError,
  });
}
