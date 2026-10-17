"use client";

// Экран «Пользователи» раздела настроек (Plane №36, шаг «П-8»).
//
// Слева реестр учёток с СЕРВЕРНЫМ поиском (логин, имя, фамилия, почта),
// справа карточка человека с его РОЛЯМИ И ОБЛАСТЯМИ: выдача роли с областью
// и снятие. Область — подразделение или «вся служба»; без области роль
// действует везде, и это надо видеть словами, а не по пустому полю.
//
// Заведение учётки, блокировка и сброс пароля — шаг «П-9». Временный пароль
// приходит с сервера ОДИН раз (хранится только хеш), поэтому показывается
// отдельным окном, которое нельзя закрыть случайным кликом мимо, и с явным
// предупреждением, что повтора не будет — только новый сброс.
import { Suspense, useEffect, useRef, useState } from "react";
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
import { MODULE_PERMISSION } from "@/entities/portal-access";
import {
  useAccessAccounts,
  useAccessAccount,
  useAccessRoleOptions,
  useAccessUserRoles,
  useAssignAccessRole,
  useCreateAccessAccount,
  useResetAccessAccountPassword,
  useRevokeAccessRole,
  useSetAccessAccountActive,
} from "@/hooks/use-access-permissions";
import { WHOLE_SERVICE_SCOPE_LABEL, accessScopeLabel } from "@/entities/access";
import type { AccessAccount, AccessUserRole } from "@/entities/access";
import type { Division } from "@/lib/api";
import { formatIsoDateTime } from "@/shared/lib/date";
import { OpsApiError } from "@/lib/ops-errors";
import { AccountEmployeeLink } from "./account-employee-link";

