"use client";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import { opsApiClient } from "@/lib/ops-api";
import { Button } from "@/components/ui/button";
import { formatIsoDateTime } from "@/shared/lib/date";

type Snapshot = {
  isActive: boolean; checkedAt: string; permissions: string[]; globalPermissions: string[]; scopeNotice: string;
  grants: {roleCode: string; roleName: string; scopeDivisionId: number | null; scopeName: string;
    sources: string[]; temporaryEndsAt: string[]; permissions: {code: string; name: string}[]}[];
};
const SOURCES: Record<string, string> = {permanent:"Постоянная роль", temporary:"Временные полномочия", derived:"Дополнительные права по правилам роли"};
export function AccountEffectiveAccess({userId}: {userId:number}) {
  const authority = useOpsReadAccess("admin.roles");
  const access = useOpsPermissions();
  const allowed = authority.allowed && access.hasGlobalPermission("admin.roles");
  const query = useOpsProtectedRead<Snapshot>(["ops-account-effective-access","detail"], [userId], {...authority, allowed},
    () => opsApiClient.get<Snapshot>(`/api/operations/accounts/${userId}/effective-access/`));
  if (!allowed) return null;
  const data = !query.isError && !query.isFetching ? query.data : undefined;
  return <details className="rounded-lg border p-3">
    <summary className="cursor-pointer text-sm font-semibold">Что доступно пользователю</summary>
    <div className="mt-3 space-y-3 text-sm">
      {query.isFetching && <p role="status">Проверяем действующие права…</p>}
      {query.isError && <p role="alert">Не удалось проверить права. Прежние результаты скрыты.</p>}
      <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Проверить права</Button>
      {data && <>
        <p className="text-xs text-muted-foreground">Проверено: {formatIsoDateTime(data.checkedAt)}</p>
        {!data.isActive ? <p className="font-medium">Учётная запись заблокирована. Назначенные роли не дают возможности войти.</p>
          : data.permissions.length === 0 ? <p>Действующих разрешений нет.</p>
          : <p>{data.globalPermissions.includes("*") ? "Полный доступ ко всей службе." : `Действующих разрешений: ${data.permissions.length}. Без ограничения подразделением: ${data.globalPermissions.length}.`}</p>}
        {data.grants.map(grant => <section key={`${grant.roleCode}:${grant.scopeDivisionId ?? "all"}`} className="space-y-1 border-t pt-3">
          <h4 className="font-medium">{grant.roleName}</h4><p>{grant.scopeName}</p>
          <p className="text-xs text-muted-foreground">{grant.sources.map(source => SOURCES[source] ?? source).join(" · ")}</p>
          {grant.temporaryEndsAt.length > 0 && <p className="text-xs">Окончание временных назначений: {grant.temporaryEndsAt.map(value => formatIsoDateTime(value)).join("; ")}</p>}
          <details><summary className="cursor-pointer py-1">Разрешения · {grant.permissions.length}</summary>
            <ul className="mt-1 space-y-1">{grant.permissions.map(permission => <li key={permission.code}>{permission.name} <span className="break-all text-xs text-muted-foreground">({permission.code})</span></li>)}</ul>
          </details>
        </section>)}
        <p className="text-xs text-muted-foreground">{data.scopeNotice}</p>
      </>}
    </div>
  </details>;
}

