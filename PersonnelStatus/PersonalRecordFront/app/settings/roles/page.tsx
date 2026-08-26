"use client";

// Экран «Роли» раздела настроек (Plane №36, шаг «П-7»).
//
// Слева реестр ролей с СЕРВЕРНЫМ поиском, справа карточка роли: описание,
// состояние и СОСТАВ ПРАВ — то, ради чего роль и заводят. Состав правится
// здесь же: снятие права спрашивает подтверждение, потому что меняет живой
// доступ у всех, кому роль уже выдана, а выдача ищется по справочнику прав
// (тоже на сервере — прав больше, чем помещается в голову).
//
// Поиск и выбор живут в URL: как на экране «Права» и в реестре ОМ.
import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  useAccessPermissions,
  useAccessRoles,
  useChangeRolePermissions,
  useCreateAccessRole,
  useSetAccessRoleActive,
} from "@/hooks/use-access-permissions";
import type { AccessPermission, AccessRole } from "@/entities/access";

const ACCESS_ADMIN_PERMISSION = "admin.roles";

export default function AccessRolesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const search = searchParams.get("search") ?? "";
  const selectedCode = searchParams.get("code");
  const canManage = hasPermission(ACCESS_ADMIN_PERMISSION);

  const rolesQuery = useAccessRoles(search);
  const [isCreating, setCreating] = useState(false);

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
    return <OpsAccessDenied what="справочника ролей" />;
  }

  const roles = rolesQuery.data?.results ?? [];
  const selected = roles.find((role) => role.code === selectedCode) ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Настройки"
          title="Роли"
          description="Роль — это набор прав, который выдают человеку. Здесь видно, что открывает каждая роль, и собирается её состав."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-[38px] max-w-[420px] flex-1 text-[13px]"
            placeholder="Поиск по коду, названию или описанию…"
            aria-label="Поиск по справочнику ролей"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <Button
            type="button"
            className="h-[38px]"
            onClick={() => setCreating(true)}
          >
            Завести роль
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[14px]">
                Справочник ролей
                {rolesQuery.data !== undefined && (
                  <span className="ml-2 text-[12px] font-normal text-muted-foreground tabular-nums">
                    {rolesQuery.data.count}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {rolesQuery.isLoading ? (
                <p className="p-9 text-center text-sm text-muted-foreground">
                  Загрузка справочника ролей…
                </p>
              ) : rolesQuery.isError ? (
                <LoadFailure
                  what="справочник ролей"
                  className="p-6"
                  onRetry={() => void rolesQuery.refetch()}
                  isRetrying={rolesQuery.isFetching}
                />
              ) : roles.length === 0 ? (
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
                        <TableHead className="w-[34%]">Код</TableHead>
                        <TableHead>Название</TableHead>
                        <TableHead className="w-[90px] text-right">
                          Прав
                        </TableHead>
                        <TableHead className="w-[120px]">Состояние</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roles.map((role) => (
                        <RoleRow
                          key={role.code}
                          role={role}
                          isSelected={role.code === selectedCode}
                          onSelect={() => updateParam("code", role.code)}
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
                Выберите роль слева, чтобы увидеть и собрать её состав прав.
              </CardContent>
            </Card>
          ) : (
            // key по коду: карточка держит своё состояние (поиск прав,
            // подтверждение снятия), и при переходе на другую роль оно обязано
            // сброситься — иначе подтверждение снятия относилось бы к прошлой.
            <RoleDetails key={selected.code} role={selected} />
          )}
        </div>
      </div>

      <CreateRoleDialog
        open={isCreating}
        onOpenChange={setCreating}
        onCreated={(code) => {
          setCreating(false);
          updateParam("code", code);
        }}
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
      Справочник ролей пуст. Заведите первую роль кнопкой «Завести роль».
    </p>
  );
}

function RoleRow({
  role,
  isSelected,
  onSelect,
}: {
  role: AccessRole;
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
          {role.code}
        </button>
      </TableCell>
      <TableCell className="text-[13px]">{role.name}</TableCell>
      <TableCell className="text-right text-[13px] tabular-nums">
        {role.permissions.length}
      </TableCell>
      <TableCell>
        <StateBadge isActive={role.is_active} />
      </TableCell>
    </TableRow>
  );
}

function StateBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={
        isActive
          ? "inline-flex whitespace-nowrap rounded-full bg-green-100 px-[9px] py-0.5 text-[10.5px] font-bold text-green-800 dark:bg-green-900/40 dark:text-green-200"
          : "inline-flex whitespace-nowrap rounded-full bg-slate-200 px-[9px] py-0.5 text-[10.5px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
      }
    >
      {isActive ? "Действует" : "Отключена"}
    </span>
  );
}

