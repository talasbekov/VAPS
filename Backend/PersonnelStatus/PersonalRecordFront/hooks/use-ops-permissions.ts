"use client";

// Права раздела ОМ — плоский список кодов с бэкенда ОМ (или мока), НЕ
// resource/action-роли lib/auth.tsx: две системы прав сосуществуют.
// Query-кэш — единственный источник; копий в useState/Context нет.
// Ключ ['ops-me'] намеренно не пересекается с чужими ключами кэша хоста.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { opsApiClient } from "@/lib/ops-api";
import { isOpsMockMode } from "@/lib/ops-env";
import type { OpsApiFailure } from "@/lib/ops-errors";

// Рукописный тип: OpenAPI-схемы бэкенда ОМ в хосте нет (эндпоинт пока
// существует только в мок-слое — см. отчёт «чего не хватает на бэкенде»)
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
  const { user } = useAuth();

  const query = useQuery<OpsMyPermissionsResponse, OpsApiFailure>({
    queryKey: ["ops-me"],
    queryFn: () =>
      opsApiClient.get<OpsMyPermissionsResponse>(
        "/api/operations/my-permissions/"
      ),
    // в мок-режиме identity задаёт сам мок (host-логина может не быть);
    // в api-режиме без пользователя запрос не уходит вовсе
    enabled: isOpsMockMode() || user !== null,
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
