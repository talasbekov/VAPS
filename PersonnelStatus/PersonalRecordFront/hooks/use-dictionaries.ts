"use client";

// Справочники: реестр, записи со связями, создание/деактивация/удаление.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  dictionaryEntriesPath,
  dictionaryEntryPath,
  dictionaryEntrySetActivePath,
  DICTIONARIES_PATH,
} from "@/entities/dictionary";
import type {
  CreateDictionaryEntryRequest,
  DictionaryEntryView,
  ListDictionaryDefinitionsResponse,
  ListDictionaryEntriesResponse,
  SetDictionaryEntryActiveRequest,
} from "@/entities/dictionary";

export function useDictionaries() {
  return useQuery<ListDictionaryDefinitionsResponse, OpsApiFailure>({
    queryKey: ["ops-dictionaries"],
    queryFn: () =>
      opsApiClient.get<ListDictionaryDefinitionsResponse>(DICTIONARIES_PATH),
  });
}

export function useDictionaryEntries(code: string) {
  return useQuery<ListDictionaryEntriesResponse, OpsApiFailure>({
    queryKey: ["ops-dictionaries", code],
    queryFn: () =>
      opsApiClient.get<ListDictionaryEntriesResponse>(
        dictionaryEntriesPath(code)
      ),
    enabled: code !== "",
  });
}

function useInvalidateDictionaries() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["ops-dictionaries"] });
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
  return useOpsMutation<void, { entryId: string }>({
    mutationFn: ({ entryId }) =>
      opsApiClient.del<void>(dictionaryEntryPath(entryId)),
    onSuccess: invalidate,
  });
}
