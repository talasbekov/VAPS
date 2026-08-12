"use client";

// Аналитика ОМ (§22.13, §22.15). Экран не считает и не решает, что с чем
// сопоставимо: колонки уровня, строки, распределение по lifecycle, breadcrumb
// и карточку ОМ присылает сервер.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Layers } from "lucide-react";
import { useOperationsAnalytics } from "@/hooks/use-ops-analytics";
import type {
  FunnelView,
  OpsBreadcrumbItem,
  OpsLevel,
  OpsRow,
} from "@/entities/service-analytics";
import { OpsAccessDenied } from "@/components/ops-access-denied";
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

/** §22.14: показатели воронки НЕ рисуются вместе — у них разные единицы. */
function FunnelSection({ funnel }: { funnel: FunnelView }) {
  const [measureCode, setMeasureCode] = useState(funnel.measures[0]?.code ?? "");
  const measure =
    funnel.measures.find((item) => item.code === measureCode) ?? funnel.measures[0];

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
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
      <ul className="flex flex-col gap-1">
        {funnel.stages.map((stage) => {
          const value = measure === undefined ? null : stage.values[measure.code];
          return (
            <li
              key={stage.stateCode}
              className="flex items-baseline justify-between gap-3 border-b py-1 text-sm last:border-0"
            >
              <span>{stage.safeLabel}</span>
              <span className="tabular-nums">
                {value === null || value === undefined ? (
                  <span className="text-xs text-muted-foreground">
                    нет готового значения
                  </span>
                ) : (
                  `${value} ${measure?.unit ?? ""}`
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Построено по журналу переходов: событий — {funnel.transitionCount}.{" "}
        {funnel.exclusionNote}
      </p>
    </>
  );
}

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
        <div className="flex items-center gap-3">
          <Layers className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Аналитика мероприятий</h1>
            <p className="text-muted-foreground">
              Уровень детализации, колонки и распределение по состояниям считает
              сервер.
            </p>
          </div>
        </div>

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
        )}

        {query.error !== null && (
          <p className="text-sm text-destructive">{query.error.message}</p>
        )}
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка аналитики…</p>
        )}

        {data !== undefined && (
          <>
            {data.lifecycleDistribution.length > 0 && (
              <section
                role="group"
                aria-label="Распределение по состояниям"
                className="rounded-xl border bg-card p-4"
              >
                <h2 className="mb-2 text-sm font-semibold">
                  Распределение по состояниям
                </h2>
                <ul className="flex flex-wrap gap-3">
                  {data.lifecycleDistribution.map((bucket) => (
                    <li
                      key={bucket.stateCode}
                      className="rounded-lg border px-3 py-2 text-xs text-muted-foreground"
                    >
                      <span className="font-semibold text-foreground">
                        {bucket.safeLabel}
                      </span>{" "}
                      <span className="tabular-nums">{bucket.count}</span>
                    </li>
                  ))}
                </ul>
                {data.unknownLifecycleCodes.length > 0 && (
                  // §22.13: код вне реестра назван, а не разложен по корзинам.
                  <p className="mt-2 text-xs text-destructive">
                    Состояния вне Lifecycle Registry (не разложены по корзинам):{" "}
                    {data.unknownLifecycleCodes.join(", ")}
                  </p>
                )}
              </section>
            )}

            <section
              role="group"
              aria-label="Воронка мероприятий"
              className="rounded-xl border bg-card p-4"
            >
              <h2 className="mb-2 text-sm font-semibold">Воронка мероприятий</h2>
              {data.funnel === null ? (
                <p className="text-sm text-muted-foreground">
                  {data.funnelUnavailableReason}
                </p>
              ) : (
                <FunnelSection funnel={data.funnel} />
              )}
            </section>

            {data.eventCard !== null && (
              <section
                role="group"
                aria-label="Карточка мероприятия"
                className="rounded-xl border bg-card p-4"
              >
                <h2 className="mb-2 text-sm font-semibold">
                  {data.eventCard.safeLabel}
                </h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
                  {data.eventCard.facts.map((fact) => (
                    <div key={fact.code} className="contents">
                      <dt className="font-semibold text-muted-foreground">
                        {fact.safeLabel}
                      </dt>
                      <dd
                        className={
                          fact.unavailableReason === null
                            ? ""
                            : "text-muted-foreground"
                        }
                      >
                        {fact.displayValue}
                        {fact.unavailableReason !== null && (
                          <span className="block text-[11px] text-muted-foreground">
                            {fact.unavailableReason}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Детализация</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-semibold">Строка</th>
                      {data.columns.map((column) => (
                        <th key={column.code} className="py-2 pr-3 font-semibold">
                          {column.safeLabel}
                        </th>
                      ))}
                      <th className="py-2 font-semibold">
                        <span className="sr-only">Переход</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row: OpsRow) => (
                      <tr key={row.rowId} className="border-b last:border-0">
                        <td className="py-2 pr-3">{row.safeLabel}</td>
                        {data.columns.map((column) => {
                          const cell = row.cells.find(
                            (item) => item.code === column.code
                          );
                          return (
                            <td key={column.code} className="py-2 pr-3 tabular-nums">
                              {cell === undefined || cell.value === null ? (
                                <span
                                  className="text-xs text-muted-foreground"
                                  title={cell?.unavailableReason ?? undefined}
                                >
                                  нет данных
                                </span>
                              ) : (
                                cell.value
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2">
                          {row.childLevel !== null && (
                            <button
                              type="button"
                              className="rounded-md border px-3 py-1.5 text-sm"
                              onClick={() =>
                                goTo(row.childLevel as OpsLevel, row.rowId)
                              }
                            >
                              Детализировать
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.rows.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  На этом уровне строк нет — источник мероприятий недоступен либо
                  уровень пуст.
                </p>
              )}
            </section>

            <section className="rounded-xl border border-dashed bg-muted/30 p-4">
              <h2 className="mb-2 text-sm font-semibold">
                Чего в этой аналитике нет
              </h2>
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
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
