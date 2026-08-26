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
  accessPermissionPath,
} from "@/entities/access";
import type {
  AccessCatalogResponse,
  AccessPermission,
  ListAccessPermissionsResponse,
  SaveAccessPermissionRequest,
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
