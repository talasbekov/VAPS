"use client";

// Права раздела ОМ — плоский список кодов с бэкенда ОМ (или мока), НЕ
// resource/action-роли lib/auth.tsx: две системы прав сосуществуют.
// Query-кэш — единственный источник; копий в useState/Context нет.
// Ключ ['ops-me'] намеренно не пересекается с чужими ключами кэша хоста.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

// Рукописный тип: OpenAPI-схемы бэкенда ОМ в хосте нет. Ручка живая
// (operations/api/urls.py, MyPermissionsViewSet), мок-обработчика больше нет:
// коды приходят с бэка как есть — `object.view`, `duty.view`, `event.view`.
export interface OpsMyPermissionsResponse {
  permissions: string[];
}

export interface UseOpsPermissionsResult {
  /** undefined, пока запрос прав не завершён (или выключен без пользователя). */
  permissions: ReadonlySet<string> | undefined;
  hasPermission(code: string): boolean;
  isLoading: boolean;
  error: OpsApiFailure | null;
}

export function useOpsPermissions(): UseOpsPermissionsResult {
  const query = useQuery<OpsMyPermissionsResponse, OpsApiFailure>({
    queryKey: ["ops-me"],
    queryFn: () =>
      opsApiClient.get<OpsMyPermissionsResponse>(
        "/api/operations/my-permissions/"
      ),
    // Запрос уходит ВСЕГДА, в том числе без host-логина: /security-ops/* не
    // закрыт middleware (matcher его не перечисляет), а выключенный запрос
    // навсегда оставил бы isLoading=true — гейты страниц (`!isLoading &&
    // !hasPermission`) не сработали бы и раздел открылся бы анониму.
    // Без токена бэк отвечает 403 → error → прав нет → гейт закрыт.
    enabled: true,
  });

  const permissions = useMemo<ReadonlySet<string> | undefined>(
    () =>
      query.data === undefined ? undefined : new Set(query.data.permissions),
    [query.data]
  );

  // wildcard `*` = администратор; иерархий/префиксов нет — плоский список
  const hasPermission = useCallback(
    (code: string): boolean =>
      permissions !== undefined &&
      (permissions.has("*") || permissions.has(code)),
    [permissions]
  );

  return {
    permissions,
    hasPermission,
    isLoading: query.isLoading,
    error: query.error,
  };
}
