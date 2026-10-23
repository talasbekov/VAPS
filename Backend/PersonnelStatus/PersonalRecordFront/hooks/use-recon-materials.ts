"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError, type OpsApiFailure } from "@/lib/ops-errors";
import { assertOpsReadAuthority, hasCurrentOpsReadAuthority, hasOpsReadAuthority, useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import { blockReadAccess, isReadAccessBlocked } from "@/lib/query-read-access";

export interface ReconMaterial {
  id: string;
  eventId: string;
  visitObjectId: string;
  checklistItemId: string | null;
  name: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string | null;
}

interface MaterialTarget {
  eventId: string;
  visitObjectId: string;
}

interface MaterialIdentifier extends MaterialTarget {
  materialId: string;
}

interface MaterialSelection { eventId: string; visitObjectId: string | null }
interface MaterialList { results: ReconMaterial[] }
const GROUP = "ops-recon-materials";

function materialPath({ eventId, visitObjectId }: MaterialTarget): string {
  return `/api/ops/security-events/${encodeURIComponent(eventId)}/visit-objects/${encodeURIComponent(visitObjectId)}/recon-materials/`;
}

// Each object has its own reader policy. A denial must not evict another object.
const materialPrefix = (eventId: string, visitObjectId: string | null) =>
  [GROUP, JSON.stringify([eventId, visitObjectId])] as const;
const materialKey = (scope: string, target: MaterialSelection) =>
  [...materialPrefix(target.eventId, target.visitObjectId), scope] as const;

function unavailable(): never {
  throw new OpsApiError({ status: 403, errorCode: "READ_AUTHORITY_UNAVAILABLE",
    message: "Материалы недоступны до обновления данных и проверки доступа.", details: {}, requestId: null });
}

export function useReconMaterials(eventId: string, visitObjectId: string | null, enabled: boolean) {
  const client = useQueryClient();
  const access = useOpsReadAccess("event.view");
  return useOpsProtectedRead<MaterialList>(materialPrefix(eventId, visitObjectId), [], access,
    () => opsApiClient.get<MaterialList>(materialPath({ eventId, visitObjectId: visitObjectId! }), () => {
      if (!hasCurrentOpsReadAuthority(client, access)) unavailable();
    }), { enabled: enabled && visitObjectId !== null, staleTime: 60_000, denialFamily: [] });
}

function useMaterialMutation<T, V extends MaterialTarget>(
  operation: (target: V) => Promise<T>, selected: MaterialSelection | undefined,
  options: { invalidate?: boolean; readerDenial?: boolean },
) {
  const client = useQueryClient();
  const access = useOpsReadAccess("event.view");
  const current = useRef({ scope: access.scope, selected, active: true });
  current.current = { scope: access.scope, selected, active: current.current.active };
  useEffect(() => {
    current.current.active = true;
    return () => { current.current.active = false; };
  }, []);

  function capture(target: V) {
    const checkTarget = () => {
      const live = current.current;
      if (!live.active || live.scope !== access.scope || !hasCurrentOpsReadAuthority(client, access) ||
          (live.selected && (live.selected.eventId !== target.eventId || live.selected.visitObjectId !== target.visitObjectId))) unavailable();
    };
    checkTarget();
    const key = materialKey(access.scope, target);
    assertOpsReadAuthority(client, access, GROUP, key);
    const source = client.getQueryCache().find({ queryKey: key, exact: true });
    const data = client.getQueryData<MaterialList>(key);
    if ("materialId" in target && !data?.results.some(row => row.id === target.materialId)) unavailable();
    return { key, query: source, assertCurrent(acceptedWrite = false) {
      checkTarget();
      if (client.getQueryCache().find({ queryKey: key, exact: true }) !== source ||
          (!acceptedWrite && client.getQueryData(key) !== data) ||
          !hasOpsReadAuthority(client, access, GROUP, key, acceptedWrite)) unavailable();
    } };
  }

  const mutation = useMutation<T, OpsApiFailure, V>({
    mutationKey: [GROUP, "action", access.scope, selected?.eventId, selected?.visitObjectId],
    mutationFn: async target => {
      const source = capture(target);
      // A successful refetch may include an upload or exclude a removed row.
      // Remember an interrupted source so later recovery cannot revive this write.
      let interrupted = false;
      const unsubscribe = options.invalidate ? client.getQueryCache().subscribe(event => {
        if (event.query === source.query && (event.type === "removed" || event.query.state.status === "error" ||
            event.query.state.data === undefined || isReadAccessBlocked(client, source.key))) interrupted = true;
      }) : undefined;
      try {
        let result: T;
        try { result = await operation(target); }
        catch (error) {
          const status = (error as { status?: number } | null)?.status;
          if (options.readerDenial && (status === 401 || status === 403)) blockReadAccess(client, source.key, true);
          throw error;
        }
        try {
          if (interrupted) unavailable();
          source.assertCurrent(options.invalidate === true);
        } catch (error) {
          // The server may already have accepted this write. Mark its old cache
          // stale without starting a request or publishing into the new target.
          if (options.invalidate) void client.invalidateQueries({ queryKey: source.key, exact: true, refetchType: "none" });
          throw error;
        }
        // Completion uses the authorised source, not pre-write row membership.
        if (options.invalidate) void client.invalidateQueries({ queryKey: source.key, exact: true });
        return result;
      } finally {
        unsubscribe?.();
      }
    },
  });
  return { ...mutation,
    mutateAsync: (target: V) => {
      try { capture(target); }
      catch (error) { return Promise.reject(error); }
      return mutation.mutateAsync(target);
    },
    mutate: (target: V) => {
      try { capture(target); }
      catch { return; }
      mutation.mutate(target);
    },
  };
}

export function useUploadReconMaterial(selected?: MaterialSelection) {
  return useMaterialMutation<ReconMaterial, MaterialTarget & { file: File; checklistItemId: string | null }>(target => {
    const form = new FormData();
    form.append("file", target.file);
    if (target.checklistItemId !== null) form.append("checklistItemId", target.checklistItemId);
    return opsApiClient.postForm<ReconMaterial>(materialPath(target), form);
  }, selected, { invalidate: true });
}

export function useRemoveReconMaterial(selected?: MaterialSelection) {
  return useMaterialMutation<void, MaterialIdentifier>(
    target => opsApiClient.del<void>(`${materialPath(target)}${encodeURIComponent(target.materialId)}/`), selected, { invalidate: true });
}

export function useDownloadReconMaterial(selected?: MaterialSelection) {
  return useMaterialMutation<{ blob: Blob; filename: string | null }, MaterialIdentifier>(
    target => opsApiClient.download(`${materialPath(target)}${encodeURIComponent(target.materialId)}/download/`), selected, { readerDenial: true });
}
