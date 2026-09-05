"use client";

// Данные «Реестра ГВО». Сводка ПРИХОДИТ С СЕРВЕРА собранной (Plane №166):
// база из бюллетеня плюс ручные правки. Раньше базу выводил браузер
// (deriveGvoSummary), а сервер хранил только патч — две сборки успели
// разойтись на форме даты за один день.
//
// Патчи (useGvoPatches) остаются ради правки разделов: окно правки кладёт
// значения патчем, и ему нужен текущий патч, а не собранная сводка.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import {
  GVO_SUMMARIES_ASSEMBLED_PATH,
  GVO_SUMMARIES_PATH,
  gvoSummaryPatchPath,
  gvoSummaryPath,
  gvoSummaryResetPath,
} from "@/entities/gvo-summary";
import type {
  GvoSection,
  GvoSummaryPatch,
  GvoSummaryPatchRecord,
  GvoSummaryRow,
  ListGvoSummariesResponse,
  ListGvoSummaryPatchesResponse,
} from "@/entities/gvo-summary";

const QUERY_KEY = ["ops-gvo-summaries"];
const ASSEMBLED_KEY = ["ops-gvo-summaries", "assembled"];

export function useGvoPatches(options: { enabled?: boolean } = {}) {
  return useQuery<ListGvoSummaryPatchesResponse, OpsApiFailure>({
    queryKey: QUERY_KEY,
    queryFn: () =>
      opsApiClient.get<ListGvoSummaryPatchesResponse>(GVO_SUMMARIES_PATH),
    enabled: options.enabled ?? true,
  });
}

/**
 * Собранные сводки ВСЕХ мероприятий — одним запросом. Реестрам нужна сводка
 * каждой строки, и запрос на строку стоил бы столько же запросов, сколько
 * мероприятий.
 */
export function useGvoSummaries(options: { enabled?: boolean } = {}) {
  return useQuery<ListGvoSummariesResponse, OpsApiFailure>({
    queryKey: ASSEMBLED_KEY,
    queryFn: () =>
      opsApiClient.get<ListGvoSummariesResponse>(GVO_SUMMARIES_ASSEMBLED_PATH),
    enabled: options.enabled ?? true,
  });
}

/** Собранная сводка ОДНОГО мероприятия — со строкой целиком: сводка плюс
 * признак «Заполнена», посчитанный там же, где собрана сводка. */
export function useGvoSummary(omCode: string, options: { enabled?: boolean } = {}) {
  return useQuery<GvoSummaryRow, OpsApiFailure>({
    queryKey: ["ops-gvo-summary", omCode],
    queryFn: () => opsApiClient.get<GvoSummaryRow>(gvoSummaryPath(omCode)),
    enabled: (options.enabled ?? true) && omCode !== "",
  });
}

/** Собранные сводки словарём по коду ОМ — форма, в которой их читают экраны. */
export function summariesByCode(
  response: ListGvoSummariesResponse | undefined
): Record<string, GvoSummaryRow> {
  const map: Record<string, GvoSummaryRow> = {};
  for (const row of response?.results ?? []) map[row.omCode] = row;
  return map;
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
  /** `null` — правка нескольких разделов одним запросом (Plane №694). */
  section: GvoSection | null;
  values: GvoSummaryPatch;
  unspecified?: string[];
}

export function useSaveGvoSection(options: { onSaved?: () => void } = {}) {
  const queryClient = useQueryClient();
  return useOpsMutation<GvoSummaryPatchRecord, SaveSectionVariables>({
    mutationFn: ({ omCode, section, values, unspecified }) =>
      opsApiClient.patch<GvoSummaryPatchRecord>(gvoSummaryPatchPath(omCode), {
        section,
        values,
        // Флаги «уточняется» (Plane №435) — полным списком, если окно их вело.
        ...(unspecified === undefined ? {} : { unspecified }),
      }),
    onSuccess: () => {
      // QUERY_KEY сбрасывает и патчи, и собранный список: ключ списка
      // начинается с него, а react-query сбрасывает по префиксу. Сводка
      // ОДНОГО мероприятия лежит под своим корнем и требует второй строки —
      // без неё экран остался бы со старой сводкой рядом со свежим патчем.
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["ops-gvo-summary"] });
      options.onSaved?.();
    },
  });
}

interface ResetSectionVariables extends Record<string, unknown> {
  omCode: string;
  /** `null` — вся сводка одним запросом (Plane №765). */
  section: GvoSection | null;
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
      void queryClient.invalidateQueries({ queryKey: ["ops-gvo-summary"] });
      options.onReset?.();
    },
  });
}

/** «Утвердить» визит (`[ГВО-07]`/`[ГВО-09]`, Plane №436) — штаб. */
export function useApproveVisit(options: { onApproved?: () => void } = {}) {
  const queryClient = useQueryClient();
  return useOpsMutation<GvoSummaryRow, { omCode: string }>({
    mutationFn: ({ omCode }) =>
      opsApiClient.post<GvoSummaryRow>(`${gvoSummaryPath(omCode)}approve/`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-gvo-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-gvo-summaries"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-audit-logs"] });
      options.onApproved?.();
    },
  });
}
