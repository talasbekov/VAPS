'use client';

import { useSession } from 'next-auth/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import type { DutyRosterSnapshot } from '@/features/duty-register/model/roster';
import { DUTY_REGISTER_PATH, dutyRecordPath, type DutyKind, type DutyRecord, type DutyRegisterSnapshot, type DutyEmployeeChoice } from '@/entities/duty-register';
import { opsApiClient } from '@/lib/ops-api';
import { OpsApiError, type OpsApiFailure } from '@/lib/ops-errors';
import { isReadAccessBlocked, readWithAccessCheck } from '@/lib/query-read-access';

export const DUTY_REGISTER_KEY = ['duty-register'] as const;
export function useDutyRegisterAccess() {
  const access = useOpsPermissions();
  const { data: session } = useSession();
  const actor = (session?.user as { id?: string } | undefined)?.id ?? session?.user?.email ?? '';
  const scope = JSON.stringify([actor, [...(access.permissions ?? [])].sort(), [...(access.globalPermissions ?? [])].sort(),
    access.roles.map(role => [role.code, role.scope_division_id]).sort(), access.statusManageDivisionIds, access.dutyRegisterScope]);
  // Configuration-only administrators cannot read personnel or journal records.
  const allowed = !access.isLoading && !access.error && ['duty.view', 'analytics.view', 'duty.manage', 'status.manage', 'duty.dispatch'].some(access.hasPermission);
  return { ...access, actor, scope, allowed, canCreate: allowed && (access.hasPermission('duty.manage') || access.hasPermission('status.manage')) };
}

function useRegisterRead<T>(parts: readonly unknown[], endpoint: string, enabled: boolean, scope: string) {
  const client = useQueryClient();
  const key = [...DUTY_REGISTER_KEY, scope, ...parts];
  const query = useQuery<T, OpsApiFailure>({ queryKey: key, queryFn: async ({ signal }) => {
    try { return await readWithAccessCheck(client, key, signal, () => opsApiClient.get<T>(endpoint)); }
    catch (failure) {
      if (!signal.aborted && parts[0] === 'record' && failure instanceof OpsApiError && [401, 403, 404].includes(failure.status)) {
        // A moved/deleted record must not remain visible behind its denied dialog.
        void client.resetQueries({ queryKey: [...DUTY_REGISTER_KEY, scope, 'list'] }).catch(() => undefined);
      }
      throw failure;
    }
  },
    enabled, staleTime: 0, retry: false, refetchOnWindowFocus: true });
  const blocked = isReadAccessBlocked(client, key);
  return { ...query, visibleData: enabled && !blocked ? query.data : undefined, blocked };
}

export function useDutyRegister(query: string, enabled: boolean, scope: string) {
  return useRegisterRead<DutyRegisterSnapshot>(['list', query], DUTY_REGISTER_PATH + (query ? '?' + query : ''), enabled, scope);
}
export function useDutyRoster(day: string, enabled: boolean, scope: string) {
  return useRegisterRead<DutyRosterSnapshot>(['roster', day], DUTY_REGISTER_PATH + 'roster/' + (day ? '?' + new URLSearchParams({ business_date: day }) : ''), enabled, scope);
}
export function useDutyRecord(id: string, enabled: boolean, scope: string) {
  const valid = /^(LOG|PLAN|DISPATCH):[1-9]\d{0,18}$/.test(id);
  return useRegisterRead<DutyRecord>(['record', id], valid ? dutyRecordPath(id) : DUTY_REGISTER_PATH, enabled && valid, scope);
}
export function useDutyKinds(enabled: boolean, scope: string) {
  return useRegisterRead<{ results: DutyKind[] }>(['kinds'], DUTY_REGISTER_PATH + 'kinds/', enabled, scope);
}
export function useDutyEmployeeChoices(search: string, page: number, enabled: boolean, scope: string) {
  const params = new URLSearchParams({ search, page: String(page), page_size: '25' });
  return useRegisterRead<{ results: DutyEmployeeChoice[]; count: number; page: number; page_size: number }>(['choices', search, page], DUTY_REGISTER_PATH + 'choices/?' + params, enabled, scope);
}
export function useInvalidateDutyRegister() {
  const client = useQueryClient();
  return async () => { await Promise.all([
    client.invalidateQueries({ queryKey: DUTY_REGISTER_KEY }), client.invalidateQueries({ queryKey: ['duty-dispatch'] }),
    client.invalidateQueries({ queryKey: ['service-combat-duty'] }), client.invalidateQueries({ queryKey: ['ops-duty-shifts'] }),
    client.invalidateQueries({ queryKey: ['ops-duty-plan'] }), client.invalidateQueries({ queryKey: ['status-duty-assignments'] }),
  ]); };
}
