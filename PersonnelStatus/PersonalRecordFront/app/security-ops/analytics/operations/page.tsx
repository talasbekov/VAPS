"use client";

// Аналитика ОМ (§22.13–22.15) по экрану прототипа Smart Josparlau.
//
// Экран не считает и не решает, что с чем сопоставимо: колонки уровня, строки,
// распределение по lifecycle, воронку, breadcrumb и карточку ОМ присылает
// сервер одним снимком. Всё, что делает страница поверх ответа, — складывает
// колонки строк ТОГО ЖЕ снимка и делит одно серверное число на другое
// (обеспеченность, конверсия, доли доната). Своего источника у неё нет.
//
// Перенесено из прототипа только то, чему источник нашёлся: показатели шапки,
// структура мероприятий, воронка этапов, обеспеченность личным составом,
// таблица объектов с детализацией и карточка ОМ. Остальные блоки прототипа
// (динамика по дням, участие департаментов, замены, план/факт, нагрузка,
// инциденты в разрезе тяжести, «требует внимания», экспорт) названы вслух
// внизу экрана — рисовать их пустыми ячейками значило бы выдать отсутствие
// данных за нули.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Layers,
  ListChecks,
  PlayCircle,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { useOperationsAnalytics } from "@/hooks/use-ops-analytics";
import type {
  FunnelView,
  LifecycleBucket,
  OpsBreadcrumbItem,
  OpsEventCard,
  OpsLevel,
  OpsRow,
  OperationsAnalyticsData,
} from "@/entities/service-analytics";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { OpsKpiCards } from "@/widgets/ops-kpi-cards";
import type { OpsKpiItem } from "@/widgets/ops-kpi-cards";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

const LEVELS: readonly OpsLevel[] = ["ALL", "OBJECT", "EVENT", "DIRECTION", "POST"];

/** §22.15: в URL едут стабильные ID, а не подписи. */
const LEVEL_PARAM: Record<OpsLevel, string | null> = {
  ALL: null,
  OBJECT: "object",
  EVENT: "event",
  DIRECTION: "direction",
  POST: "post",
};

/** Подпись таблицы детализации по уровню: сервер называет строки, но не
 * набор — «объекты» и «посты» под общим заголовком «Детализация» читались бы
 * как одно и то же. */
const DETAIL_TITLE: Record<OpsLevel, string> = {
  ALL: "Аналитика объектов",
  OBJECT: "Мероприятия на объекте",
  EVENT: "Направления мероприятия",
  DIRECTION: "Посты направления",
  POST: "Участие по посту",
};

/** Терминальные состояния реестра lifecycle. Отдельно от остальных они нужны
 * ровно двум плиткам; списка «этапов подготовки» здесь НЕТ намеренно — он
 * приходит с сервера, и повторять его тут значило бы завести второй реестр. */
const CONDUCT_STATE = "CONDUCT";
const CLOSED_STATE = "CLOSED";

/** Палитра долей доната. Цвет — оформление, а не смысл: порядок долей задаёт
 * сервер, палитра лишь идёт по кругу. */
const DONUT_COLORS: readonly string[] = [
  "hsl(221 83% 53%)",
  "hsl(199 89% 48%)",
  "hsl(160 84% 39%)",
  "hsl(142 71% 45%)",
  "hsl(48 96% 53%)",
  "hsl(38 92% 50%)",
  "hsl(25 95% 53%)",
  "hsl(0 84% 60%)",
  "hsl(215 16% 47%)",
];

