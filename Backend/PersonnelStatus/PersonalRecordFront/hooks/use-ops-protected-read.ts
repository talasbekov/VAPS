"use client";

import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { OpsApiError, type OpsApiFailure } from "@/lib/ops-errors";
import { blockReadAccess, isReadAccessBlocked, readWithAccessCheck } from "@/lib/query-read-access";
import { currentOpsAuthorityStamp, isOpsAuthorityCurrent } from "@/lib/ops-write-authority";

export interface OpsReadAccess {
  actor: string;
  scope: string;
  allowed: boolean;
}

export function useOpsReadAccess(permission: string): OpsReadAccess {
  const access = useOpsPermissions();
  const client = useQueryClient();
  const { data: session } = useSession();
  const actor = (session?.user as { id?: string } | undefined)?.id ?? session?.user?.email ?? "";
  const scope = currentOpsAuthorityStamp(client, actor);
  return { actor, scope: scope ?? JSON.stringify([actor, "unavailable"]),
    allowed: scope !== null && !access.isLoading && !access.error && access.hasPermission(permission) };
}

export function hasCurrentOpsReadAuthority(client: QueryClient, access: OpsReadAccess): boolean {
  return access.allowed && isOpsAuthorityCurrent(access.scope) && currentOpsAuthorityStamp(client, access.actor) === access.scope;
}

export function hasOpsReadAuthority(client: QueryClient, access: OpsReadAccess, group: string, source?: QueryKey, allowRefreshing = false): boolean {
  if (!hasCurrentOpsReadAuthority(client, access)) return false;
  if (source) {
    const state = client.getQueryState(source);
    return source[0] === group && source[2] === access.scope && state?.status === "success" &&
      (allowRefreshing || state.fetchStatus === "idle") && state.data !== undefined && !isReadAccessBlocked(client, source);
  }
  return !client.getQueryCache().findAll({ predicate: query => query.queryKey[0] === group && query.queryKey[2] === access.scope })
    .some(query => query.state.status === "error" || isReadAccessBlocked(client, query.queryKey));
}

export function assertOpsReadAuthority(client: QueryClient, access: OpsReadAccess, group: string, source?: QueryKey): void {
  if (!hasOpsReadAuthority(client, access, group, source)) throw new OpsApiError({ status: 403,
    errorCode: "READ_AUTHORITY_UNAVAILABLE", message: "Действие недоступно до успешного обновления данных и прав доступа.", details: {}, requestId: null });
}

export function useOpsProtectedRead<T>(
  prefix: readonly [string, string], parts: readonly unknown[], access: OpsReadAccess,
  read: () => Promise<T>,
  options: { enabled?: boolean; staleTime?: number; poll?: (data: T | undefined) => number | false } = {},
) {
  const client = useQueryClient();
  const key = [...prefix, access.scope, ...parts];
  const enabled = access.allowed && options.enabled !== false;
  const query = useQuery<T, OpsApiFailure>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!enabled || currentOpsAuthorityStamp(client, access.actor) !== access.scope) {
        throw new OpsApiError({ status: 403, errorCode: "PERMISSION_AUTHORITY_UNAVAILABLE",
          message: "Дождитесь успешной проверки прав доступа.", details: {}, requestId: null });
      }
      try { return await readWithAccessCheck(client, key, signal, read); }
      catch (error) {
        const status = (error as { status?: number } | null)?.status;
        if (!signal.aborted && (status === 401 || status === 403 || status === 404)) {
          // Retain Query identity and its denial marker while removing the
          // protected payload from every cached filter in this actor scope.
          for (const cached of client.getQueryCache().findAll({ predicate: item => item.queryKey[0] === prefix[0] && item.queryKey[2] === access.scope })) {
            blockReadAccess(client, cached.queryKey, true);
          }
        }
        throw error;
      }
    },
    enabled,
    staleTime: options.staleTime ?? 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: current => !enabled || current.state.status === "error" || isReadAccessBlocked(client, key)
      ? false : options.poll?.(current.state.data) ?? false,
  });
  const blocked = isReadAccessBlocked(client, key);
  return { ...query, data: enabled && !blocked ? query.data : undefined, readAccessBlocked: blocked, readKey: key,
    canAct: enabled && !blocked && query.isSuccess && !query.isFetching };
}
