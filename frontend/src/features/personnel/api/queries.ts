// Query hooks (§7.10, §5.4): apiClient — единственная точка транспорта.
// Все 4 справочника малы (demo/donor масштаб) — читаются одной страницей,
// без пролистывания (как существующий `divisionsQuery` в daily-grid).
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import type { ApiFailure } from '../../../shared/api/errors'
import type { paths } from '../../../shared/api/schema'

type EmployeesResponse =
  paths['/api/core/employees/']['get']['responses']['200']['content']['application/json']
type EmployeeResponse =
  paths['/api/core/employees/{id}/']['get']['responses']['200']['content']['application/json']
type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']
type PositionsResponse =
  paths['/api/core/positions/']['get']['responses']['200']['content']['application/json']
type RanksResponse =
  paths['/api/core/ranks/']['get']['responses']['200']['content']['application/json']

export function useEmployees() {
  return useQuery<EmployeesResponse, ApiFailure>({
    queryKey: ['personnel', 'employees'],
    queryFn: () => apiClient.get<EmployeesResponse>('/api/core/employees/'),
  })
}

export function useEmployee(id: string) {
  return useQuery<EmployeeResponse, ApiFailure>({
    queryKey: ['personnel', 'employees', id],
    queryFn: () => apiClient.get<EmployeeResponse>(`/api/core/employees/${id}/`),
  })
}

export function useDivisions() {
  return useQuery<DivisionsResponse, ApiFailure>({
    queryKey: ['personnel', 'divisions'],
    queryFn: () => apiClient.get<DivisionsResponse>('/api/core/divisions/'),
    staleTime: 5 * 60_000,
  })
}

export function usePositions() {
  return useQuery<PositionsResponse, ApiFailure>({
    queryKey: ['personnel', 'positions'],
    queryFn: () => apiClient.get<PositionsResponse>('/api/core/positions/'),
    staleTime: 5 * 60_000,
  })
}

export function useRanks() {
  return useQuery<RanksResponse, ApiFailure>({
    queryKey: ['personnel', 'ranks'],
    queryFn: () => apiClient.get<RanksResponse>('/api/core/ranks/'),
    staleTime: 5 * 60_000,
  })
}
