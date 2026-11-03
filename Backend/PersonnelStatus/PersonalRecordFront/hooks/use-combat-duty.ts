'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDutyRegisterAccess } from '@/hooks/use-duty-register';
import { opsApiClient } from '@/lib/ops-api';
import { isReadAccessBlocked, readWithAccessCheck } from '@/lib/query-read-access';
import type { OpsApiFailure } from '@/lib/ops-errors';

export function useCombatRead<T>(path: string, enabled = true, personal = false) {
  const access = useDutyRegisterAccess();
  const client = useQueryClient();
  const key = ['combat-duty', access.scope, path];
  const allowed = enabled && access.permissions !== undefined && !access.isLoading && !access.error && (personal || ['duty.view', 'duty.manage', 'duty.combat.manage', 'duty.roster', 'duty.catalog.manage'].some(access.hasPermission));
  const query = useQuery<T, OpsApiFailure>({ queryKey: key, enabled: allowed, retry: false, refetchOnWindowFocus: true,
    queryFn: ({ signal }) => readWithAccessCheck(client, key, signal, () => opsApiClient.get<T>(path)) });
  return { ...query, data: allowed && !query.isError && !isReadAccessBlocked(client, key) ? query.data : undefined, access };
}

export function useCombatRefresh() {
  const client = useQueryClient();
  return async () => {
    await Promise.all(['combat-duty', 'duty-register', 'ops-statuses', 'strength-report', 'daily-expense-board', 'service-summary', 'status-calendar-month', 'status-calendar-day', 'service-combat-duty', 'duty-dispatch', 'ops-duty-shifts', 'ops-duty-plan', 'status-duty-assignments', 'ops-profile-next', 'my-assignments'].map(key => client.invalidateQueries({ queryKey: [key] })));
  };
}
