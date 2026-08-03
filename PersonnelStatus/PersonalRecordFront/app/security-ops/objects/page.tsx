"use client";

// Реестр объектов и паспортов: KPI-полоса, поиск, таблица.
// Два правила донора соблюдены структурно:
//   • KPI приходят из ответа, посчитанные по ВСЕМУ реестру — фильтр и поиск
//     на числа не влияют;
//   • срок и состояние актуальности приходят готовыми (freshness), версия
//     политики показана рядом — фиксированного frontend-периода нет.
// Клик по KPI включает соответствующий фильтр; фильтр и поиск живут в URL —
// состояние экрана переживает перезагрузку и делится ссылкой.
import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Landmark } from "lucide-react";
import { useSecurityObjects } from "@/hooks/use-security-objects";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { FRESHNESS_LABEL, PassportStateBadge } from "@/entities/security-object";
import type {
  ObjectsRegistryKpi,
  PassportFreshness,
  SecurityObject,
} from "@/entities/security-object";

/** Значение фильтра в URL → предикат по объекту и его актуальности. У каждого
 * выводимого KPI ровно один фильтр — иначе клик обещал бы больше, чем делает. */
const KPI_FILTERS = {
  green: { label: "Паспорта актуальны", kpi: "passportGreen" },
  yellow: { label: "Требуют актуализации", kpi: "passportYellow" },
  red: { label: "Красный статус паспорта", kpi: "passportRed" },
  overdue: { label: "Проверка просрочена", kpi: "verificationOverdue" },
  "never-published": { label: "Паспорт не публиковался", kpi: "neverPublished" },
} as const satisfies Record<string, { label: string; kpi: keyof ObjectsRegistryKpi }>;

type KpiFilter = keyof typeof KPI_FILTERS;

function matchesFilter(
  filter: KpiFilter,
  object: SecurityObject,
  freshness: PassportFreshness | undefined
): boolean {
  switch (filter) {
    case "green":
      return object.passportState === "GREEN";
    case "yellow":
      return object.passportState === "YELLOW";
    case "red":
      return object.passportState === "RED";
    case "overdue":
      return freshness?.state === "OVERDUE";
    case "never-published":
      return freshness?.state === "NO_PUBLISHED_VERSION";
  }
}

