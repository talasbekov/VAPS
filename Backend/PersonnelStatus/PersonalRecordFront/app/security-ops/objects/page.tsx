"use client";

// Реестр объектов и паспортов: шапка, KPI-полоса, панель фильтров, таблица.
// Раскладка повторяет прототип раздела (docs/screens/модуль Обьекты и
// паспорта). Колонки прототипа, под которыми в модели нет поля —
// ответственный, процент заполнения паспорта, замечания, ближайшее ОМ,
// принадлежность объекта — НЕ нарисованы пустыми: они перечислены под
// реестром вместе с причиной, по которой их нечем заполнить.
//
// Два правила донора соблюдены структурно:
//   • KPI приходят из ответа, посчитанные по ВСЕМУ реестру — фильтр и поиск
//     на числа не влияют;
//   • срок и состояние актуальности приходят готовыми (freshness), версия
//     политики показана рядом — фиксированного frontend-периода нет, дни
//     до срока страница не считает.
// Все фильтры и поиск живут в URL — состояние экрана переживает перезагрузку
// и делится ссылкой.
import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Archive,
  Building2,
  ChevronRight,
  Factory,
  Landmark,
  LayoutGrid,
  Rows3,
  Search,
  Warehouse,
} from "lucide-react";
import { useSecurityObjects } from "@/hooks/use-security-objects";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  FRESHNESS_LABEL,
  PASSPORT_STATE_LABEL,
  PassportStateBadge,
} from "@/entities/security-object";
import type {
  ObjectState,
  ObjectsRegistryKpi,
  PassportFreshness,
  PassportFreshnessState,
  PassportState,
  SecurityObject,
} from "@/entities/security-object";
import { OpsAccessDenied } from "@/components/ops-access-denied";

/**
 * KPI-полоса прототипа. Каждая плитка — не только число, но и фильтр: клик
 * ставит ровно тот же параметр URL, которым управляет соответствующий
 * выпадающий список внизу. Поэтому у плитки и списка один источник истины —
 * плитка не может показать выборку, которую панель фильтров опровергает.
 */
