"use client";

// Экран «Права» раздела настроек (Plane №36, шаг «П-6»).
//
// Слева реестр прав с СЕРВЕРНЫМ поиском (требование заказчика «чтобы ручным
// способом не искать»), справа карточка выбранного права с каталогом
// применения: какие ручки и действия оно открывает. Каталог не хранится —
// сервер собирает его из карт гейтов, поэтому у функций нет ни правки, ни
// идентификатора, и показаны они списком, а не таблицей с действиями.
//
// Выбор и поиск живут в URL: обновление страницы не сбрасывает разбор, а
// ссылкой на конкретное право можно поделиться — как в реестре ОМ и в законах.
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
import { MODULE_PERMISSION } from "@/entities/portal-access";
import {
  useAccessCatalog,
  useAccessPermissions,
  useCreateAccessPermission,
  useSetAccessPermissionActive,
} from "@/hooks/use-access-permissions";
import { accessMethodTone } from "@/entities/access";
import type { AccessCatalogEntry, AccessPermission } from "@/entities/access";

// Право берётся из ОБЩЕЙ карты (Plane №350): пункт меню и гейт этого
// экрана обязаны решать одно и то же, иначе спрятанный пункт и открытый
// экран разойдутся молча.
const ACCESS_ADMIN_PERMISSION = MODULE_PERMISSION["/settings/permissions"];

export default function AccessPermissionsPage() {
  // useSearchParams требует границы Suspense — иначе пререндер падает на сборке.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AccessPermissionsScreen />
    </Suspense>
  );
}

function AccessPermissionsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const search = searchParams.get("search") ?? "";
  const selectedCode = searchParams.get("code");
  const canManage = hasPermission(ACCESS_ADMIN_PERMISSION);

  const permissionsQuery = useAccessPermissions(search);
  const catalogQuery = useAccessCatalog();
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
    return <OpsAccessDenied what="справочника прав" />;
  }

  const rows = permissionsQuery.data?.results ?? [];
  const selected = rows.find((row) => row.code === selectedCode) ?? null;
  const catalogEntry =
    catalogQuery.data?.results.find((entry) => entry.code === selectedCode) ??
    null;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Настройки"
          title="Права"
          description="Право — это то, что проверяют ручки системы. Здесь видно, какие функции открывает каждое право, и заводятся новые."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-[38px] max-w-[420px] flex-1 text-[13px]"
            placeholder="Поиск по коду, названию или описанию…"
            aria-label="Поиск по справочнику прав"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <Button
            type="button"
            className="h-[38px]"
            onClick={() => setCreating(true)}
          >
            Завести право
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[14px]">
                Справочник прав
                {permissionsQuery.data !== undefined && (
                  <span className="ml-2 text-[12px] font-normal text-muted-foreground tabular-nums">
                    {permissionsQuery.data.count}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {permissionsQuery.isLoading ? (
                <p className="p-9 text-center text-sm text-muted-foreground">
                  Загрузка справочника прав…
                </p>
              ) : permissionsQuery.isError ? (
                <LoadFailure
                  what="справочник прав"
                  className="p-6"
                  onRetry={() => void permissionsQuery.refetch()}
                  isRetrying={permissionsQuery.isFetching}
                />
              ) : rows.length === 0 ? (
                <EmptyRegistry
                  search={search}
                  onClear={() => {
                    setSearchDraft("");
                    updateParam("search", "");
                  }}
                />
              ) : (
                // Таблица прокручивается ВНУТРИ себя: код права длинный, и без
                // обёртки страница уезжала бы вбок целиком.
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[42%]">Код</TableHead>
                        <TableHead>Название</TableHead>
                        <TableHead className="w-[120px]">Состояние</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((permission) => (
                        <PermissionRow
                          key={permission.code}
                          permission={permission}
                          isSelected={permission.code === selectedCode}
                          onSelect={() =>
                            updateParam("code", permission.code)
                          }
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <PermissionDetails
            permission={selected}
            catalogEntry={catalogEntry}
            isCatalogLoading={catalogQuery.isLoading}
            isCatalogError={catalogQuery.isError}
            onRetryCatalog={() => void catalogQuery.refetch()}
          />
        </div>
      </div>

      <CreatePermissionDialog
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
  // Пустой поиск и пустой справочник — РАЗНЫЕ факты, и подпись у них разная:
  // «прав нет» на непопавший запрос звучало бы как утверждение о системе.
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
      Справочник прав пуст. Заведите первое право кнопкой «Завести право».
    </p>
  );
}

function PermissionRow({
  permission,
  isSelected,
  onSelect,
}: {
  permission: AccessPermission;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
      className={isSelected ? "bg-muted/60" : undefined}
    >
      <TableCell className="font-mono text-[12.5px]">
        {/* Кнопка, а не строка с onClick: выбор права должен открываться с
            клавиатуры, а у <tr> нет ни фокуса, ни роли. */}
        <button
          type="button"
          className="text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-pressed={isSelected}
          onClick={onSelect}
        >
          {permission.code}
        </button>
      </TableCell>
      <TableCell className="text-[13px]">{permission.name}</TableCell>
      <TableCell>
        <StateBadge isActive={permission.is_active} />
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
      {isActive ? "Действует" : "Отключено"}
    </span>
  );
}

function PermissionDetails({
  permission,
  catalogEntry,
  isCatalogLoading,
  isCatalogError,
  onRetryCatalog,
}: {
  permission: AccessPermission | null;
  catalogEntry: AccessCatalogEntry | null;
  isCatalogLoading: boolean;
  isCatalogError: boolean;
  onRetryCatalog: () => void;
}) {
  const setActive = useSetAccessPermissionActive();

  if (permission === null) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-[13px] text-muted-foreground">
          Выберите право слева, чтобы увидеть, какие функции оно открывает.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px]">{permission.name}</CardTitle>
        <p className="font-mono text-[12px] text-muted-foreground">
          {permission.code}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
          {permission.description?.trim()
            ? permission.description
            : "Описание не заполнено."}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <StateBadge isActive={permission.is_active} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={setActive.isPending}
            onClick={() =>
              setActive.mutate({
                code: permission.code,
                is_active: !permission.is_active,
              })
            }
          >
            {permission.is_active ? "Отключить" : "Включить"}
          </Button>
        </div>
        {/* Удаления нет и здесь: код права стоит в гейтах живых ручек, и
            удалить строку справочника значило бы оставить закрытую ручку без
            объяснения, чем именно она закрыта. */}
        <p className="text-[11.5px] text-muted-foreground">
          Отключённое право остаётся в справочнике: его код стоит в гейтах
          ручек, и удалить его нельзя.
        </p>
        {setActive.error !== null && (
          <p className="text-[12px] text-destructive">
            Не удалось изменить состояние права. Попробуйте ещё раз.
          </p>
        )}

        <div className="border-t pt-3">
          <h3 className="mb-2 text-[13px] font-semibold">Где применяется</h3>
          {isCatalogLoading ? (
            <p className="text-[12.5px] text-muted-foreground">
              Загрузка каталога функций…
            </p>
          ) : isCatalogError ? (
            <LoadFailure what="каталог функций" onRetry={onRetryCatalog} />
          ) : catalogEntry === null || catalogEntry.functions.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              Право не стоит ни на одной ручке: оно заведено в справочнике, но
              пока ничего не открывает.
            </p>
          ) : (
            /* 🔴 ДВА ВИДА СТРОК РАЗВЕДЕНЫ ГРУППАМИ (Plane №902). Раньше место,
               где право лишь СНИМАЕТ ограничение внутри чужой ручки, стояло в
               одном списке с местами, которые оно открывает, — и читалось как
               второе. Это неправда в опасную сторону: держатель одного такого
               права всё равно получит отказ, потому что ручку закрывает
               другое, а администратор раздаёт права именно по этому экрану.

               ГРУППЫ, А НЕ ПОМЕТКА У КАЖДОЙ СТРОКИ: строк у права бывает до
               пары десятков, и значок в каждой превратил бы список в
               пестроту. Различие несут ЗАГОЛОВОК и пояснение под ним —
               словами, а не цветом (правило скилла «не цветом одним»).

               Строка без `kind` — ответ сервера, снятого до этой правки:
               считается гейтом, то есть ведёт себя как раньше. */
            <div className="space-y-3">
              {(
                [
                  {
                    kind: "gate" as const,
                    title: "Открывает",
                    note: null,
                  },
                  {
                    kind: "widens" as const,
                    title: "Снимает ограничение внутри",
                    note:
                      "Ручку открывает другое право — с одним этим будет отказ.",
                  },
                ]
              ).map((group) => {
                const rows = catalogEntry.functions.filter((fn) =>
                  group.kind === "gate"
                    ? (fn.kind ?? "gate") === "gate"
                    : fn.kind === "widens"
                );
                if (rows.length === 0) return null;
                return (
                  <div key={group.kind} data-slot={`access-group-${group.kind}`}>
                    <p className="mb-1 text-[12px] font-semibold">
                      {group.title}
                    </p>
                    {group.note !== null && (
                      <p className="mb-1.5 text-[11.5px] text-muted-foreground">
                        {group.note}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {rows.map((fn) => (
                        <li
                          key={`${fn.method} ${fn.path} ${fn.action}`}
                          className="flex flex-wrap items-baseline gap-2 rounded-[8px] border px-2.5 py-1.5"
                        >
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full px-[7px] py-0.5 font-mono text-[10.5px] font-bold ${accessMethodTone(fn.method)}`}
                          >
                            {fn.method}
                          </span>
                          <span className="font-mono text-[11.5px] break-all">
                            {fn.path}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {fn.action}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreatePermissionDialog({
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
  // Колбэк родителя держим в ref: он приходит стрелкой из JSX и в
  // зависимостях эффекта пересоздавался бы каждый рендер.
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  const create = useCreateAccessPermission({
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

  function submit(): void {
    setFieldErrors({});
    create.mutate(
      { code: code.trim(), name: name.trim(), description: description.trim() },
    );
  }

  // Успех виден по данным мутации: диалог закрывается и выбор уезжает на
  // новое право, чтобы сразу было видно, что оно пока ничего не открывает.
  // Реакция живёт в эффекте, а не в теле рендера: setState прямо в рендере
  // React отбивает предупреждением и повторным проходом.
  const created = create.data?.code;
  useEffect(() => {
    if (created === undefined) return;
    create.reset();
    setCode("");
    setName("");
    setDescription("");
    onCreatedRef.current(created);
    // create и onCreated в зависимостях не нужны: реакция привязана к
    // ПОЯВЛЕНИЮ кода, а не к тождеству колбэков, которые родитель
    // пересоздаёт каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новое право</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="permission-code">Код</Label>
            <Input
              id="permission-code"
              className="font-mono"
              placeholder="например, reports.export"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <p className="text-[11.5px] text-muted-foreground">
              Код должен совпасть с тем, что стоит в гейте ручки. Заведённое
              право, которого нет ни в одном гейте, ничего не откроет — это
              допустимо, но видно в карточке.
            </p>
            {fieldErrors.code && (
              <p className="text-[12px] text-destructive">{fieldErrors.code}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="permission-name">Название</Label>
            <Input
              id="permission-name"
              placeholder="Выгрузка отчётов"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {fieldErrors.name && (
              <p className="text-[12px] text-destructive">{fieldErrors.name}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="permission-description">Описание</Label>
            <Textarea
              id="permission-description"
              rows={3}
              placeholder="Что именно открывает это право"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {create.error !== null && Object.keys(fieldErrors).length === 0 && (
            <p className="text-[12px] text-destructive">
              Не удалось завести право. Попробуйте ещё раз.
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
            onClick={submit}
          >
            Завести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