export default function SecurityObjectsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const search = searchParams.get("search") ?? "";
  const rawFilter = searchParams.get("filter") ?? "";
  const filter: KpiFilter | null =
    rawFilter in KPI_FILTERS ? (rawFilter as KpiFilter) : null;

  const query = useSecurityObjects();

  const freshnessById = useMemo(() => {
    const map = new Map<string, PassportFreshness>();
    for (const item of query.data?.freshness ?? []) map.set(item.objectId, item);
    return map;
  }, [query.data]);

  const filtered = useMemo(() => {
    const all = query.data?.results ?? [];
    const q = search.trim().toLowerCase();
    const byFilter =
      filter === null
        ? all
        : all.filter((o) => matchesFilter(filter, o, freshnessById.get(o.id)));
    if (q === "") return byFilter;
    return byFilter.filter((o) =>
      `${o.name} ${o.code} ${o.address} ${o.type}`.toLowerCase().includes(q)
    );
  }, [query.data, search, filter, freshnessById]);

  function applyParams(params: URLSearchParams): void {
    const qs = params.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }

  function toggleFilter(next: KpiFilter): void {
    const params = new URLSearchParams(searchParams);
    // повторный клик по активному KPI снимает фильтр
    if (filter === next) params.delete("filter");
    else params.set("filter", next);
    applyParams(params);
  }

  function updateSearch(value: string): void {
    const params = new URLSearchParams(searchParams);
    if (value === "") params.delete("search");
    else params.set("search", value);
    applyParams(params);
  }

  if (!permissionsLoading && !hasPermission("ops.object.view")) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="p-9 text-center text-sm text-muted-foreground">
            Недостаточно прав для просмотра реестра объектов.
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Landmark className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Объекты и паспорта</h1>
            <p className="text-muted-foreground">
              Реестр объектов, секторов и постоянных постов
            </p>
          </div>
        </div>

        {query.data !== undefined && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Card role="group" aria-label="Всего объектов">
                <CardContent className="p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    Всего объектов
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {query.data.kpi.total}
                  </p>
                </CardContent>
              </Card>
              {(Object.keys(KPI_FILTERS) as KpiFilter[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => toggleFilter(key)}
                  className={
                    filter === key
                      ? "rounded-xl border border-primary bg-primary/10 p-3 text-left"
                      : "rounded-xl border bg-card p-3 text-left hover:bg-muted/40"
                  }
                >
                  <span className="block text-[11px] font-semibold text-muted-foreground">
                    {KPI_FILTERS[key].label}
                  </span>
                  <span className="block text-xl font-bold tabular-nums">
                    {query.data.kpi[KPI_FILTERS[key].kpi]}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Показатели посчитаны сервером по всему реестру, а не по
              отрисованной таблице. Срок проверки — по политике{" "}
              {query.data.freshnessPolicy.version}:{" "}
              {query.data.freshnessPolicy.verificationIntervalDays} дней с даты
              публикации, предупреждение — за{" "}
              {query.data.freshnessPolicy.dueSoonPercent}% интервала до срока.
            </p>
            {filter !== null && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Фильтр: {KPI_FILTERS[filter].label}
                </span>
                <Button size="sm" variant="outline" onClick={() => toggleFilter(filter)}>
                  Сбросить фильтр
                </Button>
              </div>
            )}
          </div>
        )}

        <Input
          className="max-w-md"
          placeholder="Поиск по наименованию, коду, адресу, типу…"
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
        />

        <ObjectsTable
          isLoading={query.isLoading}
          isError={query.isError}
          objects={filtered}
          freshnessById={freshnessById}
        />

        {query.data !== undefined && (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="p-4">
              <h2 className="mb-2 text-sm font-semibold">
                Показатели, которых нет в модели
              </h2>
              <ul className="flex flex-col gap-2">
                {query.data.unavailableKpi.map((metric) => (
                  <li key={metric.code} className="text-xs text-muted-foreground">
                    <span className="font-semibold">{metric.label}</span> —{" "}
                    {metric.reason}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function ObjectsTable({
  isLoading,
  isError,
  objects,
  freshnessById,
}: {
  isLoading: boolean;
  isError: boolean;
  objects: SecurityObject[];
  freshnessById: Map<string, PassportFreshness>;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Загрузка реестра объектов…
        </CardContent>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-destructive">
          Не удалось загрузить реестр объектов. Попробуйте обновить страницу.
        </CardContent>
      </Card>
    );
  }
  if (objects.length === 0) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Объекты не найдены
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Объект</TableHead>
            <TableHead>Тип</TableHead>
            <TableHead>Адрес</TableHead>
            <TableHead>Паспорт</TableHead>
            <TableHead>Срок проверки</TableHead>
            <TableHead>
              <span className="sr-only">Действия</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {objects.map((object) => (
            <TableRow key={object.id}>
              <TableCell>
                <Link href={`/security-ops/objects/${object.id}`} className="block">
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold">
                    {object.code}
                  </span>
                  <span className="mt-1 block font-semibold">{object.name}</span>
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{object.type}</TableCell>
              <TableCell className="text-muted-foreground">
                {object.region} · {object.address}
              </TableCell>
              <TableCell>
                <PassportStateBadge state={object.passportState} />
              </TableCell>
              {/* состояние паспорта и его актуальность — разные поля */}
              <TableCell>
                <FreshnessCell freshness={freshnessById.get(object.id)} />
              </TableCell>
              <TableCell className="text-center text-muted-foreground">
                <Link href={`/security-ops/objects/${object.id}`}>›</Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function FreshnessCell({ freshness }: { freshness: PassportFreshness | undefined }) {
  if (freshness === undefined) {
    // статус не пришёл (старый кэш ответа) — не выдумываем «актуален»
    return (
      <span className="text-xs text-muted-foreground">
        Нет данных об актуальности
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm">{FRESHNESS_LABEL[freshness.state]}</span>
      {freshness.verificationDueAt !== null && (
        <span className="text-[11px] text-muted-foreground tabular-nums">
          до {freshness.verificationDueAt}
        </span>
      )}
    </div>
  );
}
