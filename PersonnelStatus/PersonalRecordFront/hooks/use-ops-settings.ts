"use client";

// Настройки политик: список с серверными action, правка с причиной, журнал.
// Правка политики меняет исход операций на других экранах (дежурства,
// объекты) — инвалидируются и их ключи.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  settingPath,
  SETTINGS_PATH,
  SETTING_CHANGES_PATH,
} from "@/entities/policy-setting";
import type {
  ListSettingChangeLogResponse,
  ListSettingsResponse,
  UpdateSettingRequest,
  UpdateSettingResponse,
} from "@/entities/policy-setting";

export function useOpsSettings() {
  return useQuery<ListSettingsResponse, OpsApiFailure>({
    queryKey: ["ops-settings"],
    queryFn: () => opsApiClient.get<ListSettingsResponse>(SETTINGS_PATH),
  });
}

export function useSettingChangeLog() {
  return useQuery<ListSettingChangeLogResponse, OpsApiFailure>({
    queryKey: ["ops-setting-changes"],
    queryFn: () =>
      opsApiClient.get<ListSettingChangeLogResponse>(SETTING_CHANGES_PATH),
  });
}

export function useUpdateSetting(
  settingCode: string,
  options?: { onFormError?: (details: Record<string, unknown>) => void }
) {
  const queryClient = useQueryClient();
  return useOpsMutation<UpdateSettingResponse, UpdateSettingRequest>({
    mutationFn: (body) =>
      opsApiClient.patch<UpdateSettingResponse>(settingPath(settingCode), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-setting-changes"] });
      // потребители политики обязаны перечитать её
      void queryClient.invalidateQueries({ queryKey: ["ops-duty-plan"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-duty-types"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-objects"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-audit-logs"] });
    },
    onFormError: options?.onFormError,
  });
}
