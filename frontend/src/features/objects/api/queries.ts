// Query/mutation hooks (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  objectDetailPath,
  objectPassportPath,
  OBJECTS_PATH,
} from './pending-contracts'
import type {
  ListObjectsResponse,
  UpdatePassportRequest,
  UpdatePassportResponse,
} from './pending-contracts'
import type { SecurityObject } from '../model/types'

export function useObjectsList() {
  return useQuery<ListObjectsResponse, ApiFailure>({
    queryKey: ['objects'],
    queryFn: () => apiClient.get<ListObjectsResponse>(OBJECTS_PATH),
  })
}

export function useObject(id: string) {
  return useQuery<SecurityObject, ApiFailure>({
    queryKey: ['objects', id],
    queryFn: () => apiClient.get<SecurityObject>(objectDetailPath(id)),
  })
}

export function useUpdatePassport(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<UpdatePassportResponse, UpdatePassportRequest>({
    mutationFn: (body) =>
      apiClient.patch<UpdatePassportResponse>(objectPassportPath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(['objects', id], data)
      void queryClient.invalidateQueries({ queryKey: ['objects'] })
    },
  })
}