function RoleDetails({ role }: { role: AccessRole }) {
  const setActive = useSetAccessRoleActive();
  const changeComposition = useChangeRolePermissions(role.code);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [searchDraft, setSearchDraft] = useDebouncedCommit(
    permissionSearch,
    setPermissionSearch
  );
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  // Справочник прав нужен и для подписей выданных прав, и для выдачи новых.
  // Без поиска он приезжает страницей — этого хватает: подписи берутся из
  // него, а чего не хватило, видно по самому коду права.
  const permissionsQuery = useAccessPermissions(permissionSearch);
  const nameByCode = new Map(
    (permissionsQuery.data?.results ?? []).map((p) => [p.code, p.name])
  );
  const granted = new Set(role.permissions);
  const offered = (permissionsQuery.data?.results ?? []).filter(
    (permission) => !granted.has(permission.code)
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px]">{role.name}</CardTitle>
        <p className="font-mono text-[12px] text-muted-foreground">
          {role.code}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
          {role.description?.trim()
            ? role.description
            : "Описание не заполнено."}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <StateBadge isActive={role.is_active} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={setActive.isPending}
            onClick={() =>
              setActive.mutate({
                code: role.code,
                is_active: !role.is_active,
              })
            }
          >
            {role.is_active ? "Отключить" : "Включить"}
          </Button>
        </div>
        {setActive.error !== null && (
          <p className="text-[12px] text-destructive">
            Не удалось изменить состояние роли. Попробуйте ещё раз.
          </p>
        )}

        <div className="border-t pt-3">
          <h3 className="mb-2 text-[13px] font-semibold">
            Состав прав
            <span className="ml-2 text-[12px] font-normal text-muted-foreground tabular-nums">
              {role.permissions.length}
            </span>
          </h3>
          {role.permissions.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              Роль пока не открывает ничего: прав в составе нет. Это допустимо —
              заготовку заводят раньше, чем решают её состав.
            </p>
          ) : (
            // Список именован: он читается как «состав прав роли», а не как
            // безымянный перечень, и его же по этому имени находит проба.
            <ul aria-label="Состав прав роли" className="space-y-1.5">
              {role.permissions.map((code) => (
                <li
                  key={code}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-[8px] border px-2.5 py-1.5"
                >
                  <span className="font-mono text-[11.5px] break-all">
                    {code}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {nameByCode.get(code) ?? ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11.5px]"
                      disabled={changeComposition.isPending}
                      onClick={() => setPendingRemoval(code)}
                    >
                      Снять
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {changeComposition.error !== null && (
            <p className="mt-2 text-[12px] text-destructive">
              Не удалось изменить состав прав. Попробуйте ещё раз.
            </p>
          )}
        </div>

        <div className="border-t pt-3">
          <h3 className="mb-2 text-[13px] font-semibold">Выдать право</h3>
          <Input
            className="h-[34px] text-[12.5px]"
            placeholder="Поиск по справочнику прав…"
            aria-label="Поиск права для выдачи роли"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          {permissionsQuery.isLoading ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              Загрузка справочника прав…
            </p>
          ) : permissionsQuery.isError ? (
            <LoadFailure
              what="справочник прав"
              className="mt-2"
              onRetry={() => void permissionsQuery.refetch()}
            />
          ) : offered.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {permissionSearch.trim() === ""
                ? "Все права справочника уже в составе роли."
                : `По запросу «${permissionSearch}» свободных прав нет.`}
            </p>
          ) : (
            <ul aria-label="Права, которые можно выдать" className="mt-2 space-y-1.5">
              {offered.map((permission) => (
                <OfferedPermission
                  key={permission.code}
                  permission={permission}
                  isPending={changeComposition.isPending}
                  onGrant={() =>
                    changeComposition.mutate({ add: [permission.code] })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <ConfirmRemovalDialog
        code={pendingRemoval}
        roleName={role.name}
        isPending={changeComposition.isPending}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval === null) return;
          changeComposition.mutate({ remove: [pendingRemoval] });
          setPendingRemoval(null);
        }}
      />
    </Card>
  );
}

function OfferedPermission({
  permission,
  isPending,
  onGrant,
}: {
  permission: AccessPermission;
  isPending: boolean;
  onGrant: () => void;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-[8px] border border-dashed px-2.5 py-1.5">
      <span className="font-mono text-[11.5px] break-all">
        {permission.code}
      </span>
      <span className="flex items-baseline gap-2">
        <span className="text-[11px] text-muted-foreground">
          {permission.name}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11.5px]"
          disabled={isPending}
          onClick={onGrant}
        >
          Выдать
        </Button>
      </span>
    </li>
  );
}

function ConfirmRemovalDialog({
  code,
  roleName,
  isPending,
  onCancel,
  onConfirm,
}: {
  code: string | null;
  roleName: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Снятие права — действие с последствием за пределами экрана: доступ
  // пропадает у ВСЕХ, кому роль выдана, и вернуть его можно только новой
  // выдачей. Такое не делается по одному клику.
  return (
    <Dialog open={code !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Снять право с роли?</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] leading-[1.55]">
          Право <span className="font-mono">{code}</span> перестанет
          действовать у всех, кому выдана роль «{roleName}». Вернуть его можно
          только повторной выдачей.
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

function CreateRoleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  const create = useCreateAccessRole({
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

  const created = create.data?.code;
  useEffect(() => {
    if (created === undefined) return;
    create.reset();
    setCode("");
    setName("");
    setDescription("");
    onCreatedRef.current(created);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая роль</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="role-code">Код</Label>
            <Input
              id="role-code"
              className="font-mono"
              placeholder="например, ARCHIVIST"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <p className="text-[11.5px] text-muted-foreground">
              Код роли стоит в назначениях людям и не меняется после
              заведения — роль снимается с работы отключением, а не удалением.
            </p>
            {fieldErrors.code && (
              <p className="text-[12px] text-destructive">{fieldErrors.code}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-name">Название</Label>
            <Input
              id="role-name"
              placeholder="Архивариус"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {fieldErrors.name && (
              <p className="text-[12px] text-destructive">{fieldErrors.name}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-description">Описание</Label>
            <Textarea
              id="role-description"
              rows={3}
              placeholder="Кому и зачем выдаётся эта роль"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Права собираются после заведения — в карточке роли. Роль без прав
            допустима.
          </p>
          {create.error !== null && Object.keys(fieldErrors).length === 0 && (
            <p className="text-[12px] text-destructive">
              Не удалось завести роль. Попробуйте ещё раз.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            disabled={
              create.isPending || code.trim() === "" || name.trim() === ""
            }
            onClick={() => {
              // Прошлые ошибки полей снимаются ДО попытки: оставленные, они
              // читались бы как ответ на новый ввод.
              setFieldErrors({});
              create.mutate({
                code: code.trim(),
                name: name.trim(),
                description: description.trim(),
              });
            }}
          >
            Завести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