const KPI_TILES = [
  {
    key: "total",
    label: "Всего объектов",
    kpi: "total",
    dot: "bg-blue-500",
    hint: "Строк в реестре",
    param: null,
  },
  {
    key: "green",
    label: "Паспорта актуальны",
    kpi: "passportGreen",
    dot: "bg-green-500",
    hint: "Состояние паспорта — зелёное",
    param: { name: "passport", value: "GREEN" },
  },
  {
    key: "yellow",
    label: "Требуют актуализации",
    kpi: "passportYellow",
    dot: "bg-amber-500",
    hint: "Состояние паспорта — жёлтое",
    param: { name: "passport", value: "YELLOW" },
  },
  {
    key: "red",
    label: "Требуют внимания",
    kpi: "passportRed",
    dot: "bg-red-500",
    hint: "Состояние паспорта — красное",
    param: { name: "passport", value: "RED" },
  },
  {
    key: "overdue",
    label: "Проверка просрочена",
    kpi: "verificationOverdue",
    dot: "bg-orange-500",
    hint: "Срок по действующей политике прошёл",
    param: { name: "freshness", value: "OVERDUE" },
  },
  {
    key: "never",
    label: "Паспорт не публиковался",
    kpi: "neverPublished",
    dot: "bg-slate-400",
    hint: "Опубликованных версий нет",
    param: { name: "freshness", value: "NO_PUBLISHED_VERSION" },
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  kpi: keyof ObjectsRegistryKpi;
  dot: string;
  hint: string;
  param: { name: string; value: string } | null;
}>;

/** Значение «все» — литерал, а не пустая строка: Radix Select запрещает
 * пустое значение пункта, а в URL умолчание просто не пишется. */
const ANY = "all";

const OBJECT_STATE_LABEL: Record<ObjectState, string> = {
  ACTIVE: "Действующий",
  ARCHIVED: "В архиве",
};

const OBJECT_STATE_CLASS: Record<ObjectState, string> = {
  ACTIVE: "bg-green-100 text-green-800 hover:bg-green-100",
  ARCHIVED: "bg-slate-100 text-slate-700 hover:bg-slate-100",
};

const PASSPORT_STATES: PassportState[] = ["GREEN", "YELLOW", "RED"];

/** Цвет строки актуальности идёт от состояния ОТВЕТА, а не от даты: дни до
 * срока экран не считает — их посчитала политика на сервере. */
const FRESHNESS_CLASS: Record<PassportFreshnessState, string> = {
  FRESH: "text-muted-foreground",
  DUE_SOON: "text-amber-700 dark:text-amber-400",
  OVERDUE: "text-red-600 dark:text-red-400 font-semibold",
  NO_PUBLISHED_VERSION: "text-muted-foreground",
};

/** Режим показа реестра. Как в прототипе — два: карточный и построчный.
 * Живёт в URL рядом с поиском и фильтрами, поэтому переживает перезагрузку
 * и уезжает вместе со ссылкой. Порядок ключей задаёт порядок кнопок. */
const VIEW_MODES = {
  cards: { label: "Карточки", icon: LayoutGrid },
  table: { label: "Таблица", icon: Rows3 },
} as const;

type ViewMode = keyof typeof VIEW_MODES;

/** Умолчание раздела. В URL не пишется — ссылка на нетронутый реестр
 * остаётся чистой, а `?view=table` появляется только при явном выборе. */
const DEFAULT_VIEW: ViewMode = "cards";

/**
 * Обложка карточки объекта. ФОТОГРАФИЙ У ОБЪЕКТА НЕТ: ни модель
 * (`OpsSecurityObject`), ни сериализатор раздела не отдают ни одного файлового
 * поля, а демо-фикстура прямо помечает схемы и документы как требующие
 * blob-хранилища, которого в срезе нет. Поэтому обложка — не заглушка под
 * будущее фото, а опознавательная плашка: иконка по типу объекта на тоне,
 * выведенном из его кода. Тон постоянен для объекта, поэтому карточка
 * узнаётся в сетке по цвету раньше, чем прочитан её заголовок.
 *
 * Классы перечислены литералами: Tailwind сканирует исходник, собранная
 * из кусков строка в сборку не попала бы (см. safelist в tailwind.config.js).
 */
const COVER_TINTS = [
  "bg-blue-100 text-blue-800",
  "bg-teal-100 text-teal-800",
  "bg-amber-100 text-amber-800",
  "bg-indigo-100 text-indigo-800",
  "bg-emerald-100 text-emerald-800",
  "bg-orange-100 text-orange-800",
  "bg-cyan-100 text-cyan-800",
  "bg-purple-100 text-purple-800",
] as const;

/** Иконка по типу объекта. Совпадение по подстроке: тип — свободная строка
 * справочника, а не перечисление, поэтому запас на «ничего не подошло». */
const TYPE_ICONS: ReadonlyArray<{ match: RegExp; icon: typeof Landmark }> = [
  { match: /резиденц|учрежден|министерств|акимат|штаб/i, icon: Landmark },
  { match: /склад|хранилищ/i, icon: Warehouse },
  { match: /архив|библиотек/i, icon: Archive },
  { match: /завод|производ|цех|энерг/i, icon: Factory },
];

function coverTint(code: string): string {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COVER_TINTS[hash % COVER_TINTS.length];
}

function coverIcon(type: string): typeof Landmark {
  return TYPE_ICONS.find((entry) => entry.match.test(type))?.icon ?? Building2;
}

/** ISO-дата → ДД.ММ.ГГГГ нарезкой строки. Через `new Date` разбор ушёл бы
 * в локальную зону и в минусовых таймзонах сдвигал бы день на сутки назад. */
function formatDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** Последняя по номеру публикация; null — паспорт не публиковали ни разу. */
function latestVersion(object: SecurityObject) {
  if (object.passportVersions.length === 0) return null;
  return object.passportVersions.reduce((best, version) =>
    version.versionNumber > best.versionNumber ? version : best
  );
}

function countPosts(object: SecurityObject): number {
  return object.sectors.reduce((total, sector) => total + sector.posts.length, 0);
}

export default function SecurityObjectsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? ANY;
  const passport = searchParams.get("passport") ?? ANY;
  const region = searchParams.get("region") ?? ANY;
  // Своего списка у актуализации нет — параметр ставят плитки KPI
  // «Проверка просрочена» и «Паспорт не публиковался».
  const freshnessFilter = searchParams.get("freshness") ?? ANY;
  const rawView = searchParams.get("view") ?? "";
  const view: ViewMode =
    rawView in VIEW_MODES ? (rawView as ViewMode) : DEFAULT_VIEW;

  const query = useSecurityObjects();

  const freshnessById = useMemo(() => {
    const map = new Map<string, PassportFreshness>();
    for (const item of query.data?.freshness ?? []) map.set(item.objectId, item);
    return map;
  }, [query.data]);

  // Значения списка регионов — из самого реестра: справочника регионов раздел
  // не отдаёт, а зашитый список расходился бы с данными.
  const regions = useMemo(
    () =>
      [...new Set((query.data?.results ?? []).map((o) => o.region))]
        .filter((value) => value !== "")
        .sort((a, b) => a.localeCompare(b, "ru")),
    [query.data]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data?.results ?? []).filter((o) => {
      if (status !== ANY && o.objectState !== status) return false;
      if (passport !== ANY && o.passportState !== passport) return false;
      if (region !== ANY && o.region !== region) return false;
      if (
        freshnessFilter !== ANY &&
        freshnessById.get(o.id)?.state !== freshnessFilter
      ) {
        return false;
      }
      if (q === "") return true;
      return `${o.name} ${o.code} ${o.address} ${o.region} ${o.type}`
        .toLowerCase()
        .includes(q);
    });
  }, [
    query.data,
    search,
    status,
    passport,
    region,
    freshnessFilter,
    freshnessById,
  ]);

  const activeFilters =
    (status !== ANY ? 1 : 0) +
    (passport !== ANY ? 1 : 0) +
    (region !== ANY ? 1 : 0) +
    (freshnessFilter !== ANY ? 1 : 0) +
    (search.trim() !== "" ? 1 : 0);

  function applyParams(params: URLSearchParams): void {
    const qs = params.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }

  /** Умолчание в URL не пишем — ссылка на нетронутый реестр остаётся чистой. */
  function setParam(name: string, value: string, fallback: string): void {
    const params = new URLSearchParams(searchParams);
    if (value === fallback) params.delete(name);
    else params.set(name, value);
    applyParams(params);
  }

  /** Клик по плитке KPI ставит фильтр, повторный — снимает. */
  function toggleTile(param: { name: string; value: string }): void {
    const current = searchParams.get(param.name) ?? ANY;
    setParam(param.name, current === param.value ? ANY : param.value, ANY);
  }

  function resetFilters(): void {
    const params = new URLSearchParams(searchParams);
    for (const name of ["search", "status", "passport", "region", "freshness"]) {
      params.delete(name);
    }
    applyParams(params);
  }

  if (!permissionsLoading && !hasPermission("object.view")) {
    return <OpsAccessDenied what="реестра объектов" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              Объекты и паспорта
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Объекты и паспорта
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Реестр охраняемых объектов, их паспортов, секторов, постов и
              истории публикаций
            </p>
          </div>
        </header>

        {query.data !== undefined && (
          <section aria-label="Показатели реестра" className="space-y-2">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {KPI_TILES.map((tile) => {
                const value = query.data.kpi[tile.kpi];
                const active =
                  tile.param !== null &&
                  (searchParams.get(tile.param.name) ?? ANY) === tile.param.value;
                const body = (
                  <>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${tile.dot}`}
                      />
                      <span className="truncate text-xs font-medium text-muted-foreground">
                        {tile.label}
                      </span>
                    </span>
                    <span className="mt-2 block text-3xl font-bold tabular-nums leading-none">
                      {value}
                    </span>
                    <span className="mt-2 block text-[11px] text-muted-foreground">
                      {tile.hint}
                    </span>
                  </>
                );
                if (tile.param === null) {
                  return (
                    <div
                      key={tile.key}
                      className="rounded-xl border bg-card p-4 shadow-xs"
                    >
                      {body}
                    </div>
                  );
                }
                const param = tile.param;
                return (
                  <button
                    key={tile.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleTile(param)}
                    className={`rounded-xl border p-4 text-left shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      active
                        ? "border-primary bg-primary/10"
                        : "bg-card hover:bg-muted/40"
                    }`}
                  >
                    {body}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Показатели посчитаны сервером по всему реестру, а не по
              отрисованной таблице. Срок проверки — по политике{" "}
              {query.data.freshnessPolicy.version}:{" "}
              {query.data.freshnessPolicy.verificationIntervalDays} дней с даты
              публикации, предупреждение — за{" "}
              {query.data.freshnessPolicy.dueSoonPercent}% интервала до срока.
            </p>
          </section>
        )}

        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-[14rem] flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9"
                aria-label="Поиск по реестру объектов"
                placeholder="Поиск по названию, адресу, рег. номеру или типу"
                value={search}
                onChange={(e) => setParam("search", e.target.value, "")}
              />
            </div>

            <FilterSelect
              label="Статус"
              value={status}
              onChange={(value) => setParam("status", value, ANY)}
              options={(Object.keys(OBJECT_STATE_LABEL) as ObjectState[]).map(
                (key) => ({ value: key, label: OBJECT_STATE_LABEL[key] })
              )}
            />
            <FilterSelect
              label="Паспорт"
              value={passport}
              onChange={(value) => setParam("passport", value, ANY)}
              options={PASSPORT_STATES.map((key) => ({
                value: key,
                label: PASSPORT_STATE_LABEL[key],
              }))}
            />
            <FilterSelect
              label="Регион"
              value={region}
              onChange={(value) => setParam("region", value, ANY)}
              options={regions.map((value) => ({ value, label: value }))}
            />

            <div
              role="group"
              aria-label="Вид реестра"
              className="ml-auto flex items-center gap-1 rounded-lg bg-muted p-1"
            >
              {(Object.keys(VIEW_MODES) as ViewMode[]).map((mode) => {
                const Icon = VIEW_MODES[mode].icon;
                return (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={view === mode ? "default" : "ghost"}
                    aria-pressed={view === mode}
                    onClick={() => setParam("view", mode, DEFAULT_VIEW)}
                  >
                    <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                    {VIEW_MODES[mode].label}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Реестр объектов
              {query.data !== undefined && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {filtered.length} из {query.data.kpi.total}
                </span>
              )}
            </h2>
            {activeFilters > 0 && (
              <Button size="sm" variant="outline" onClick={resetFilters}>
                Сбросить фильтры ({activeFilters})
              </Button>
            )}
          </div>

          <ObjectsRegistry
            view={view}
            isLoading={query.isLoading}
            isError={query.isError}
            objects={filtered}
            freshnessById={freshnessById}
          />
        </div>

        {query.data !== undefined && (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="p-4">
              <h2 className="mb-2 text-sm font-semibold">
                Колонки прототипа, которых нет в модели
              </h2>
              <ul className="flex flex-col gap-2">
                {query.data.unavailableKpi.map((metric) => (
                  <li key={metric.code} className="text-xs text-muted-foreground">
                    <span className="font-semibold">{metric.label}</span> —{" "}
                    {metric.reason}
                  </li>
                ))}
                {UNAVAILABLE_COLUMNS.map((column) => (
                  <li key={column.label} className="text-xs text-muted-foreground">
                    <span className="font-semibold">{column.label}</span> —{" "}
                    {column.reason}
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

/**
 * Колонки прототипа, под которыми в срезе нет ни поля модели, ни связи.
 * Печатаются рядом с серверным `unavailableKpi` и тем же текстом причины:
 * пустая колонка в таблице читалась бы как «данных нет у объекта», а не как
 * «признака нет в системе».
 */
const UNAVAILABLE_COLUMNS: ReadonlyArray<{ label: string; reason: string }> = [
  {
    label: "Ответственный (старший объекта)",
    reason:
      "У объекта нет связи с сотрудником: ни поля ответственного, ни закрепления за должностью в модели раздела нет.",
  },
  {
    label: "Процент заполнения паспорта",
    reason:
      "Полнота паспорта не моделируется: обязательного состава разделов, по которому её считать, в срезе не задано.",
  },
  {
    label: "Ближайшее охранное мероприятие",
    reason:
      "ОМ ссылается на объект, но обратной выборки «ближайшее мероприятие по объекту» реестр не отдаёт — считать её на клиенте значило бы грузить весь реестр ОМ.",
  },
  {
    label: "Принадлежность объекта (собственный / охраняемый / объект ОМ)",
    reason:
      "Признака принадлежности у объекта нет — вкладки прототипа делили бы реестр по несуществующему полю.",
  },
];

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-[9.75rem]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{label}: все</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Загрузка, отказ и пустой реестр не зависят от режима показа: развилка на
 * таблицу и карточки стоит ПОСЛЕ них, иначе переключатель менял бы вид
 * сообщения об ошибке. */
function ObjectsRegistry({
  view,
  isLoading,
  isError,
  objects,
  freshnessById,
}: {
  view: ViewMode;
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
  return view === "cards" ? (
    <ObjectsCards objects={objects} freshnessById={freshnessById} />
  ) : (
    <ObjectsTable objects={objects} freshnessById={freshnessById} />
  );
}

const HEAD_CLASS =
  "whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

function ObjectsTable({
  objects,
  freshnessById,
}: {
  objects: SecurityObject[];
  freshnessById: Map<string, PassportFreshness>;
}) {
  return (
    <Card className="overflow-hidden py-0">
      {/* колонок прототипа больше, чем влезает в узкое окно: прокрутка
          горизонтальная и только у таблицы — страница вбок не едет */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD_CLASS}>Объект</TableHead>
              <TableHead className={HEAD_CLASS}>Регион / адрес</TableHead>
              <TableHead className={HEAD_CLASS}>Рег. №</TableHead>
              <TableHead className={`${HEAD_CLASS} text-right`}>Секторы</TableHead>
              <TableHead className={`${HEAD_CLASS} text-right`}>Посты</TableHead>
              <TableHead className={HEAD_CLASS}>Паспорт</TableHead>
              <TableHead className={HEAD_CLASS}>Версия</TableHead>
              <TableHead className={HEAD_CLASS}>Актуализация</TableHead>
              <TableHead className={HEAD_CLASS}>Статус</TableHead>
              <TableHead className={HEAD_CLASS}>
                <span className="sr-only">Действия</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {objects.map((object) => {
              const version = latestVersion(object);
              return (
                <TableRow key={object.id}>
                  <TableCell className="min-w-[15rem]">
                    <Link
                      href={`/security-ops/objects/${object.id}`}
                      className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block font-semibold leading-snug">
                        {object.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {object.type}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="min-w-[12rem] text-sm">
                    <span className="block">{object.region}</span>
                    <span className="block text-xs text-muted-foreground">
                      {object.address}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {object.code}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {object.sectors.length}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {countPosts(object)}
                  </TableCell>
                  <TableCell>
                    <PassportStateBadge state={object.passportState} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {version === null ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      <>
                        <span className="block text-sm font-semibold tabular-nums">
                          v{version.versionNumber}
                        </span>
                        <span className="block text-[11px] text-muted-foreground tabular-nums">
                          от {formatDate(version.effectiveFrom)}
                        </span>
                      </>
                    )}
                  </TableCell>
                  {/* состояние паспорта и его актуальность — разные поля */}
                  <TableCell className="min-w-[11rem]">
                    <FreshnessCell freshness={freshnessById.get(object.id)} />
                  </TableCell>
                  <TableCell>
                    <Badge className={OBJECT_STATE_CLASS[object.objectState]}>
                      {OBJECT_STATE_LABEL[object.objectState]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/security-ops/objects/${object.id}`}
                      aria-label={`Открыть объект ${object.name}`}
                      className="inline-flex rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/** Карточный вид прототипа: та же строка реестра, разложенная на плитку.
 * Колонки таблицы сохранены целиком — тип, адрес, состояние паспорта и срок
 * проверки, — плюс расчёт секторов и постов, который в таблицу не помещался. */
function ObjectsCards({
  objects,
  freshnessById,
}: {
  objects: SecurityObject[];
  freshnessById: Map<string, PassportFreshness>;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {objects.map((object) => {
        const posts = countPosts(object);
        const CoverIcon = coverIcon(object.type);
        return (
          <li key={object.id}>
            <Card className="h-full overflow-hidden transition-colors hover:border-primary/50">
              {/* Обложка декоративна: код и тип объекта есть текстом ниже,
                  поэтому для скринридера её содержимое — шум. */}
              <div
                aria-hidden="true"
                className={`flex h-24 shrink-0 items-center justify-center ${coverTint(object.code)}`}
              >
                <CoverIcon className="h-10 w-10" strokeWidth={1.5} />
              </div>
              {/* flex-1, а не h-full: Card здесь — флекс-колонка, и «высота во
                  все 100%» требовала бы полной высоты карточки ПОМИМО обложки,
                  из-за чего обложку сжимало с 96px до 69px. */}
              <CardContent className="flex flex-1 flex-col gap-3 p-4">
                <Link
                  href={`/security-ops/objects/${object.id}`}
                  className="flex flex-col gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="inline-flex w-fit rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold">
                    {object.code}
                  </span>
                  <span className="font-semibold leading-snug">{object.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {object.type} · {object.region} · {object.address}
                  </span>
                </Link>

                <div className="flex flex-wrap items-center gap-2">
                  <PassportStateBadge state={object.passportState} />
                  <Badge className={OBJECT_STATE_CLASS[object.objectState]}>
                    {OBJECT_STATE_LABEL[object.objectState]}
                  </Badge>
                </div>

                {/* прижимаем подвал к низу: карточки в ряду разной высоты */}
                <dl className="mt-auto grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-muted-foreground">Секторы и посты</dt>
                    <dd className="font-semibold tabular-nums">
                      {object.sectors.length} / {posts}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-muted-foreground">Срок проверки</dt>
                    <dd>
                      <FreshnessCell freshness={freshnessById.get(object.id)} />
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
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
      {freshness.verificationDueAt === null ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <span className="text-sm font-medium tabular-nums">
          до {formatDate(freshness.verificationDueAt)}
        </span>
      )}
      <span className={`text-[11px] ${FRESHNESS_CLASS[freshness.state]}`}>
        {FRESHNESS_LABEL[freshness.state]}
      </span>
    </div>
  );
}
