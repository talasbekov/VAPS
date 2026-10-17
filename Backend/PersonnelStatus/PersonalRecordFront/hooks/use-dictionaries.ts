"use client";

// Справочники: реестр, записи со связями, создание/деактивация/удаление.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { isReadAccessBlocked, readWithAccessCheck } from "@/lib/query-read-access";
import {
  dictionaryEntriesPath,
  dictionaryEntryPath,
  dictionaryEntrySetActivePath,
  dictionaryEntrySupersedePath,
  DICTIONARIES_PATH,
} from "@/entities/dictionary";
import type {
  CreateDictionaryEntryRequest,
  DictionaryEntryView,
  ListDictionaryDefinitionsResponse,
  ListDictionaryEntriesResponse,
  RemoveDictionaryEntryResult,
  SetDictionaryEntryActiveRequest,
  SupersedeDictionaryEntryRequest,
  UpdateDictionaryEntryRequest,
} from "@/entities/dictionary";

export function useDictionaries({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<ListDictionaryDefinitionsResponse, OpsApiFailure>({
    queryKey: ["ops-dictionaries"],
    queryFn: () =>
      opsApiClient.get<ListDictionaryDefinitionsResponse>(DICTIONARIES_PATH),
    // Справочник меняется реже, чем открывают экраны: минутный staleTime
    // заставлял перезапрашивать его на каждом переходе.
    staleTime: 10 * 60_000,
    enabled,
  });
}

export function useDictionaryEntries(code: string, { enabled = true }: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const key = ["ops-dictionaries", code];
  const query = useQuery<ListDictionaryEntriesResponse, OpsApiFailure>({
    queryKey: key,
    queryFn: ({ signal }) => readWithAccessCheck(client, key, signal, () =>
      opsApiClient.get<ListDictionaryEntriesResponse>(dictionaryEntriesPath(code))),
    enabled: enabled && code !== "",
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const blocked = isReadAccessBlocked(client, key);
  return { ...query, blocked, visibleData: enabled && !blocked ? query.data : undefined };
}

function useInvalidateDictionaries() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["ops-dictionaries"] });
    void queryClient.invalidateQueries({ predicate: query => query.queryKey[0] === 'duty-register' && query.queryKey[2] === 'kinds' });
  };
}

export function useCreateDictionaryEntry(
  code: string,
  options?: { onFormError?: (details: Record<string, unknown>) => void }
) {
  const invalidate = useInvalidateDictionaries();
  return useOpsMutation<DictionaryEntryView, CreateDictionaryEntryRequest>({
    mutationFn: (body) =>
      opsApiClient.post<DictionaryEntryView>(dictionaryEntriesPath(code), body),
    onSuccess: invalidate,
    onFormError: options?.onFormError,
  });
}

export function useUpdateDictionaryEntry(options?: {
  onFormError?: (details: Record<string, unknown>) => void;
}) {
  const invalidate = useInvalidateDictionaries();
  return useOpsMutation<
    DictionaryEntryView,
    UpdateDictionaryEntryRequest & { entryId: string }
  >({
    mutationFn: ({ entryId, ...body }) =>
      opsApiClient.patch<DictionaryEntryView>(dictionaryEntryPath(entryId), body),
    onSuccess: invalidate,
    onFormError: options?.onFormError,
  });
}

export function useSetDictionaryEntryActive() {
  const invalidate = useInvalidateDictionaries();
  return useOpsMutation<
    DictionaryEntryView,
    SetDictionaryEntryActiveRequest & { entryId: string }
  >({
    mutationFn: ({ entryId, ...body }) =>
      opsApiClient.post<DictionaryEntryView>(
        dictionaryEntrySetActivePath(entryId),
        body
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteDictionaryEntry() {
  const invalidate = useInvalidateDictionaries();
  return useOpsMutation<RemoveDictionaryEntryResult, { entryId: string }>({
    mutationFn: async ({ entryId }) => {
      const body = await opsApiClient.del<RemoveDictionaryEntryResult | undefined>(
        dictionaryEntryPath(entryId)
      );
      return body ?? { result: "deleted" };
    },
    onSuccess: invalidate,
  });
}

export function useSupersedeDictionaryEntry(options?: {
  onFormError?: (details: Record<string, unknown>) => void;
}) {
  const invalidate = useInvalidateDictionaries();
  return useOpsMutation<
    DictionaryEntryView,
    SupersedeDictionaryEntryRequest & { entryId: string }
  >({
    mutationFn: ({ entryId, ...body }) =>
      opsApiClient.post<DictionaryEntryView>(dictionaryEntrySupersedePath(entryId), body),
    onSuccess: invalidate,
    onFormError: options?.onFormError,
  });
}
