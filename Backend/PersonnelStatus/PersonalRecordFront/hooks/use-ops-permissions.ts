"use client";

// Права раздела ОМ — плоский список кодов с бэкенда ОМ (или мока), НЕ
// resource/action-роли lib/auth.tsx: две системы прав сосуществуют.
// Query-кэш — единственный источник; копий в useState/Context нет.
// Ключ ['ops-me'] намеренно не пересекается с чужими ключами кэша хоста.
import { useCallback, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { isReadAccessBlocked, readWithAccessCheck } from "@/lib/query-read-access";
import { OpsPermissionSuspensionContext } from "@/lib/ops-permission-suspension";

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
  global_permissions?: string[];
  status_manage_division_ids?: number[] | null;
  service_employees_access?: boolean;
  roles?: OpsSectionRole[];
  duty_register_scope?: Record<'read' | 'write' | 'plan' | 'dispatch', (number | string)[] | null>;
}

export interface UseOpsPermissionsResult {
  /** undefined, пока запрос прав не завершён (или выключен без пользователя). */
  permissions: ReadonlySet<string> | undefined;
  /** Permissions from unscoped grants; absent on older API responses. */
  globalPermissions: ReadonlySet<string> | undefined;
  statusManageDivisionIds?: readonly number[] | null;
  serviceEmployeesAccess?: boolean;
  dutyRegisterScope?: OpsMyPermissionsResponse['duty_register_scope'];
  /** Роли раздела актора; пусто — их нет либо ответ ещё не пришёл. */
  roles: OpsSectionRole[];
  hasPermission(code: string): boolean;
  hasGlobalPermission(code: string): boolean;
  isLoading: boolean;
  error: OpsApiFailure | null;
  /** A known transient refresh may hide and suspend the mounted editor. */
  canSuspendOnFailure: boolean;
}

export function useOpsPermissions(): UseOpsPermissionsResult {
  const { data: session, status } = useSession();
  const client = useQueryClient();
  const suspension = useContext(OpsPermissionSuspensionContext);
  const sessionExpired = (session as { error?: string } | null)?.error !== undefined;
  const query = useQuery<OpsMyPermissionsResponse, OpsApiFailure>({
    queryKey: ["ops-me"],
    refetchOnWindowFocus: "always",
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<OpsMyPermissionsResponse>(
        "/api/operations/my-permissions/"
      )),
    // До завершения входа токена нет. Анонимный 403 не является набором прав
    // и не должен оставаться в кэше до успешного submit формы.
    enabled: status === "authenticated" && !sessionExpired,
  });

  // React Query retains the last successful data after a failed refresh.
  // Cached grants must not authorize actions after that failure or sign-out.
  const authorityAvailable = status === "authenticated" && !sessionExpired && !query.isError;
  const canSuspendOnFailure = status === "authenticated" && !sessionExpired && query.data !== undefined && query.isError &&
    (query.error?.kind === "server" || query.error?.kind === "network") && !isReadAccessBlocked(client, ["ops-me"]);
  const permissions = useMemo<ReadonlySet<string> | undefined>(
    () =>
      !authorityAvailable || query.data === undefined ? undefined : new Set(query.data.permissions),
    [query.data, authorityAvailable]
  );

  const globalPermissions = useMemo<ReadonlySet<string> | undefined>(
    () =>
      !authorityAvailable || query.data?.global_permissions === undefined
        ? undefined
        : new Set(query.data.global_permissions),
    [query.data, authorityAvailable]
  );

  // wildcard `*` = администратор; иерархий/префиксов нет — плоский список
  const hasPermission = useCallback(
    (code: string): boolean =>
      permissions !== undefined &&
      (permissions.has("*") || permissions.has(code)),
    [permissions]
  );

  // Global administration requires an authenticated, successful response with
  // an explicit unscoped grant. Scoped/older aggregate permissions cannot
  // supply this authority when global_permissions is absent.
  const hasGlobalPermission = useCallback(
    (code: string): boolean =>
      status === "authenticated" && !query.isError &&
      globalPermissions !== undefined &&
      (globalPermissions.has("*") || globalPermissions.has(code)),
    [globalPermissions, status, query.isError]
  );

  // Suspense keeps the last committed editor mounted and hidden. Letting a
  // nested gate reconcile with false grants would erase that editor first.
  if (canSuspendOnFailure && suspension) throw suspension;

  return {
    permissions,
    globalPermissions,
    statusManageDivisionIds: authorityAvailable ? query.data?.status_manage_division_ids : undefined,
    serviceEmployeesAccess: authorityAvailable ? query.data?.service_employees_access : undefined,
    dutyRegisterScope: authorityAvailable ? query.data?.duty_register_scope : undefined,
    // Роли раздела — ОТДЕЛЬНО от прав: права отвечают «что мне можно», роль —
    // «кто я здесь». Шапка портала печатала кадровую роль учётке, работающей
    // под ролью раздела (Plane №325).
    roles: authorityAvailable ? query.data?.roles ?? [] : [],
    hasPermission,
    hasGlobalPermission,
    isLoading: status === "loading" || (status === "authenticated" && !sessionExpired && query.isLoading),
    error: query.error,
    canSuspendOnFailure,
  };
}
