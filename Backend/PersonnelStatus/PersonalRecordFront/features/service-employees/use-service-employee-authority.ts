'use client';

import { useAuth } from '@/lib/auth';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';

export function useServiceEmployeeAuthority() {
  const { user, isLoading: identityLoading, sessionExpired } = useAuth();
  const access = useOpsPermissions();
  const ready = !identityLoading && !sessionExpired && user !== null && !access.isLoading && access.permissions !== undefined && !access.error;
  const key = JSON.stringify({
    actor: user?.id,
    directoryAccess: access.serviceEmployeesAccess,
    permissions: Array.from(access.permissions ?? []).sort(),
    globalPermissions: Array.from(access.globalPermissions ?? []).sort(),
    scopes: access.roles.map(role => [role.code, role.scope_division_id]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
  return { ...access, key, ready, isLoading: identityLoading || access.isLoading };
}
