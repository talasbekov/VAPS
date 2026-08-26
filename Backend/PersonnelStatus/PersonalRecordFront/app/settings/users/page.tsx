"use client";

// Экран «Пользователи» раздела настроек (Plane №36, шаг «П-8»).
//
// Слева реестр учёток с СЕРВЕРНЫМ поиском (логин, имя, фамилия, почта),
// справа карточка человека с его РОЛЯМИ И ОБЛАСТЯМИ: выдача роли с областью
// и снятие. Область — подразделение или «вся служба»; без области роль
// действует везде, и это надо видеть словами, а не по пустому полю.
//
// Заведение учётки, блокировка и сброс пароля — шаг «П-9»; здесь только
// чтение учёток и раздача ролей.
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadFailure } from "@/components/load-failure";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { useDivisionsTree } from "@/hooks/use-divisions-tree";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  useAccessAccounts,
  useAccessRoles,
  useAccessUserRoles,
  useAssignAccessRole,
  useRevokeAccessRole,
} from "@/hooks/use-access-permissions";
import { WHOLE_SERVICE_SCOPE_LABEL } from "@/entities/access";
import type { AccessAccount, AccessUserRole } from "@/entities/access";
import type { Division } from "@/lib/api";
import { OpsApiError } from "@/lib/ops-errors";

const ACCESS_ADMIN_PERMISSION = "admin.roles";
/** Значение «без области» в выпадающем списке: пустая строка неотличима от
 * «ничего не выбрано», а область должна выбираться осознанно. */
const WHOLE_SERVICE_VALUE = "WHOLE_SERVICE";

export default function AccessUsersPage() {
  // useSearchParams требует границы Suspense — иначе пререндер падает на сборке.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AccessUsersScreen />
    </Suspense>
  );
}

function AccessUsersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const search = searchParams.get("search") ?? "";
  const selectedId = searchParams.get("user");
  const canManage = hasPermission(ACCESS_ADMIN_PERMISSION);

  const accountsQuery = useAccessAccounts(search);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, {
      scroll: false,
    });
  }

  const [searchDraft, setSearchDraft] = useDebouncedCommit(search, (value) =>
    updateParam("search", value)
  );

  if (!permissionsLoading && !canManage) {
    return <OpsAccessDenied what="учётных записей" />;
  }

  const accounts = accountsQuery.data?.results ?? [];
  const selected =
    accounts.find((account) => String(account.id) === selectedId) ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Настройки"
          title="Пользователи"
          description="Учётные записи и их роли. Роль выдаётся с областью: подразделением или всей службой."
        />

        <Input
          className="h-[38px] max-w-[420px] text-[13px]"
          placeholder="Поиск по логину, имени, фамилии или почте…"
          aria-label="Поиск по учётным записям"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[14px]">
                Учётные записи
                {accountsQuery.data !== undefined && (
                  <span className="ml-2 text-[12px] font-normal text-muted-foreground tabular-nums">
                    {accountsQuery.data.count}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {accountsQuery.isLoading ? (
                <p className="p-9 text-center text-sm text-muted-foreground">
                  Загрузка учётных записей…
                </p>
              ) : accountsQuery.isError ? (
                <LoadFailure
                  what="список учётных записей"
                  className="p-6"
                  onRetry={() => void accountsQuery.refetch()}
                  isRetrying={accountsQuery.isFetching}
                />
              ) : accounts.length === 0 ? (
                <EmptyRegistry
                  search={search}
                  onClear={() => {
                    setSearchDraft("");
                    updateParam("search", "");
                  }}
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[32%]">Логин</TableHead>
                        <TableHead>Человек</TableHead>
                        <TableHead className="w-[130px]">Состояние</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((account) => (
                        <AccountRow
                          key={account.id}
                          account={account}
                          isSelected={String(account.id) === selectedId}
                          onSelect={() =>
                            updateParam("user", String(account.id))
                          }
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {selected === null ? (
            <Card>
              <CardContent className="p-9 text-center text-[13px] text-muted-foreground">
                Выберите человека слева, чтобы увидеть и раздать его роли.
              </CardContent>
            </Card>
          ) : (
            // key по учётке: карточка держит своё состояние (выбранная роль и
            // область, открытое подтверждение), и оно обязано сброситься при
            // переходе на другого человека.
            <AccountDetails key={selected.id} account={selected} />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function EmptyRegistry({
  search,
  onClear,
}: {
  search: string;
  onClear: () => void;
}) {
  if (search.trim() !== "") {
    return (
      <div className="p-9 text-center">
        <p className="text-[13px] text-muted-foreground">
          По запросу «{search}» ничего не найдено.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 h-8"
          onClick={onClear}
        >
          Очистить поиск
        </Button>
      </div>
    );
  }
  return (
    <p className="p-9 text-center text-[13px] text-muted-foreground">
      Учётных записей нет.
    </p>
  );
}

function AccountRow({
  account,
  isSelected,
  onSelect,
}: {
  account: AccessAccount;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <TableRow className={isSelected ? "bg-muted/60" : undefined}>
      <TableCell className="font-mono text-[12.5px]">
        <button
          type="button"
          className="text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-pressed={isSelected}
          onClick={onSelect}
        >
          {account.username}
        </button>
      </TableCell>
      <TableCell className="text-[13px]">
        {account.full_name ?? (
          <span className="text-muted-foreground">имя не заполнено</span>
        )}
      </TableCell>
      <TableCell>
        <span
          className={
            account.is_active
              ? "inline-flex whitespace-nowrap rounded-full bg-green-100 px-[9px] py-0.5 text-[10.5px] font-bold text-green-800 dark:bg-green-900/40 dark:text-green-200"
              : "inline-flex whitespace-nowrap rounded-full bg-slate-200 px-[9px] py-0.5 text-[10.5px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
          }
        >
          {account.is_active ? "Входит" : "Заблокирован"}
        </span>
      </TableCell>
    </TableRow>
  );
}

/** Дерево подразделений — плоским списком с отступом: область выбирается из
 * одного списка, а иерархию видно по вложенности подписи. */
function flattenDivisions(
  root: Division | undefined,
  depth = 0
): Array<{ id: number; label: string }> {
  if (root === undefined) return [];
  const self = [{ id: root.id, label: `${"— ".repeat(depth)}${root.name}` }];
  return self.concat(
    (root.children ?? []).flatMap((child) => flattenDivisions(child, depth + 1))
  );
}

function AccountDetails({ account }: { account: AccessAccount }) {
  const userRolesQuery = useAccessUserRoles(account.id);
  const rolesQuery = useAccessRoles("");
  const divisionsQuery = useDivisionsTree();
  const assign = useAssignAccessRole();
  const revoke = useRevokeAccessRole();

  const [roleCode, setRoleCode] = useState("");
  const [scope, setScope] = useState<string>(WHOLE_SERVICE_VALUE);
  const [pendingRevocation, setPendingRevocation] =
    useState<AccessUserRole | null>(null);

  const divisions = flattenDivisions(divisionsQuery.data);
  // Показываются ДЕЙСТВУЮЩИЕ назначения: снятие оставляет строку в базе
  // (история выдач), но в списке ролей человека ей не место — там отвечают на
  // вопрос «что у него есть сейчас».
  const granted = (userRolesQuery.data?.results ?? []).filter(
    (row) => row.is_active
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px]">
          {account.full_name ?? account.username}
        </CardTitle>
        <p className="font-mono text-[12px] text-muted-foreground">
          {account.username}
          {account.email !== "" && ` · ${account.email}`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-t pt-3">
          <h3 className="mb-2 text-[13px] font-semibold">
            Роли
            <span className="ml-2 text-[12px] font-normal text-muted-foreground tabular-nums">
              {granted.length}
            </span>
          </h3>
          {userRolesQuery.isLoading ? (
            <p className="text-[12.5px] text-muted-foreground">
              Загрузка ролей человека…
            </p>
          ) : userRolesQuery.isError ? (
            <LoadFailure
              what="роли человека"
              onRetry={() => void userRolesQuery.refetch()}
            />
          ) : granted.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              Ролей нет: человек входит в систему, но не открывает ничего.
            </p>
          ) : (
            <ul aria-label="Роли человека" className="space-y-1.5">
              {granted.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-[8px] border px-2.5 py-1.5"
                >
                  <span className="flex flex-col">
                    <span className="font-mono text-[11.5px]">
                      {row.role_code}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {row.role_name ?? ""} ·{" "}
                      {row.scope_division_name ?? WHOLE_SERVICE_SCOPE_LABEL}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11.5px]"
                    disabled={revoke.isPending}
                    onClick={() => setPendingRevocation(row)}
                  >
                    Снять
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {revoke.error !== null && (
            <p className="mt-2 text-[12px] text-destructive">
              {revokeFailureMessage(revoke.error)}
            </p>
          )}
        </div>

        <div className="border-t pt-3">
          <h3 className="mb-2 text-[13px] font-semibold">Выдать роль</h3>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="assign-role">Роль</Label>
              <select
                id="assign-role"
                className="h-[34px] w-full rounded-md border bg-background px-2 text-[12.5px]"
                value={roleCode}
                onChange={(event) => setRoleCode(event.target.value)}
              >
                <option value="">— выберите роль —</option>
                {(rolesQuery.data?.results ?? []).map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.code} · {role.name}
                    {role.is_active ? "" : " (отключена)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="assign-scope">Область</Label>
              <select
                id="assign-scope"
                className="h-[34px] w-full rounded-md border bg-background px-2 text-[12.5px]"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value={WHOLE_SERVICE_VALUE}>
                  {WHOLE_SERVICE_SCOPE_LABEL}
                </option>
                {divisions.map((division) => (
                  <option key={division.id} value={String(division.id)}>
                    {division.label}
                  </option>
                ))}
              </select>
              <p className="text-[11.5px] text-muted-foreground">
                Одна роль в разных областях — это разные назначения: они живут
                рядом и снимаются порознь.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={assign.isPending || roleCode === ""}
              onClick={() =>
                assign.mutate({
                  user_id: String(account.id),
                  role_code: roleCode,
                  scope_division_id:
                    scope === WHOLE_SERVICE_VALUE ? null : Number(scope),
                })
              }
            >
              Выдать
            </Button>
            {assign.error !== null && (
              <p className="text-[12px] text-destructive">
                Не удалось выдать роль. Попробуйте ещё раз.
              </p>
            )}
          </div>
        </div>
      </CardContent>

      <ConfirmRevocationDialog
        row={pendingRevocation}
        isPending={revoke.isPending}
        onCancel={() => setPendingRevocation(null)}
        onConfirm={() => {
          if (pendingRevocation === null) return;
          revoke.mutate({ id: pendingRevocation.id });
          setPendingRevocation(null);
        }}
      />
    </Card>
  );
}

/** Отказ снятия — не всегда сбой: у последней административной роли своя
 * причина, и общий текст «попробуйте ещё раз» звал бы повторять то, что
 * сервер не разрешит никогда. */
function revokeFailureMessage(error: unknown): string {
  if (
    error instanceof OpsApiError &&
    error.errorCode === "LAST_ACCESS_ADMIN_ROLE"
  ) {
    return "Нельзя снять с себя последнюю роль, дающую управление доступом: раздел остался бы без администратора.";
  }
  return "Не удалось снять роль. Попробуйте ещё раз.";
}

function ConfirmRevocationDialog({
  row,
  isPending,
  onCancel,
  onConfirm,
}: {
  row: AccessUserRole | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Снять роль?</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] leading-[1.55]">
          Роль <span className="font-mono">{row?.role_code}</span> в области «
          {row?.scope_division_name ?? WHOLE_SERVICE_SCOPE_LABEL}» перестанет
          действовать у пользователя{" "}
          <span className="font-mono">{row?.user_login ?? row?.user_id}</span>.
          Запись о выдаче останется в истории.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            Снять
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
