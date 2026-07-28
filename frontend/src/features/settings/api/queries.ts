// Query/mutation hooks (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import { SETTINGS_PATH, SETTING_CHANGES_PATH, settingPath } from './pending-contracts'
import type {
  ListSettingChangeLogResponse,
  ListSettingsResponse,
  UpdateSettingRequest,
  UpdateSettingResponse,
} from './pending-contracts'

export function useSettings() {
  return useQuery<ListSettingsResponse, ApiFailure>({
    queryKey: ['settings', 'list'],
    queryFn: () => apiClient.get<ListSettingsResponse>(SETTINGS_PATH),
  })
}

export function useSettingChangeLog() {
  return useQuery<ListSettingChangeLogResponse, ApiFailure>({
    queryKey: ['settings', 'change-log'],
    queryFn: () => apiClient.get<ListSettingChangeLogResponse>(SETTING_CHANGES_PATH),
  })
}

export function useUpdateSetting() {
  const queryClient = useQueryClient()
  return useApiMutation<
    UpdateSettingResponse,
    UpdateSettingRequest & { settingCode: string }
  >({
    mutationFn: ({ settingCode, ...body }) =>
      apiClient.patch<UpdateSettingResponse>(settingPath(settingCode), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      // Снимок аналитики §22.11 считается по ЭТОЙ политике: после смены
      // порога прежний снимок описывает уже не действующую методику.
      void queryClient.invalidateQueries({ queryKey: ['service-analytics'] })
    },
  })
}