export default function OperationsAnalyticsPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  // §22.6: уровень детализации живёт в URL и переживает перезагрузку.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const objectId = searchParams.get("object") ?? undefined;
  const eventId = searchParams.get("event") ?? undefined;
  const directionId = searchParams.get("direction") ?? undefined;
  const postId = searchParams.get("post") ?? undefined;

  const level: OpsLevel =
    postId !== undefined
      ? "POST"
      : directionId !== undefined
        ? "DIRECTION"
        : eventId !== undefined
          ? "EVENT"
          : objectId !== undefined
            ? "OBJECT"
            : "ALL";

  const query = useOperationsAnalytics({
    level,
    objectId,
    eventId,
    directionId,
    postId,
  });
  const data = query.data?.data;
  const snapshot = query.data;

  // Отметка свежести рисуется ТОЛЬКО после монтирования: время ответа в
  // разметке сервера и в браузере разное, и печать его напрямую давала бы
  // hydration mismatch (этот дефект уже чинили на /dashboard).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const freshness =
    mounted && query.dataUpdatedAt > 0
      ? `данные на ${new Date(query.dataUpdatedAt).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : null;

  function goTo(target: OpsLevel, id: string | null): void {
    const next = new URLSearchParams(searchParams);
    // Уровни ниже целевого сбрасываются: путь иначе указывал бы на пост
    // чужого направления, и сервер отдал бы отказ вместо перехода.
    for (const item of LEVELS.slice(LEVELS.indexOf(target))) {
      const param = LEVEL_PARAM[item];
      if (param !== null) next.delete(param);
    }
    const param = LEVEL_PARAM[target];
    if (param !== null && id !== null) next.set(param, id);
    const queryString = next.toString();
    router.replace(queryString === "" ? pathname : `${pathname}?${queryString}`);
  }

  if (!permissionsLoading && !hasPermission("analytics.operations")) {
    return <OpsAccessDenied what="аналитики ОМ" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <Layers className="h-8 w-8 text-primary-ink" />
            <div>
              <h1 className="text-2xl font-bold">Аналитика мероприятий</h1>
              <p className="text-muted-foreground">
                Подготовка, обеспеченность, расстановка, проведение, конфликты и
                результаты охранных мероприятий
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {freshness !== null && (
              <span className="text-xs text-muted-foreground">{freshness}</span>
            )}
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? "Обновление…" : "Обновить"}
            </Button>
          </div>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Разделы аналитики">
          <Link
            href="/security-ops/analytics"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Аналитика службы
          </Link>
          <span className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Аналитика мероприятий
          </span>
          <Link
            href="/security-ops/ratings/analytics"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Аналитика рейтинга
          </Link>
        </nav>

        {data !== undefined && (
          <div className="flex flex-wrap items-center gap-2">
            <nav
              aria-label="Путь детализации"
              className="flex flex-wrap items-center gap-1"
            >
              {data.breadcrumb.map((item: OpsBreadcrumbItem, index) => (
                <span
                  key={`${item.level}:${item.id ?? "root"}`}
                  className="flex items-center gap-1"
                >
                  {index > 0 && (
                    <span className="text-xs text-muted-foreground">/</span>
                  )}
                  <button
                    type="button"
                    className={
                      index === data.breadcrumb.length - 1
                        ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                        : "rounded-md border px-3 py-1.5 text-sm"
                    }
                    onClick={() => goTo(item.level, item.id)}
                  >
                    {item.safeLabel}
                  </button>
                </span>
              ))}
            </nav>
            {data.level !== "ALL" && (
              <Button variant="outline" onClick={() => goTo("ALL", null)}>
                Вернуться ко всем мероприятиям
              </Button>
            )}
          </div>
        )}

        {snapshot !== undefined && (
          <p className="text-[11px] text-muted-foreground">
            Дата раздела — {snapshot.businessDate} ({snapshot.timezone}). Период
            снимка: {snapshot.period.from} — {snapshot.period.to}. Расчёт{" "}
            {snapshot.calculationVersion}.
          </p>
        )}

        {query.error !== null && (
          /* Сырое серверное сообщение человеку не адресовано: у мутаций
             5xx уже обезличивается (use-ops-mutation), у запросов такой
             развилки не было. Плюс повтор — раньше это был тупик. */
          <LoadFailure
            what="аналитику по подразделениям"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        )}
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка аналитики…</p>
        )}

        {data !== undefined && (
          <>
            <HeadlineKpi data={data} />

            {data.eventCard !== null && <EventCardSection card={data.eventCard} />}

            <StructureSection data={data} />

            <FunnelCard data={data} />

            <ProvisionSection data={data} />

            {/* Ключ — ИДЕНТИЧНОСТЬ таблицы (уровень и его цель), а не версия
                данных: при переходе на другой уровень это другая таблица с
                другими колонками, и поиск с сортировкой прошлого уровня
                скрыли бы там все строки. Обновление снимка того же уровня
                ключ не трогает — состояние поиска переживает рефетч. */}
            <DetailSection
              key={`${data.level}:${data.breadcrumb[data.breadcrumb.length - 1]?.id ?? "root"}`}
              data={data}
              onDrill={goTo}
            />

            <MissingSection data={data} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Показатели шапки                                                    */
/* ------------------------------------------------------------------ */

/** Плитки прототипа. Считаются сложением колонок ТЕХ ЖЕ строк, что и таблица
 * ниже: второй запрос дал бы второй снимок, и шапка разошлась бы с таблицей.
 *
 * Уровни направления и поста своих мероприятий не образуют — колонки `EVENTS`
 * там нет вовсе, и ряд не рисуется: числа поста под подписью «всего
 * мероприятий» были бы неправдой. */
function HeadlineKpi({ data }: { data: OperationsAnalyticsData }) {
  const items = useMemo<OpsKpiItem[] | null>(() => {
    if (!hasColumn(data, "EVENTS")) return null;

    const events = columnTotal(data, "EVENTS");
    const requested = columnTotal(data, "REQUESTED");
    const allocated = columnTotal(data, "ALLOCATED");
    const assigned = columnTotal(data, "ASSIGNED");
    const acknowledged = columnTotal(data, "ACKNOWLEDGED");
    const conflicts = columnTotal(data, "CONFLICTS");
    const incidents = columnTotal(data, "INCIDENTS");

    // Состояния берутся по коду из распределения сервера. Отсутствие кода —
    // прочерк с причиной, а не ноль: ноль здесь читался бы как «ни одного
    // мероприятия на этом этапе нет».
    const conduct = bucketOf(data.lifecycleDistribution, CONDUCT_STATE);
    const closed = bucketOf(data.lifecycleDistribution, CLOSED_STATE);
    const lifecycleTotal = data.lifecycleDistribution.reduce(
      (sum, bucket) => sum + bucket.count,
      0
    );
    // «В подготовке» — всё, что не проводится и не закрыто. Список этапов
    // подготовки не перечисляется: он принадлежит реестру lifecycle сервера.
    const inPreparation =
      conduct === null || closed === null
        ? null
        : lifecycleTotal - conduct.count - closed.count;

    return [
      {
        key: "events",
        label: "Всего мероприятий",
        value: numberOrDash(events),
        hint: `в разрезе — ${formatNumber(data.rows.length)} ${pluralRows(data.level, data.rows.length)}`,
        icon: ListChecks,
        iconClass: "text-primary-ink",
      },
      {
        key: "preparation",
        label: "В подготовке",
        value: numberOrDash(inPreparation),
        hint:
          inPreparation === null
            ? "в реестре состояний нет терминальных этапов"
            : "этапы до проведения",
        icon: Activity,
        iconClass: "text-primary-ink",
      },
      {
        key: "conduct",
        label: "Проводится",
        value: conduct === null ? "—" : formatNumber(conduct.count),
        hint:
          conduct === null
            ? "состояния «проведение» нет в реестре"
            : conduct.safeLabel,
        icon: PlayCircle,
        iconClass: "text-green-600",
      },
      {
        key: "closed",
        label: "Закрыто",
        value: closed === null ? "—" : formatNumber(closed.count),
        hint:
          closed === null ? "состояния «закрыто» нет в реестре" : closed.safeLabel,
        icon: CheckCircle2,
        iconClass: "text-muted-foreground",
      },
      {
        key: "provision",
        label: "Обеспеченность",
        value: percentOrDash(allocated, requested),
        hint:
          requested === null || requested === 0
            ? "запросов сил нет"
            : `выделено ${formatNumber(allocated ?? 0)} из ${formatNumber(requested)}`,
        icon: UserCheck,
        iconClass: "text-primary-ink",
      },
      {
        key: "acknowledged",
        label: "Ознакомлено",
        value: percentOrDash(acknowledged, assigned),
        hint:
          assigned === null || assigned === 0
            ? "назначений нет"
            : `${formatNumber(acknowledged ?? 0)} из ${formatNumber(assigned)} назначений`,
        icon: UserCheck,
        iconClass: "text-green-600",
      },
      {
        key: "conflicts",
        label: "Конфликты",
        value: numberOrDash(conflicts),
        hint: "обнаружено при расстановке",
        icon: ShieldAlert,
        iconClass:
          conflicts !== null && conflicts > 0
            ? "text-red-600"
            : "text-muted-foreground",
      },
      {
        key: "incidents",
        label: "Записи об инцидентах",
        value: numberOrDash(incidents),
        hint: "журнал штаба, без деления на открытые",
        icon: AlertTriangle,
        iconClass:
          incidents !== null && incidents > 0
            ? "text-amber-600"
            : "text-muted-foreground",
      },
    ];
  }, [data]);

  if (items === null) return null;
  return <OpsKpiCards items={items} />;
}

/* ------------------------------------------------------------------ */
/* Структура мероприятий                                               */
/* ------------------------------------------------------------------ */

/** Донат прототипа построен по СОСТОЯНИЯМ жизненного цикла, а не по типам ОМ:
 * типа у мероприятия модель не хранит (см. раздел «чего нет»). Заголовок
 * прототипа сохранён, подпись называет ось честно. */
function StructureSection({ data }: { data: OperationsAnalyticsData }) {
  const buckets = data.lifecycleDistribution;
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (buckets.length === 0) return null;
  // Ниже уровня объекта множества мероприятий нет: распределение одного ОМ —
  // это его состояние, и оно уже стоит фактом в карточке. Донат из одного
  // сектора выдавал бы частный случай за структуру.
  if (data.level !== "ALL" && data.level !== "OBJECT") return null;

  // Границы долей считаются нарастающим итогом: conic-gradient принимает
  // абсолютные углы, а не длины секторов.
  let offset = 0;
  const stops: string[] = [];
  const legend = buckets.map((bucket, index) => {
    const color = DONUT_COLORS[index % DONUT_COLORS.length];
    const share = total === 0 ? 0 : (bucket.count / total) * 100;
    stops.push(`${color} ${offset.toFixed(3)}% ${(offset + share).toFixed(3)}%`);
    offset += share;
    return { bucket, color, share };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Структура мероприятий</CardTitle>
        <p className="text-xs text-muted-foreground">
          Распределение по состояниям жизненного цикла — типа мероприятия модель
          не хранит
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-6">
          <div
            className="relative h-40 w-40 shrink-0 rounded-full"
            role="img"
            aria-label={`Всего мероприятий: ${total}`}
            style={{
              background:
                total === 0
                  ? "hsl(var(--muted))"
                  : `conic-gradient(${stops.join(", ")})`,
            }}
          >
            <span className="absolute inset-[22%] grid place-items-center rounded-full bg-card text-center">
              <span>
                <span className="block text-[11px] text-muted-foreground">
                  Всего
                </span>
                <span className="block text-xl font-bold tabular-nums">
                  {formatNumber(total)}
                </span>
              </span>
            </span>
          </div>
          <ul className="min-w-[16rem] flex-1 space-y-1">
            {legend.map(({ bucket, color, share }) => (
              <li
                key={bucket.stateCode}
                className="flex items-baseline gap-2 border-b py-1 text-sm last:border-0"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: color }}
                />
                <span className="flex-1">{bucket.safeLabel}</span>
                <b className="tabular-nums">{formatNumber(bucket.count)}</b>
                <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                  {total === 0 ? "—" : formatPercent(share)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {data.unknownLifecycleCodes.length > 0 && (
          // §22.13: код вне реестра назван, а не разложен по корзинам.
          <p className="mt-2 text-xs text-destructive-ink">
            Состояния вне Lifecycle Registry (не разложены по корзинам):{" "}
            {data.unknownLifecycleCodes.join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Воронка этапов                                                      */
/* ------------------------------------------------------------------ */

function FunnelCard({ data }: { data: OperationsAnalyticsData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {data.level === "EVENT"
            ? "Прохождение этапов мероприятия"
            : "Прохождение этапов подготовки"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Количество мероприятий и среднее время прохождения каждого этапа
        </p>
      </CardHeader>
      <CardContent>
        {data.funnel === null ? (
          <p className="text-sm text-muted-foreground">
            {data.funnelUnavailableReason}
          </p>
        ) : (
          <FunnelSection funnel={data.funnel} />
        )}
      </CardContent>
    </Card>
  );
}

/** §22.14: показатели воронки НЕ рисуются вместе — у них разные единицы.
 * Режим «Воронка» показывает выбранный показатель полосами, режим «Таблица» —
 * все шесть столбцами: складывать часы с мероприятиями нельзя, а читать
 * рядом можно. */
function FunnelSection({ funnel }: { funnel: FunnelView }) {
  const [measureCode, setMeasureCode] = useState(funnel.measures[0]?.code ?? "");
  const [asTable, setAsTable] = useState(false);
  const measure =
    funnel.measures.find((item) => item.code === measureCode) ?? funnel.measures[0];

  const values = funnel.stages.map((stage) =>
    measure === undefined ? null : stage.values[measure.code]
  );
  const maxValue = values.reduce<number>(
    (max, value) => (value === null || value === undefined ? max : Math.max(max, value)),
    0
  );
  // Конверсия — доля от ПЕРВОГО этапа воронки, а не от соседнего: у прототипа
  // столбец называется «Конверсия», и считать её от предыдущего этапа значило
  // бы показать другое число под тем же заголовком.
  const baseReached = funnel.stages[0]?.values.REACHED ?? null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          {funnel.measures.map((item) => (
            <button
              key={item.code}
              type="button"
              className={
                item.code === measure?.code
                  ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                  : "rounded-md border px-3 py-1.5 text-sm"
              }
              onClick={() => setMeasureCode(item.code)}
            >
              {item.safeLabel}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={
              asTable
                ? "rounded-md border px-3 py-1.5 text-sm"
                : "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            }
            onClick={() => setAsTable(false)}
          >
            Воронка
          </button>
          <button
            type="button"
            className={
              asTable
                ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                : "rounded-md border px-3 py-1.5 text-sm"
            }
            onClick={() => setAsTable(true)}
          >
            Таблица
          </button>
        </div>
      </div>

      {asTable ? (
        <Table className="min-w-[42rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Этап</TableHead>
              <TableHead>Конверсия</TableHead>
              {funnel.measures.map((item) => (
                <TableHead key={item.code}>{item.safeLabel}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {funnel.stages.map((stage) => (
              <TableRow key={stage.stateCode}>
                <TableCell>{stage.safeLabel}</TableCell>
                <TableCell className="tabular-nums">
                  {percentOrDash(stage.values.REACHED ?? null, baseReached)}
                </TableCell>
                {funnel.measures.map((item) => {
                  const value = stage.values[item.code];
                  return (
                    <TableCell key={item.code} className="tabular-nums">
                      {value === null || value === undefined ? (
                        <span className="text-xs text-muted-foreground">
                          нет готового значения
                        </span>
                      ) : (
                        formatNumber(value)
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ul className="flex flex-col gap-2">
          {funnel.stages.map((stage, index) => {
            const value = values[index];
            const width =
              value === null || value === undefined || maxValue === 0
                ? 0
                : (value / maxValue) * 100;
            return (
              <li key={stage.stateCode}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{stage.safeLabel}</span>
                  <span className="flex items-baseline gap-3">
                    <span className="text-xs text-muted-foreground">
                      конверсия{" "}
                      {percentOrDash(stage.values.REACHED ?? null, baseReached)}
                    </span>
                    <span className="tabular-nums">
                      {value === null || value === undefined ? (
                        <span className="text-xs text-muted-foreground">
                          нет готового значения
                        </span>
                      ) : (
                        `${formatNumber(value)} ${measure?.unit ?? ""}`
                      )}
                    </span>
                  </span>
                </div>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${width}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Построено по журналу переходов: событий — {funnel.transitionCount}.{" "}
        {funnel.exclusionNote}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Столбцов прототипа «Просрочено» и «Ответственный» здесь нет: плановых
        сроков у этапов модель не хранит, а исполнителя перехода журнал пишет
        как учётную запись, не как роль этапа.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Обеспеченность личным составом                                      */
/* ------------------------------------------------------------------ */

/** Цепочка прототипа «Запрошено / Выделено / Подтверждено / Прибыло» на живых
 * данных короче и называется точнее: подтверждения и прибытия модель не ведёт
 * (см. «чего нет»), зато перед запросом стоит утверждённая потребность, а
 * после назначения — ознакомление. */
const PROVISION_STEPS: readonly { code: string; label: string }[] = [
  { code: "DEMAND_NEED", label: "Утверждённая потребность" },
  { code: "REQUESTED", label: "Запрошено" },
  { code: "ALLOCATED", label: "Выделено" },
  // «Требуется по расчёту» — потребность уровня мероприятия и ниже; с
  // утверждённой потребностью выше она в одном ответе не встречается, поэтому
  // цепочка не двоится.
  { code: "NEED", label: "Требуется по расчёту" },
  { code: "ASSIGNED", label: "Назначено" },
  { code: "ACKNOWLEDGED", label: "Ознакомлено" },
];

function ProvisionSection({ data }: { data: OperationsAnalyticsData }) {
  const steps = PROVISION_STEPS.filter((step) => hasColumn(data, step.code)).map(
    (step) => ({ ...step, value: columnTotal(data, step.code) })
  );
  if (steps.length === 0) return null;
  const base = steps.reduce((max, step) => Math.max(max, step.value ?? 0), 0);

  // Разрез — это строки текущего уровня, а не свой запрос: другого живого
  // разреза (департаменты, направления службы) у аналитики ОМ нет.
  const breakdown = [...data.rows]
    .map((row) => ({
      row,
      need: cellValue(row, steps[0].code) ?? 0,
      covered: cellValue(row, steps[steps.length - 1].code) ?? 0,
    }))
    .sort((a, b) => b.need - a.need)
    .slice(0, 6);
  const breakdownBase = breakdown.reduce(
    (max, item) => Math.max(max, item.need, item.covered),
    0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Обеспеченность личным составом</CardTitle>
        <p className="text-xs text-muted-foreground">
          {steps.map((step) => step.label).join(" / ")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {steps.map((step) => (
            <li key={step.code}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{step.label}</span>
                <b className="tabular-nums">{numberOrDash(step.value)}</b>
              </div>
              <span className="mt-1 block h-2.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{
                    width:
                      base === 0 || step.value === null
                        ? "0%"
                        : `${(step.value / base) * 100}%`,
                  }}
                />
              </span>
            </li>
          ))}
        </ul>

        {breakdown.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              В разрезе {BREAKDOWN_LABEL[data.level]}: «{steps[0].label}» и «
              {steps[steps.length - 1].label}», шесть наибольших
            </p>
            <ul className="space-y-2">
              {breakdown.map(({ row, need, covered }) => (
                <li key={row.rowId}>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate">{row.safeLabel}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatNumber(covered)} из {formatNumber(need)}
                    </span>
                  </div>
                  {/* Две полосы, а не одна: доля закрашенной части внутри
                      общей читалась бы как процент обеспеченности, а это
                      разные величины — потребность и ознакомление. */}
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary/40"
                      style={{
                        width:
                          breakdownBase === 0
                            ? "0%"
                            : `${(need / breakdownBase) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{
                        width:
                          breakdownBase === 0
                            ? "0%"
                            : `${(covered / breakdownBase) * 100}%`,
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Карточка мероприятия                                                */
/* ------------------------------------------------------------------ */

function EventCardSection({ card }: { card: OpsEventCard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {card.code} — {card.safeLabel}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Факты мероприятия из его карточки; чего в модели нет — названо на самом
          факте
        </p>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {card.facts.map((fact) => (
            <div key={fact.code} className="rounded-lg border p-3">
              <dt className="text-[11px] font-semibold text-muted-foreground">
                {fact.safeLabel}
              </dt>
              <dd
                className={
                  fact.unavailableReason === null
                    ? "text-lg font-bold"
                    : "text-lg font-bold text-muted-foreground"
                }
              >
                {fact.displayValue}
              </dd>
              {fact.unavailableReason !== null && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {fact.unavailableReason}
                </p>
              )}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Детализация                                                         */
/* ------------------------------------------------------------------ */

interface SortState {
  code: string;
  desc: boolean;
}

function DetailSection({
  data,
  onDrill,
}: {
  data: OperationsAnalyticsData;
  onDrill: (level: OpsLevel, id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered =
      needle === ""
        ? data.rows
        : data.rows.filter((row) => row.safeLabel.toLowerCase().includes(needle));
    if (sort === null) return filtered;
    // Сортировка — по уже полученным строкам снимка; порядок сервера
    // возвращается третьим щелчком, чтобы «как отдал сервер» оставался
    // достижимым состоянием, а не терялся после первого клика.
    return [...filtered].sort((a, b) => {
      const left = cellValue(a, sort.code);
      const right = cellValue(b, sort.code);
      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return sort.desc ? right - left : left - right;
    });
  }, [data.rows, search, sort]);

  function toggleSort(code: string): void {
    setSort((current) => {
      if (current === null || current.code !== code) return { code, desc: true };
      if (current.desc) return { code, desc: false };
      return null;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{DETAIL_TITLE[data.level]}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Строки и колонки задаёт сервер; поиск и порядок применяются к уже
              полученному снимку
            </p>
          </div>
          <Input
            className="w-full sm:w-64"
            placeholder="Поиск по названию"
            aria-label="Поиск по названию"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table className="min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Строка</TableHead>
              {data.columns.map((column) => (
                // `aria-sort` — единственный признак порядка, доступный не
                // глазами: стрелка ниже помечена `aria-hidden`, и без этого
                // атрибута отсортированная колонка ничем не отличалась бы от
                // прочих для программы чтения с экрана.
                <TableHead
                  key={column.code}
                  aria-sort={
                    sort?.code !== column.code
                      ? "none"
                      : sort.desc
                        ? "descending"
                        : "ascending"
                  }
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 uppercase hover:text-foreground"
                    onClick={() => toggleSort(column.code)}
                  >
                    {column.safeLabel}
                    {sort?.code === column.code && (
                      <span aria-hidden>{sort.desc ? "↓" : "↑"}</span>
                    )}
                  </button>
                </TableHead>
              ))}
              <TableHead>
                <span className="sr-only">Переход</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row: OpsRow) => (
              <TableRow key={row.rowId}>
                <TableCell>{row.safeLabel}</TableCell>
                {data.columns.map((column) => {
                  const cell = row.cells.find((item) => item.code === column.code);
                  return (
                    <TableCell key={column.code} className="tabular-nums">
                      {cell === undefined || cell.value === null ? (
                        <span
                          className="text-xs text-muted-foreground"
                          title={cell?.unavailableReason ?? undefined}
                        >
                          нет данных
                        </span>
                      ) : (
                        formatNumber(cell.value)
                      )}
                    </TableCell>
                  );
                })}
                <TableCell>
                  {row.childLevel !== null && (
                    <button
                      type="button"
                      className="rounded-md border px-3 py-1.5 text-sm"
                      onClick={() => onDrill(row.childLevel as OpsLevel, row.rowId)}
                    >
                      Детализировать
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.rows.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            На этом уровне строк нет — источник мероприятий недоступен либо
            уровень пуст.
          </p>
        )}
        {data.rows.length > 0 && rows.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            По запросу «{search}» строк нет.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Чего в этой аналитике нет                                           */
/* ------------------------------------------------------------------ */

/** Блоки прототипа, которым источника нет. Список статический намеренно: это
 * не данные сервера, а решение переноса — почему блок не нарисован. Причины,
 * которые знает сервер (`unavailableMeasures`), печатаются рядом, из ответа. */
const MISSING_BLOCKS: readonly { title: string; reason: string }[] = [
  {
    title: "Период и фильтры (статус, тип, департамент, риск, ответственный)",
    reason:
      "Аналитика ОМ считает снимок на дату раздела и параметров периода не принимает; отфильтровать уже посчитанный снимок на экране значило бы показать долю под подписью целого.",
  },
  {
    title: "Динамика мероприятий по дням, неделям и месяцам",
    reason:
      "Время каждого перехода журнал хранит, но рядами по датам сервер их не отдаёт. Построить ряд здесь из выгруженного реестра — вторая методика рядом с воронкой, считающей по тому же журналу.",
  },
  {
    title: "Структура по типам мероприятий",
    reason:
      "Типа у ОМ модель не хранит — в карточке мероприятия этого поля нет. Донат «Структура мероприятий» построен по состояниям жизненного цикла и назван так же.",
  },
  {
    title: "Участие департаментов",
    reason:
      "Группа в потребности и запросе сил — свободная строка расчёта («ГР-1»), а не подразделение оргструктуры; сложить по ней департаменты нельзя. Назначения расстановки указывают пост и сотрудника, но не его подразделение.",
  },
  {
    title: "Дефицит по мероприятиям",
    reason:
      "Аналитика отдаёт суммы запрошенного и выделенного, а дефицит командный центр считает по КАЖДОМУ запросу сил отдельно: перевыдача в одном запросе не гасит нехватку в другом. Вычесть здесь сумму из суммы значило бы показать под тем же словом другое число.",
  },
  {
    title: "Укомплектованность постов по всем мероприятиям",
    reason:
      "Посты и расчёт живут внутри мероприятия: своды по постам сервер отдаёт с уровня мероприятия и ниже — они в таблице детализации. Сводного по всем ОМ у него нет.",
  },
  {
    title:
      "Столбцы объектов «постов», «сотрудников», «часов», «инцидентов на 100 часов», «средняя подготовка»",
    reason:
      "Часов у назначений расстановки нет вовсе; посты и сотрудники считаются внутри мероприятия, а не по объекту. Средний срок подготовки требует плановых сроков этапов — их модель не хранит.",
  },
  {
    title: "Конфликты по видам и журнал ручных разрешений",
    reason:
      "У мероприятия один счётчик конфликтов; вида конфликта и решения по нему он не несёт, а отдельного журнала разрешений в модели нет.",
  },
  {
    title: "Хронология мероприятия",
    reason:
      "Время каждого перехода журнал хранит, но по отдельному ОМ сервер отдаёт его сводно — этапами и часами в воронке уровня мероприятия, а не строками с датами и исполнителями.",
  },
  {
    title: "Изменения после утверждения (замены) и их причины",
    reason:
      "Замену расстановки модель не отличает от обычной правки: назначения перезаписываются, а история правок для них не ведётся. Причин замены поля нет вовсе.",
  },
  {
    title: "План и факт участия, человеко-часы, нагрузка в ОМ",
    reason:
      "Назначение расстановки — строка без часов: интервалов у постов ОМ нет, и складывать часы не из чего. Нагрузку по сменам считает аналитика службы по своей политике, и её числа не про мероприятия.",
  },
  {
    title: "Требует внимания",
    reason:
      "Детекторы §22.11 живут в аналитике службы, у них своя политика и свои пороги из «Настроек». Второй набор наблюдений здесь спорил бы с ними.",
  },
  {
    title: "Экспорт (PDF, XLSX, изображение дэшборда)",
    reason:
      "Выгрузки у аналитики ОМ нет; служебные отчёты собираются на своём экране, где у файла есть тип, период, ревизия и срок хранения.",
  },
];

function MissingSection({ data }: { data: OperationsAnalyticsData }) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader>
        <CardTitle>Чего в этой аналитике нет</CardTitle>
        <p className="text-xs text-muted-foreground">
          Показатели — со слов сервера, блоки прототипа — решение переноса
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="flex flex-col gap-2">
          {data.unavailableMeasures.map((measure) => (
            <li key={measure.code} className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {measure.label}
              </span>{" "}
              — {measure.reason}
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-2 border-t pt-3">
          {MISSING_BLOCKS.map((block) => (
            <li key={block.title} className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{block.title}</span>{" "}
              — {block.reason}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Счёт и формат                                                       */
/* ------------------------------------------------------------------ */

function hasColumn(data: OperationsAnalyticsData, code: string): boolean {
  return data.columns.some((column) => column.code === code);
}

function cellValue(row: OpsRow, code: string): number | null {
  const cell = row.cells.find((item) => item.code === code);
  return cell === undefined ? null : cell.value;
}

/** Сумма колонки по строкам снимка. `null` — колонки нет на этом уровне либо
 * сервер не дал ни одного значения: ноль здесь читался бы как измеренный. */
function columnTotal(data: OperationsAnalyticsData, code: string): number | null {
  if (!hasColumn(data, code)) return null;
  let total = 0;
  let measured = false;
  for (const row of data.rows) {
    const value = cellValue(row, code);
    if (value !== null) {
      total += value;
      measured = true;
    }
  }
  return measured ? total : null;
}

function bucketOf(
  buckets: readonly LifecycleBucket[],
  code: string
): LifecycleBucket | null {
  return buckets.find((bucket) => bucket.stateCode === code) ?? null;
}

/** Разряды разделяются неразрывным пробелом вручную: `toLocaleString` зависит
 * от ICU, а он у Node и браузера разный — числа разъезжались бы на гидрации. */
function formatNumber(value: number): string {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const [whole, fraction] = rounded.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign === "" ? whole : whole.slice(1);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction === undefined
    ? `${sign}${grouped}`
    : `${sign}${grouped},${fraction}`;
}

function numberOrDash(value: number | null): string {
  return value === null ? "—" : formatNumber(value);
}

function formatPercent(share: number): string {
  return `${share.toFixed(1).replace(".", ",")}%`;
}

/** Доля одного серверного числа в другом. Нет делимого или делителя, либо
 * делитель ноль — прочерк: сто процентов от ничего не бывает. */
function percentOrDash(part: number | null, whole: number | null): string {
  if (part === null || whole === null || whole === 0) return "—";
  return formatPercent((part / whole) * 100);
}

/** Подпись строк уровня: «объекта» на верхнем уровне, «мероприятий» внутри
 * объекта и так далее. Формы русского счёта три, а не две: «2 объектов»
 * читается как опечатка и подрывает доверие к самому числу. */
function pluralRows(level: OpsLevel, count: number): string {
  const forms: Record<OpsLevel, readonly [string, string, string]> = {
    ALL: ["объект", "объекта", "объектов"],
    OBJECT: ["мероприятие", "мероприятия", "мероприятий"],
    EVENT: ["направление", "направления", "направлений"],
    DIRECTION: ["пост", "поста", "постов"],
    POST: ["строка", "строки", "строк"],
  };
  const [one, few, many] = forms[level];
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Подпись разреза обеспеченности: «по объектам», «по мероприятиям» и так
 * далее — заголовок таблицы («Аналитика объектов») в строку разреза не
 * подставляется, он про другое. */
const BREAKDOWN_LABEL: Record<OpsLevel, string> = {
  ALL: "по объектам",
  OBJECT: "по мероприятиям",
  EVENT: "по направлениям",
  DIRECTION: "по постам",
  POST: "по строкам поста",
};
