"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

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

function materialPath({ eventId, visitObjectId }: MaterialTarget): string {
  return `/api/ops/security-events/${encodeURIComponent(eventId)}/visit-objects/${encodeURIComponent(visitObjectId)}/recon-materials/`;
}

const materialKey = (eventId: string, visitObjectId: string | null) =>
  ["ops-recon-materials", eventId, visitObjectId] as const;

export function useReconMaterials(eventId: string, visitObjectId: string | null, enabled: boolean) {
  return useQuery<{ results: ReconMaterial[] }, OpsApiFailure>({
    queryKey: materialKey(eventId, visitObjectId),
    queryFn: () => opsApiClient.get<{ results: ReconMaterial[] }>(materialPath({ eventId, visitObjectId: visitObjectId! })),
    enabled: enabled && visitObjectId !== null,
  });
}

export function useUploadReconMaterial() {
  const client = useQueryClient();
  return useMutation<ReconMaterial, OpsApiFailure, MaterialTarget & { file: File; checklistItemId: string | null }>({
    mutationFn: (target) => {
      const form = new FormData();
      form.append("file", target.file);
      if (target.checklistItemId !== null) form.append("checklistItemId", target.checklistItemId);
      return opsApiClient.postForm<ReconMaterial>(materialPath(target), form);
    },
    onSuccess: (_row, target) => {
      void client.invalidateQueries({ queryKey: materialKey(target.eventId, target.visitObjectId) });
    },
  });
}

export function useRemoveReconMaterial() {
  const client = useQueryClient();
  return useMutation<void, OpsApiFailure, MaterialIdentifier>({
    mutationFn: (target) => opsApiClient.del<void>(`${materialPath(target)}${encodeURIComponent(target.materialId)}/`),
    onSuccess: (_response, target) => {
      void client.invalidateQueries({ queryKey: materialKey(target.eventId, target.visitObjectId) });
    },
  });
}

export function useDownloadReconMaterial() {
  return useMutation<{ blob: Blob; filename: string | null }, OpsApiFailure, MaterialIdentifier>({
    mutationFn: (target) => opsApiClient.download(`${materialPath(target)}${encodeURIComponent(target.materialId)}/download/`),
  });
}
