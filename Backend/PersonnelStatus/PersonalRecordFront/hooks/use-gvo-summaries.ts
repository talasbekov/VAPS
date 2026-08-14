"use client";

// Данные «Реестра ГВО»: патчи ручных правок по коду ОМ. Сама сводка не
// запрашивается — она выводится из бюллетеня (deriveGvoSummary) и сливается с
// патчем на клиенте, поэтому реестр ГВО остаётся согласованным с реестром ОМ
// независимо от того, живой он или мок.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import {
  GVO_SUMMARIES_PATH,
  gvoSummaryPatchPath,
  gvoSummaryResetPath,
} from "@/entities/gvo-summary";
import type {
  GvoSection,
  GvoSummaryPatch,
  GvoSummaryPatchRecord,
  ListGvoSummaryPatchesResponse,
} from "@/entities/gvo-summary";

const QUERY_KEY = ["ops-gvo-summaries"];

export function useGvoPatches(options: { enabled?: boolean } = {}) {
  return useQuery<ListGvoSummaryPatchesResponse, OpsApiFailure>({
    queryKey: QUERY_KEY,
    queryFn: () =>
      opsApiClient.get<ListGvoSummaryPatchesResponse>(GVO_SUMMARIES_PATH),
    enabled: options.enabled ?? true,
  });
}

/** Патчи в виде словаря по коду ОМ — форма, в которой их читают экраны. */
export function patchesByCode(
  response: ListGvoSummaryPatchesResponse | undefined
): Record<string, GvoSummaryPatch> {
  const map: Record<string, GvoSummaryPatch> = {};
  for (const record of response?.results ?? []) map[record.omCode] = record.patch;
  return map;
}

interface SaveSectionVariables extends Record<string, unknown> {
  omCode: string;
  section: GvoSection;
  values: GvoSummaryPatch;
}

export function useSaveGvoSection(options: { onSaved?: () => void } = {}) {
  const queryClient = useQueryClient();
  return useOpsMutation<GvoSummaryPatchRecord, SaveSectionVariables>({
    mutationFn: ({ omCode, section, values }) =>
      opsApiClient.patch<GvoSummaryPatchRecord>(gvoSummaryPatchPath(omCode), {
        section,
        values,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onSaved?.();
    },
  });
}

interface ResetSectionVariables extends Record<string, unknown> {
  omCode: string;
  section: GvoSection;
}

export function useResetGvoSection(options: { onReset?: () => void } = {}) {
  const queryClient = useQueryClient();
  return useOpsMutation<GvoSummaryPatchRecord, ResetSectionVariables>({
    mutationFn: ({ omCode, section }) =>
      opsApiClient.post<GvoSummaryPatchRecord>(gvoSummaryResetPath(omCode), {
        section,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      options.onReset?.();
    },
  });
}
