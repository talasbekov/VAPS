// Права — ЕДИНСТВЕННЫМ путём useQuery(['me']) (ARCH-FE-010 L237): Query-кэш —
// единственный источник, копий в useState/Context нет. Тип ответа — ИЗ
// schema.d.ts (ARCH-FE-011), рукописный тип запрещён.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import type { paths } from '../api/schema'
import type { ApiFailure } from '../api/errors'
import { getSnapshot, subscribe } from './credential'

type MyPermissionsResponse =
  paths['/api/operations/my-permissions/']['get']['responses']['200']['content']['application/json']

export function useMe() {
  // enabled-гейт РЕАКТИВЕН (подписка, не однократный снапшот): после login()
  // запрос стартует сам, после 401-очистки гаснет. Без credential запрос НЕ
  // уходит вовсе — на проводе его отсутствие даёт 403, а не 401 (Ловушка 1).
  const credential = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useQuery<MyPermissionsResponse, ApiFailure>({
    queryKey: ['me'],
    queryFn: () =>
      apiClient.get<MyPermissionsResponse>('/api/operations/my-permissions/'),
    enabled: credential !== null,
  })
}

export interface UsePermissionsResult {
  /** undefined, пока ['me'] не загружен (или запрос выключен без credential). */
  permissions: ReadonlySet<string> | undefined
  hasPermission(code: string): boolean
  isLoading: boolean
  error: ApiFailure | null
}

export function usePermissions(): UsePermissionsResult {
  const query = useMe()

  const permissions = useMemo<ReadonlySet<string> | undefined>(
    () => (query.data === undefined ? undefined : new Set(query.data.permissions)),
    [query.data],
  )

  // wildcard `*` = ADMIN (seed); иерархий/префиксов НЕТ — плоский список (Д9)
  const hasPermission = useCallback(
    (code: string): boolean =>
      permissions !== undefined &&
      (permissions.has('*') || permissions.has(code)),
    [permissions],
  )

  return {
    permissions,
    hasPermission,
    isLoading: query.isLoading,
    error: query.error,
  }
}
