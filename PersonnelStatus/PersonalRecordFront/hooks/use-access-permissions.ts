"use client";

// Справочник прав и каталог их применения (Plane №36, шаг «П-6»).
// Поиск идёт НА СЕРВЕР и потому попадает в ключ кэша: фильтрация показанной
// страницы отвечала бы «такого права нет», имея в виду «нет на этой странице».
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  ACCESS_CATALOG_PATH,
  ACCESS_PERMISSIONS_PATH,
  ACCESS_ACCOUNTS_PATH,
  ACCESS_ROLES_PATH,
  ACCESS_USER_ROLES_PATH,
  accessPermissionPath,
  accessRolePath,
  accessRolePermissionsPath,
  accessUserRolePath,
} from "@/entities/access";
import type {
  AccessAccount,
  AccessCatalogResponse,
  AccessPermission,
  AccessRole,
  AccessUserRole,
  AssignAccessRoleRequest,
  ChangeRolePermissionsRequest,
  ListAccessAccountsResponse,
  ListAccessPermissionsResponse,
  ListAccessRolesResponse,
  ListAccessUserRolesResponse,
  SaveAccessPermissionRequest,
  SaveAccessRoleRequest,
} from "@/entities/access";

function withSearch(path: string, search: string): string {
  const trimmed = search.trim();
  return trimmed === ""
    ? path
    : `${path}?search=${encodeURIComponent(trimmed)}`;
}

export function useAccessPermissions(search: string) {
  return useQuery<ListAccessPermissionsResponse, OpsApiFailure>({
    queryKey: ["ops-access-permissions", search.trim()],
    queryFn: () =>
      opsApiClient.get<ListAccessPermissionsResponse>(
        withSearch(ACCESS_PERMISSIONS_PATH, search)
      ),
  });
}

/** Каталог применения запрашивается ЦЕЛИКОМ и один раз на экран: он
 * собирается из карт гейтов, за поиском по правам не следует и на строку
 * права отвечает мгновенно из кэша. */
export function useAccessCatalog() {
  return useQuery<AccessCatalogResponse, OpsApiFailure>({
    queryKey: ["ops-access-catalog"],
    queryFn: () =>
      opsApiClient.get<AccessCatalogResponse>(ACCESS_CATALOG_PATH),
  });
}

export function useCreateAccessPermission(options?: {
  onFormError?: (details: Record<string, unknown>) => void;
}) {
  const queryClient = useQueryClient();
  return useOpsMutation<AccessPermission, SaveAccessPermissionRequest>({
    mutationFn: (body) =>
      opsApiClient.post<AccessPermission>(ACCESS_PERMISSIONS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["ops-access-permissions"],
      });
      // Каталог тоже перечитывается: у нового права появляется строка
      // справочника, и «право без имени» в каталоге становится именованным.
      void queryClient.invalidateQueries({ queryKey: ["ops-access-catalog"] });
    },
    onFormError: options?.onFormError,
  });
}

export function useSetAccessPermissionActive() {
  const queryClient = useQueryClient();
  return useOpsMutation<
    AccessPermission,
    { code: string; is_active: boolean }
  >({
    mutationFn: ({ code, is_active }) =>
      opsApiClient.patch<AccessPermission>(accessPermissionPath(code), {
        is_active,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["ops-access-permissions"],
      });
      void queryClient.invalidateQueries({ queryKey: ["ops-access-catalog"] });
    },
  });
}

// ── Роли (Plane №36, шаг «П-7») ────────────────────────────────────────────

export function useAccessRoles(search: string) {
  return useQuery<ListAccessRolesResponse, OpsApiFailure>({
    queryKey: ["ops-access-roles", search.trim()],
    queryFn: () =>
      opsApiClient.get<ListAccessRolesResponse>(
        withSearch(ACCESS_ROLES_PATH, search)
      ),
  });
}

export function useCreateAccessRole(options?: {
  onFormError?: (details: Record<string, unknown>) => void;
}) {
  const queryClient = useQueryClient();
  return useOpsMutation<AccessRole, SaveAccessRoleRequest>({
    mutationFn: (body) =>
      opsApiClient.post<AccessRole>(ACCESS_ROLES_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-access-roles"] });
    },
    onFormError: options?.onFormError,
  });
}

export function useSetAccessRoleActive() {
  const queryClient = useQueryClient();
  return useOpsMutation<AccessRole, { code: string; is_active: boolean }>({
    mutationFn: ({ code, is_active }) =>
      opsApiClient.patch<AccessRole>(accessRolePath(code), { is_active }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-access-roles"] });
    },
  });
}

/** Состав прав роли: правка меняет ЖИВОЙ доступ у всех, кому роль выдана,
 * поэтому вслед за ней перечитываются и права текущего пользователя — он мог
 * править роль, которая выдана ему самому. */
export function useChangeRolePermissions(code: string) {
  const queryClient = useQueryClient();
  return useOpsMutation<AccessRole, ChangeRolePermissionsRequest>({
    mutationFn: (body) =>
      opsApiClient.post<AccessRole>(accessRolePermissionsPath(code), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-access-roles"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-me"] });
    },
  });
}

// ── Учётные записи и назначения ролей (Plane №36, шаг «П-8») ───────────────

export function useAccessAccounts(search: string) {
  return useQuery<ListAccessAccountsResponse, OpsApiFailure>({
    queryKey: ["ops-access-accounts", search.trim()],
    queryFn: () =>
      opsApiClient.get<ListAccessAccountsResponse>(
        withSearch(ACCESS_ACCOUNTS_PATH, search)
      ),
  });
}

/** Назначения ОДНОГО человека: список раздела длинный, и тянуть его целиком
 * ради карточки незачем — фильтр по `user_id` есть на сервере. */
export function useAccessUserRoles(userId: number | null) {
  return useQuery<ListAccessUserRolesResponse, OpsApiFailure>({
    queryKey: ["ops-access-user-roles", userId],
    queryFn: () =>
      opsApiClient.get<ListAccessUserRolesResponse>(
        `${ACCESS_USER_ROLES_PATH}?user_id=${encodeURIComponent(String(userId))}`
      ),
    enabled: userId !== null,
  });
}

function invalidateAccess(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ["ops-access-user-roles"] });
  // Права текущего пользователя тоже перечитываются: администратор мог
  // раздать или снять роль самому себе.
  void queryClient.invalidateQueries({ queryKey: ["ops-me"] });
}

export function useAssignAccessRole() {
  const queryClient = useQueryClient();
  return useOpsMutation<AccessUserRole, AssignAccessRoleRequest>({
    mutationFn: (body) =>
      opsApiClient.post<AccessUserRole>(ACCESS_USER_ROLES_PATH, body),
    onSuccess: () => invalidateAccess(queryClient),
  });
}

export function useRevokeAccessRole() {
  const queryClient = useQueryClient();
  return useOpsMutation<void, { id: number }>({
    mutationFn: ({ id }) => opsApiClient.del<void>(accessUserRolePath(id)),
    onSuccess: () => invalidateAccess(queryClient),
  });
}
