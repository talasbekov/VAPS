import type { QueryClient } from "@tanstack/react-query";
import type { OpsMyPermissionsResponse } from "@/hooks/use-ops-permissions";
import { OpsServerError } from "@/lib/ops-errors";

type AuthorityReader = () => string | null;
let authorityReader: AuthorityReader | undefined;

export function isOpsAuthorityCurrent(scope: string): boolean {
  return authorityReader === undefined || authorityReader() === scope;
}

/** The provider owns the live session; transports never retain its grants. */
export function registerOpsWriteAuthority(reader: AuthorityReader): () => void {
  authorityReader = reader;
  return () => {
    if (authorityReader === reader) authorityReader = () => null;
  };
}

export function currentOpsAuthorityStamp(client: QueryClient, actor: string | null): string | null {
  const state = client.getQueryState<OpsMyPermissionsResponse>(["ops-me"]);
  if (!actor || state?.status !== "success" || !state.data || !Array.isArray(state.data.permissions)) return null;
  const data = state.data;
  const scopes = data.duty_register_scope;
  return JSON.stringify([actor, [...data.permissions].sort(), data.global_permissions?.slice().sort(),
    data.roles?.map(role => [role.code, role.scope_division_id]).sort(),
    data.status_manage_division_ids?.slice().sort((a, b) => a - b) ?? data.status_manage_division_ids,
    scopes && Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b)).map(([kind, ids]) => [kind, ids?.slice().sort() ?? null])]);
}

function unavailable(): never {
  throw new OpsServerError({ status: 503, errorCode: "PERMISSION_AUTHORITY_UNAVAILABLE",
    message: "Изменения недоступны до успешной проверки прав доступа.", details: {}, requestId: null });
}

/** Check both before asynchronous token lookup and immediately before fetch. */
export function captureOpsWriteAuthority(endpoint: string, method = "GET"): () => void {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) ||
      /^\/(?:api\/auth\/|api\/token\/)/.test(endpoint) || authorityReader === undefined) return () => {};
  const reader = authorityReader;
  const captured = reader();
  if (captured === null) unavailable();
  return () => {
    if (authorityReader !== reader || reader() !== captured) unavailable();
  };
}
