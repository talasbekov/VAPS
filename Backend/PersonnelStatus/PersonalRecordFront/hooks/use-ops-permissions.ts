"use client";

// Права раздела ОМ — плоский список кодов с бэкенда ОМ (или мока), НЕ
// resource/action-роли lib/auth.tsx: две системы прав сосуществуют.
// Query-кэш — единственный источник; копий в useState/Context нет.
// Ключ ['ops-me'] намеренно не пересекается с чужими ключами кэша хоста.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

// Рукописный тип: OpenAPI-схемы бэкенда ОМ в хосте нет. Ручка живая
// (operations/api/urls.py, MyPermissionsViewSet), мок-обработчика больше нет:
// коды приходят с бэка как есть — `object.view`, `duty.view`, `event.view`.
/** Роль РАЗДЕЛА с её областью (Plane №325). Необязательная: ответ без поля
 *  остаётся валидным, и читатель обязан пережить его пустым. */
export interface OpsSectionRole {
  code: string;
  name: string;
  scope_division_id: number | null;
  scope_division_name: string | null;
}

export interface OpsMyPermissionsResponse {
  permissions: string[];
  roles?: OpsSectionRole[];
}

export interface UseOpsPermissionsResult {
  /** undefined, пока запрос прав не завершён (или выключен без пользователя). */
  permissions: ReadonlySet<string> | undefined;
  /** Роли раздела актора; пусто — их нет либо ответ ещё не пришёл. */
  roles: OpsSectionRole[];
  hasPermission(code: string): boolean;
  isLoading: boolean;
  error: OpsApiFailure | null;
}

export function useOpsPermissions(): UseOpsPermissionsResult {
  const { data: session, status } = useSession();
  const sessionExpired = (session as { error?: string } | null)?.error !== undefined;
  const query = useQuery<OpsMyPermissionsResponse, OpsApiFailure>({
    queryKey: ["ops-me"],
    queryFn: () =>
      opsApiClient.get<OpsMyPermissionsResponse>(
        "/api/operations/my-permissions/"
      ),
    // До завершения входа токена нет. Анонимный 403 не является набором прав
    // и не должен оставаться в кэше до успешного submit формы.
    enabled: status === "authenticated" && !sessionExpired,
  });

  const permissions = useMemo<ReadonlySet<string> | undefined>(
    () =>
      sessionExpired || query.data === undefined ? undefined : new Set(query.data.permissions),
    [query.data, sessionExpired]
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
    // Роли раздела — ОТДЕЛЬНО от прав: права отвечают «что мне можно», роль —
    // «кто я здесь». Шапка портала печатала кадровую роль учётке, работающей
    // под ролью раздела (Plane №325).
    roles: sessionExpired ? [] : query.data?.roles ?? [],
    hasPermission,
    isLoading: status === "loading" || (status === "authenticated" && !sessionExpired && query.isLoading),
    error: query.error,
  };
}
