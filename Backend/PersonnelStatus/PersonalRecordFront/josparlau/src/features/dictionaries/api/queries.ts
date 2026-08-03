// Query/mutation hooks (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  DICTIONARIES_PATH,
  dictionaryEntriesPath,
  dictionaryEntryPath,
  dictionaryEntrySetActivePath,
} from './pending-contracts'
import type {
  CreateDictionaryEntryRequest,
  CreateDictionaryEntryResponse,
  ListDictionaryDefinitionsResponse,
  ListDictionaryEntriesResponse,
  SetDictionaryEntryActiveRequest,
  SetDictionaryEntryActiveResponse,
} from './pending-contracts'

export function useDictionaryDefinitions() {
  return useQuery<ListDictionaryDefinitionsResponse, ApiFailure>({
    queryKey: ['dictionaries', 'definitions'],
    queryFn: () => apiClient.get<ListDictionaryDefinitionsResponse>(DICTIONARIES_PATH),
  })
}

export function useDictionaryEntries(dictionaryCode: string) {
  return useQuery<ListDictionaryEntriesResponse, ApiFailure>({
    queryKey: ['dictionaries', 'entries', dictionaryCode],
    queryFn: () =>
      apiClient.get<ListDictionaryEntriesResponse>(dictionaryEntriesPath(dictionaryCode)),
    enabled: dictionaryCode !== '',
  })
}

export function useCreateDictionaryEntry(dictionaryCode: string) {
  const queryClient = useQueryClient()
  return useApiMutation<CreateDictionaryEntryResponse, CreateDictionaryEntryRequest>({
    mutationFn: (body) =>
      apiClient.post<CreateDictionaryEntryResponse>(dictionaryEntriesPath(dictionaryCode), body),
    onSuccess: () => {
      // Инвалидируется ВЕСЬ раздел, а не только свой справочник: связи стали
      // живыми и считаются перекрёстно — значение «Требований постов» меняет
      // связи «Групп требований», поэтому узкая инвалидация показала бы
      // соседнему справочнику устаревшую зависимость.
      void queryClient.invalidateQueries({ queryKey: ['dictionaries'] })
    },
  })
}

export function useDeleteDictionaryEntry() {
  const queryClient = useQueryClient()
  return useApiMutation<undefined, { id: string }>({
    mutationFn: ({ id }) => apiClient.del(dictionaryEntryPath(id)),
    onSuccess: () => {
      // Инвалидируется ВЕСЬ раздел, а не только свой справочник: связи стали
      // живыми и считаются перекрёстно — значение «Требований постов» меняет
      // связи «Групп требований», поэтому узкая инвалидация показала бы
      // соседнему справочнику устаревшую зависимость.
      void queryClient.invalidateQueries({ queryKey: ['dictionaries'] })
    },
  })
}

export function useSetDictionaryEntryActive() {
  const queryClient = useQueryClient()
  return useApiMutation<
    SetDictionaryEntryActiveResponse,
    SetDictionaryEntryActiveRequest & { id: string }
  >({
    mutationFn: ({ id, isActive }) =>
      apiClient.post<SetDictionaryEntryActiveResponse>(dictionaryEntrySetActivePath(id), {
        isActive,
      }),
    onSuccess: () => {
      // Инвалидируется ВЕСЬ раздел, а не только свой справочник: связи стали
      // живыми и считаются перекрёстно — значение «Требований постов» меняет
      // связи «Групп требований», поэтому узкая инвалидация показала бы
      // соседнему справочнику устаревшую зависимость.
      void queryClient.invalidateQueries({ queryKey: ['dictionaries'] })
    },
  })
}
