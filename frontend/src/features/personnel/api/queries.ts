// Query hooks (§7.10, §5.4): apiClient — единственная точка транспорта.
// Все 4 справочника малы (demo/donor масштаб) — читаются одной страницей,
// без пролистывания (как существующий `divisionsQuery` в daily-grid).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import type { paths } from '../../../shared/api/schema'
import {
  PERSONNEL_DIRECTORY_PATH,
  personnelDisclosePath,
  personnelDisclosureLogPath,
  personnelEntryPath,
} from './pending-contracts'
import type {
  DiscloseIdentityRequest,
  DiscloseIdentityResponse,
  ListIdentityDisclosuresResponse,
  ListPersonnelResponse,
  PersonnelEntryResponse,
} from './pending-contracts'

type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']
type PositionsResponse =
  paths['/api/core/positions/']['get']['responses']['200']['content']['application/json']
type RanksResponse =
  paths['/api/core/ranks/']['get']['responses']['200']['content']['application/json']

/**
 * §20.29 «безопасная проекция»: экраны Smart Josparlau читают СВОЙ ресурс, а
 * не донорский `/api/core/employees/`. Разница не косметическая — донорский
 * список несёт полный `iin`, и, читая его, страница получала бы чувствительное
 * значение в query cache независимо от прав смотрящего. Донорские хуки для
 * сотрудников намеренно не заведены: наличие такого хука рано или поздно
 * привело бы к его использованию.
 */
export function usePersonnelDirectory() {
  return useQuery<ListPersonnelResponse, ApiFailure>({
    queryKey: ['personnel', 'directory'],
    queryFn: () => apiClient.get<ListPersonnelResponse>(PERSONNEL_DIRECTORY_PATH),
  })
}

export function usePersonnelEntry(id: string) {
  return useQuery<PersonnelEntryResponse, ApiFailure>({
    queryKey: ['personnel', 'directory', id],
    queryFn: () => apiClient.get<PersonnelEntryResponse>(personnelEntryPath(id)),
    enabled: id !== '',
  })
}

/**
 * §20.33 «журнал раскрытий». Отдельный запрос, а не поле карточки: журнал
 * читается по своему праву (`personnel.identity.audit`), и вкладывать его в
 * ответ карточки значило бы отдавать его всем, кто видит карточку.
 */
export function useIdentityDisclosures(id: string, options: { enabled?: boolean } = {}) {
  return useQuery<ListIdentityDisclosuresResponse, ApiFailure>({
    queryKey: ['personnel', 'disclosures', id],
    queryFn: () => apiClient.get<ListIdentityDisclosuresResponse>(personnelDisclosureLogPath(id)),
    enabled: (options.enabled ?? true) && id !== '',
  })
}

/**
 * §20.27 раскрытие ИИН. Намеренно МУТАЦИЯ, а не query: результат содержит
 * чувствительное значение, и query-кэш хранил бы его дольше, чем действует
 * полномочие, отдавая его любому следующему монтированию компонента. У
 * мутации данные живут ровно до `reset()` — им и распоряжается экран, когда
 * срок раскрытия истёк.
 */
export function useDiscloseIdentity(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<DiscloseIdentityResponse, DiscloseIdentityRequest>({
    mutationFn: (body) => apiClient.post<DiscloseIdentityResponse>(personnelDisclosePath(id), body),
    onSuccess: () => {
      // Собственное обращение обязано появиться в журнале сразу: журнал —
      // главное, что делает раскрытие подотчётным, и «увижу после
      // перезагрузки» этой подотчётности не даёт.
      void queryClient.invalidateQueries({ queryKey: ['personnel', 'disclosures', id] })
    },
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
