"use client";

// Запросы реестра объектов ОМ (конвенция OLD: hooks поверх клиента).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import { isReadAccessBlocked, readWithAccessCheck } from "@/lib/query-read-access";
import { currentOpsAuthorityStamp } from "@/lib/ops-write-authority";
import { OpsServerError } from "@/lib/ops-errors";
import type { OpsMyPermissionsResponse } from "@/hooks/use-ops-permissions";
import type { OpsApiFailure } from "@/lib/ops-errors";
import type { ListObjectHistoryResponse } from "@/entities/protected-person";
import {
  OPS_OBJECTS_PATH,
  objectDetailPath,
  objectHistoryPath,
  objectLocationPath,
  objectPhotoPath,
  type ListObjectsResponse,
  type SecurityObject,
  type UpdateObjectLocationRequest,
} from "@/entities/security-object";

export function useSecurityObjects(options: { enabled?: boolean; fresh?: boolean } = {}) {
  const client = useQueryClient();
  const key = ["ops-objects"] as const;
  const query = useQuery<ListObjectsResponse, OpsApiFailure>({
    queryKey: ["ops-objects"],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<ListObjectsResponse>(OPS_OBJECTS_PATH)),
    enabled: options.enabled ?? true,
    ...(options.fresh ? { staleTime: 0, refetchOnMount: "always" as const } : {}),
  });
  const readAccessBlocked = isReadAccessBlocked(client, key);
  return { ...query, data: readAccessBlocked ? undefined : query.data, readAccessBlocked };
}

/** Location writes cannot reuse a denied read, old grants or a closed editor. */
export function useUpdateObjectLocation(id: string, onSaved?: () => void, isCurrentResult?: () => boolean) {
  const client = useQueryClient();
  const key = ["ops-objects", id] as const;
  const submitted = useRef(new WeakMap<UpdateObjectLocationRequest, {
    context: (() => boolean) | undefined;
    authority: string | null;
    source: object | undefined;
    permissions: object | undefined;
  }>());
  function canWrite() {
    const permissions = client.getQueryState<OpsMyPermissionsResponse>(["ops-me"]);
    const grants = permissions?.data?.permissions ?? [];
    const read = client.getQueryState<SecurityObject>(key);
    return permissions?.status === "success" && read?.status === "success" && read.data?.id === id &&
      !isReadAccessBlocked(client, key) && !isReadAccessBlocked(client, ["ops-me"]) &&
      (grants.includes("*") || (grants.includes("object.view") && grants.includes("object.manage")));
  }
  return useOpsMutation<SecurityObject, UpdateObjectLocationRequest>({
    mutationFn: body => {
      if (!canWrite() || isCurrentResult?.() === false) throw new OpsServerError({
        status: 503, errorCode: "OBJECT_LOCATION_WRITE_UNAVAILABLE", message: "Повторите проверку доступа к объекту.", details: {}, requestId: null,
      });
      submitted.current.set(body, { context: isCurrentResult, authority: currentOpsAuthorityStamp(client, "object-location"),
        source: client.getQueryCache().find({ queryKey: key, exact: true }),
        permissions: client.getQueryCache().find({ queryKey: ["ops-me"], exact: true }) });
      return opsApiClient.patch<SecurityObject>(objectLocationPath(id), body);
    },
    onSuccess: (data, body) => {
      const captured = submitted.current.get(body);
      if (!captured || captured.context?.() === false || !canWrite() || data.id !== id ||
          captured.authority !== currentOpsAuthorityStamp(client, "object-location") ||
          captured.source !== client.getQueryCache().find({ queryKey: key, exact: true }) ||
          captured.permissions !== client.getQueryCache().find({ queryKey: ["ops-me"], exact: true })) return;
      client.setQueryData(key, data);
      void client.invalidateQueries({ queryKey: ["ops-objects"] });
      onSaved?.();
    },
  });
}

export function useSecurityObject(id: string, options: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const key = ["ops-objects", id] as const;
  const query = useQuery<SecurityObject, OpsApiFailure>({
    queryKey: ["ops-objects", id],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<SecurityObject>(objectDetailPath(id))),
    enabled: id !== "" && (options.enabled ?? true),
  });
  const readAccessBlocked = isReadAccessBlocked(client, key);
  return { ...query, data: readAccessBlocked ? undefined : query.data, readAccessBlocked };
}

/** Снимок объекта-каталога (Plane SJ-1049). Реестр перечитывается: карточка
 * объекта в раскрытии «Реестра ОМ» берёт снимок из каталога, а не хранит
 * свою копию. */
export function useUploadObjectPhoto() {
  const queryClient = useQueryClient();
  return useMutation<SecurityObject, OpsApiFailure, { id: string; file: File }>({
    mutationFn: ({ id, file }) => {
      const form = new FormData();
      form.append("photo", file);
      return opsApiClient.postForm<SecurityObject>(objectPhotoPath(id), form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-objects"] });
    },
  });
}

/** История ОМ на объекте (Plane №38). Запрос — только по открытию истории. */
export function useObjectEventHistory(id: string | null) {
  const client = useQueryClient();
  const key = ["ops-object-history", id] as const;
  const query = useQuery<ListObjectHistoryResponse, OpsApiFailure>({
    queryKey: ["ops-object-history", id],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<ListObjectHistoryResponse>(
        objectHistoryPath(id as string)
      )),
    enabled: id !== null,
  });
  const readAccessBlocked = isReadAccessBlocked(client, key);
  return { ...query, data: readAccessBlocked ? undefined : query.data, readAccessBlocked };
}