// Право берётся из ОБЩЕЙ карты (Plane №350): пункт меню и гейт этого
// экрана обязаны решать одно и то же, иначе спрятанный пункт и открытый
// экран разойдутся молча.
const ACCESS_ADMIN_PERMISSION = MODULE_PERMISSION["/settings/users"];
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
  const { hasGlobalPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const search = searchParams.get("search") ?? "";
  const selectedId = searchParams.get("user");
  const canManage = hasGlobalPermission(ACCESS_ADMIN_PERMISSION);

  const offsetParam = Number(searchParams.get("offset") ?? 0);
  const offset = Number.isSafeInteger(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
  const accountsQuery = useAccessAccounts(search, { enabled: canManage, offset });
  const selectedNumber = selectedId !== null && /^\d+$/.test(selectedId) && Number.isSafeInteger(Number(selectedId)) && Number(selectedId) > 0 ? Number(selectedId) : null;
  const selectedQuery = useAccessAccount(selectedNumber, { enabled: canManage });

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (key === "search") next.delete("offset");
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
  const [isCreating, setCreating] = useState(false);
  // Одноразовый секрет живёт на уровне экрана, а не карточки: его рождают два
  // разных действия (заведение и сброс), и он обязан пережить закрытие окна,
  // из которого пришёл.
  const [secret, setSecret] = useState<{
    login: string;
    password: string;
    reason: "created" | "reset";
  } | null>(null);

  if (permissionsLoading) {
    return <DashboardLayout><p role="status">Загрузка прав доступа…</p></DashboardLayout>;
  }
  if (!canManage) {
    return <OpsAccessDenied what="учётных записей" />;
  }

  const accounts = accountsQuery.data?.results ?? [];
  const selected = !selectedQuery.isError && selectedQuery.data?.id === selectedNumber ? selectedQuery.data : null;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Настройки"
          title="Пользователи"
          description="Учётные записи и их роли. Роль выдаётся с областью: подразделением или всей службой."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-[38px] max-w-[420px] text-[13px]"
            placeholder="Поиск по логину, имени, фамилии или почте…"
            aria-label="Поиск по учётным записям"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <Button
            type="button"
            className="h-[38px]"
            onClick={() => setCreating(true)}
          >
            Завести учётку
          </Button>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card className="min-w-0">
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
              {accountsQuery.data && !accountsQuery.isError && accountsQuery.data.count > 50 && (
                <nav aria-label="Страницы учётных записей" className="flex flex-wrap items-center gap-2 border-t p-3">
                  <Button variant="outline" size="sm" disabled={offset === 0 || accountsQuery.isFetching} onClick={() => updateParam("offset", String(Math.max(0, offset - 50)))}>Предыдущая страница</Button>
                  <span className="text-xs text-muted-foreground">Страница {Math.floor(offset / 50) + 1} из {Math.ceil(accountsQuery.data.count / 50)}</span>
                  <Button variant="outline" size="sm" disabled={!accountsQuery.data.next || accountsQuery.isFetching} onClick={() => updateParam("offset", String(offset + 50))}>Следующая страница</Button>
                </nav>
              )}
            </CardContent>
          </Card>

          {selectedNumber !== null && selectedQuery.isError ? (
            <LoadFailure what="карточку пользователя" onRetry={() => void selectedQuery.refetch()} isRetrying={selectedQuery.isFetching} />
          ) : selectedNumber !== null && selectedQuery.isLoading ? (
            <Card><CardContent className="p-9" role="status">Загрузка карточки пользователя…</CardContent></Card>
          ) : selected === null ? (
            <Card>
              <CardContent className="p-9 text-center text-[13px] text-muted-foreground">
                Выберите человека слева, чтобы увидеть и раздать его роли.
              </CardContent>
            </Card>
          ) : (
            // key по учётке: карточка держит своё состояние (выбранная роль и
            // область, открытое подтверждение), и оно обязано сброситься при
            // переходе на другого человека.
            <AccountDetails
              key={selected.id}
              account={selected}
              onTemporaryPassword={(password) =>
                setSecret({
                  login: selected.username,
                  password,
                  reason: "reset",
                })
              }
            />
          )}
        </div>
      </div>

      <CreateAccountDialog
        open={isCreating}
        onOpenChange={setCreating}
        onCreated={(account, temporaryPassword) => {
          setCreating(false);
          updateParam("user", String(account.id));
          if (temporaryPassword !== undefined) {
            setSecret({
              login: account.username,
              password: temporaryPassword,
              reason: "created",
            });
          }
        }}
      />

      <TemporaryPasswordDialog
        secret={secret}
        onClose={() => setSecret(null)}
      />
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
  parentPath = ""
): Array<{ id: number; label: string }> {
  if (root === undefined) return [];
  const label = parentPath ? `${parentPath} › ${root.name}` : root.name;
  const self = root.id === 0 ? [] : [{ id: root.id, label }];
  return self.concat(
    (root.children ?? []).flatMap((child) => flattenDivisions(child, root.id === 0 ? "" : label))
  );
}

function AccountDetails({
  account,
  onTemporaryPassword,
}: {
  account: AccessAccount;
  onTemporaryPassword: (password: string) => void;
}) {
  const { hasGlobalPermission } = useOpsPermissions();
  const canManage = hasGlobalPermission(ACCESS_ADMIN_PERMISSION);
  const userRolesQuery = useAccessUserRoles(account.id, { enabled: canManage });
  const rolesQuery = useAccessRoleOptions({ enabled: canManage });
  const divisionsQuery = useDivisionsTree();
  const assign = useAssignAccessRole();
  const revoke = useRevokeAccessRole();

  const [roleCode, setRoleCode] = useState("");
  const [scope, setScope] = useState<string>(WHOLE_SERVICE_VALUE);
  const [pendingRevocation, setPendingRevocation] =
    useState<AccessUserRole | null>(null);
  const [pendingLock, setPendingLock] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const setActive = useSetAccessAccountActive();
  const resetPassword = useResetAccessAccountPassword({
    onDone: (temporaryPassword) => {
      setPendingReset(false);
      onTemporaryPassword(temporaryPassword);
    },
  });

  const divisions = flattenDivisions(divisionsQuery.data);
  const roleOptions = rolesQuery.isSuccess ? rolesQuery.data.results : [];
  const rolesReady = rolesQuery.isSuccess && !rolesQuery.isFetching;
  const selectedRole = roleOptions.find((role) => role.code === roleCode);
  const globalRole = selectedRole?.permissions.includes("*") === true;
  const scopesReady = globalRole || (divisionsQuery.isSuccess && !divisionsQuery.isFetching);
  const scopeExists = scope === WHOLE_SERVICE_VALUE || divisions.some(division => String(division.id) === scope);
  useEffect(() => { if (globalRole) setScope(WHOLE_SERVICE_VALUE); }, [globalRole]);
  // Показываются ДЕЙСТВУЮЩИЕ назначения: снятие оставляет строку в базе
  // (история выдач), но в списке ролей человека ей не место — там отвечают на
  // вопрос «что у него есть сейчас».
  const granted = (userRolesQuery.data?.results ?? []).filter(
    (row) => row.is_active
  );

  return (
    <Card className="min-w-0 break-words">
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px]">
          {account.full_name ?? account.username}
        </CardTitle>
        <p className="break-all font-mono text-[12px] text-muted-foreground">
          {account.username}
          {account.email !== "" && ` · ${account.email}`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <AccountEmployeeLink account={account} />
        <div className="border-t pt-3">
          <h3 className="mb-2 text-[13px] font-semibold">Учётная запись</h3>
          <p className="mb-2 text-[12px] text-muted-foreground">
            {account.is_active
              ? "Входит в систему."
              : "Заблокирована: человек не войдёт, но его роли и записи в журнале остаются."}
            {account.last_login === null
              ? " Ни разу не входил."
              : ` Последний вход ${formatLastLogin(account.last_login)}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={resetPassword.isPending}
              onClick={() => setPendingReset(true)}
            >
              Сбросить пароль
            </Button>
            <Button
              type="button"
              size="sm"
              variant={account.is_active ? "outline" : "default"}
              className="h-8"
              disabled={setActive.isPending}
              onClick={() => {
                // Разблокировка подтверждения не требует: она ничего не
                // отнимает и отменяется тем же действием.
                if (account.is_active) setPendingLock(true);
                else setActive.mutate({ id: account.id, is_active: true });
              }}
            >
              {account.is_active ? "Заблокировать" : "Разблокировать"}
            </Button>
          </div>
          {setActive.error !== null && (
            <p className="mt-2 text-[12px] text-destructive">
              Не удалось сменить состояние учётной записи. Попробуйте ещё раз.
            </p>
          )}
          {resetPassword.error !== null && (
            <p className="mt-2 text-[12px] text-destructive">
              Не удалось получить новый пароль. Повторите сброс и передайте пользователю пароль из успешного ответа.
            </p>
          )}
        </div>

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
              Постоянных назначений ролей нет. Временное исполнение обязанностей может давать отдельный доступ.
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
                      {accessScopeLabel(row)}
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
                disabled={!rolesReady}
                className="h-[34px] w-full rounded-md border bg-background px-2 text-[12.5px]"
                value={roleCode}
                onChange={(event) => setRoleCode(event.target.value)}
              >
                <option value="">— выберите роль —</option>
                {roleOptions.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.code} · {role.name}
                    {role.is_active ? "" : " (отключена)"}
                  </option>
                ))}
              </select>
              {rolesQuery.isLoading ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Загрузка справочника ролей…
                </p>
              ) : rolesQuery.isError ? (
                <LoadFailure
                  what="справочник ролей"
                  onRetry={() => void rolesQuery.refetch()}
                  isRetrying={rolesQuery.isFetching}
                />
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="assign-scope">Область</Label>
              <select
                id="assign-scope"
                disabled={globalRole || !scopesReady}
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
              {!globalRole && divisionsQuery.isPending && <p role="status" className="text-sm text-muted-foreground">Загрузка областей назначения…</p>}
              {!globalRole && divisionsQuery.isError && <LoadFailure what="области назначения" onRetry={() => void divisionsQuery.refetch()} isRetrying={divisionsQuery.isFetching} />}
              <p className="text-[11.5px] text-muted-foreground">
                Одна роль в разных областях — это разные назначения: они живут
                рядом и снимаются порознь.
              </p>
            </div>
            {selectedRole?.permissions.length === 0 && (
              <p role="status" className="text-sm text-amber-700">У роли нет ни одного права — она не откроет пользователю модули системы.</p>
            )}
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={assign.isPending || !rolesReady || selectedRole === undefined || !scopesReady || !scopeExists}
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
                {assign.error.message || "Не удалось выдать роль."}
              </p>
            )}
          </div>
        </div>
      </CardContent>

      <ConfirmDialog
        open={pendingLock}
        title="Заблокировать учётную запись?"
        confirmLabel="Заблокировать"
        isPending={setActive.isPending}
        onCancel={() => setPendingLock(false)}
        onConfirm={() => {
          setActive.mutate({ id: account.id, is_active: false });
          setPendingLock(false);
        }}
      >
        <>
          Пользователь <span className="font-mono">{account.username}</span>{" "}
          перестанет входить в систему сразу. Роли и записи в журнале
          сохранятся, разблокировать можно здесь же.
        </>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingReset}
        title="Сбросить пароль?"
        confirmLabel="Сбросить"
        isPending={resetPassword.isPending}
        onCancel={() => setPendingReset(false)}
        onConfirm={() => resetPassword.mutate({ id: account.id })}
      >
        <>
          Прежний пароль <span className="font-mono">{account.username}</span>{" "}
          перестанет работать немедленно. Новый временный пароль будет показан
          один раз — передать его человеку нужно сразу.
        </>
      </ConfirmDialog>

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
          {row ? accessScopeLabel(row) : ""}» перестанет
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

function formatLastLogin(value: string): string {
  return formatIsoDateTime(value, "неизвестно когда");
}

/** Одно окно подтверждения на все действия карточки: у них общий каркас
 * (вопрос — последствие — два действия), а три копии расходились бы формой
 * при первой же правке. */
function ConfirmDialog({
  open,
  title,
  confirmLabel,
  isPending,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] leading-[1.55]">{children}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateAccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (account: AccessAccount, temporaryPassword?: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Колбэк родителя приходит стрелкой из JSX и пересоздаётся каждый рендер —
  // в зависимостях эффекта ему не место, держим в ref.
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  const create = useCreateAccessAccount({
    onFormError: (details) => {
      const collected: Record<string, string> = {};
      for (const [field, value] of Object.entries(details)) {
        collected[field] = Array.isArray(value)
          ? String(value[0])
          : String(value);
      }
      setFieldErrors(collected);
    },
  });

  function close(next: boolean): void {
    if (next || create.isPending) return;
    setUsername("");
    setLastName("");
    setFirstName("");
    setEmail("");
    setPassword("");
    setFieldErrors({});
    create.reset();
    onOpenChange(false);
  }

  function submit(): void {
    setFieldErrors({});
    create.mutate({
      username: username.trim(),
      last_name: lastName.trim(),
      first_name: firstName.trim(),
      email: email.trim(),
      // Пустой пароль не отправляется вовсе: пустая строка на сервере — это
      // «задан пустой пароль», а не «придумай сам».
      ...(password === "" ? {} : { password }),
    });
  }

  // Успех — в эффекте, а не в теле рендера: setState родителя прямо в рендере
  // React отбивает предупреждением. Временный пароль отдаётся наверх ровно
  // один раз, вместе с закрытием окна: запросить его повторно нельзя.
  const created = create.data;
  useEffect(() => {
    if (created === undefined) return;
    create.reset();
    setUsername("");
    setLastName("");
    setFirstName("");
    setEmail("");
    setPassword("");
    setFieldErrors({});
    onCreatedRef.current(created, created.temporary_password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Завести учётную запись</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="account-username">Логин</Label>
            <Input
              id="account-username"
              className="h-[34px] font-mono text-[12.5px]"
              autoComplete="off"
              aria-describedby={
                fieldErrors.username ? "account-username-error" : undefined
              }
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            {fieldErrors.username && (
              <p
                id="account-username-error"
                className="text-[12px] text-destructive"
              >
                {fieldErrors.username}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="account-last-name">Фамилия</Label>
              <Input
                id="account-last-name"
                className="h-[34px] text-[12.5px]"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="account-first-name">Имя</Label>
              <Input
                id="account-first-name"
                className="h-[34px] text-[12.5px]"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="account-email">Почта</Label>
            <Input
              id="account-email"
              type="email"
              className="h-[34px] text-[12.5px]"
              autoComplete="off"
              aria-describedby={
                fieldErrors.email ? "account-email-error" : undefined
              }
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {fieldErrors.email && (
              <p
                id="account-email-error"
                className="text-[12px] text-destructive"
              >
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="account-password">Пароль (необязательно)</Label>
            <Input
              id="account-password"
              type="password"
              className="h-[34px] text-[12.5px]"
              autoComplete="new-password"
              aria-describedby="account-password-hint"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p
              id="account-password-hint"
              className="text-[11.5px] text-muted-foreground"
            >
              Оставьте пустым — система выдаст временный пароль и покажет его
              один раз.
            </p>
            {fieldErrors.password && (
              <p className="text-[12px] text-destructive">
                {fieldErrors.password}
              </p>
            )}
          </div>
          {create.error !== null && Object.keys(fieldErrors).length === 0 && (
            <p className="text-[12px] text-destructive">
              Не удалось завести учётную запись. Попробуйте ещё раз.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={create.isPending} onClick={() => close(false)}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={create.isPending || username.trim() === ""}
            onClick={submit}
          >
            Завести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Одноразовый секрет. Хранить его негде — сервер держит только хеш, — и
 * потому окно говорит об этом прямо, а не прячет предупреждение в подпись:
 * закрыть его, не переписав пароль, значит идти на новый сброс. */
function TemporaryPasswordDialog({
  secret,
  onClose,
}: {
  secret: {
    login: string;
    password: string;
    reason: "created" | "reset";
  } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    if (secret === null) return;
    try {
      // Стенд живёт на http по IP, а `navigator.clipboard` есть только в
      // защищённом контексте: без запасного пути кнопка молча ничего бы не
      // делала именно там, где ей пользуются.
      if (window.isSecureContext && navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(secret.password);
      } else {
        const field = document.createElement("textarea");
        field.value = secret.password;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        document.body.removeChild(field);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      open={secret !== null}
      onOpenChange={(next) => {
        if (!next) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Временный пароль</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-[13px] leading-[1.55]">
            {secret?.reason === "reset" ? (
              <>
                Пароль учётной записи{" "}
                <span className="font-mono">{secret.login}</span> сброшен:
                прежний больше не работает.
              </>
            ) : (
              <>
                Учётная запись{" "}
                <span className="font-mono">{secret?.login}</span> заведена.
              </>
            )}{" "}
            Пароль показывается <b>один раз</b>: система хранит только его
            свёртку. Закроете окно — восстановить его будет нельзя, останется
            сбросить заново.
          </p>
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border bg-muted/40 px-3 py-2">
            <code className="select-all font-mono text-[15px] tracking-wide">
              {secret?.password}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto h-8"
              onClick={() => void copy()}
            >
              Скопировать
            </Button>
          </div>
          <p role="status" className="min-h-[16px] text-[12px] text-muted-foreground">
            {copied ? "Пароль скопирован в буфер обмена." : ""}
          </p>
          <p className="text-[12px] text-muted-foreground">
            Передайте пароль человеку лично и потребуйте сменить его при первом
            входе.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
