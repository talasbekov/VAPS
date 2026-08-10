"use client";

// Аналитика службы (§22.3-22.7, §22.9, §22.11-22.12). Экран НЕ СЧИТАЕТ
// НИЧЕГО: показатели, наблюдения и нагрузку считает мок-сервер, экран печатает
// displayValue и state из ответа — цвет по числу здесь не назначается нигде.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Activity } from "lucide-react";
import {
  useAnalyticsDrilldown,
  useAnalyticsPresets,
  useAttentionItems,
  useLoadAnalytics,
  useServiceAnalytics,
} from "@/hooks/use-ops-analytics";
import type { AnalyticsPeriodRequest } from "@/hooks/use-ops-analytics";
import type {
  AttentionItem,
  AttentionSeverity,
  MetricState,
  MetricValue,
} from "@/entities/service-analytics";

/** §22.3: карта идёт от СОСТОЯНИЯ — ни одна ветка не смотрит на value. */
const STATE_CLASS: Record<MetricState, string> = {
  NORMAL: "border bg-card",
  WARNING: "border-amber-300 bg-amber-50 dark:bg-amber-950/30",
  CRITICAL: "border-red-300 bg-red-50 dark:bg-red-950/30",
  UNKNOWN: "border-dashed bg-muted/30",
};

const STATE_LABEL: Record<MetricState, string> = {
  NORMAL: "В норме",
  WARNING: "Требуется проверка",
  CRITICAL: "Обнаружено превышение серверного порога",
  UNKNOWN: "Данные не подтверждены",
};

/** §22.11: цвет — от severity ОТВЕТА, не от величины count. */
const SEVERITY_CLASS: Record<AttentionSeverity, string> = {
  CRITICAL: "border-red-300 bg-red-50 dark:bg-red-950/30",
  WARNING: "border-amber-300 bg-amber-50 dark:bg-amber-950/30",
  INFO: "border bg-card",
};

const FRESHNESS_LABEL: Record<string, string> = {
  CURRENT: "Данные актуальны",
  STALE: "Снимок устарел",
  PARTIAL: "Часть источников не обновлена. Показатели могут быть неполными.",
  UNKNOWN: "Актуальность источников неизвестна",
};

const COMPLETENESS_LABEL: Record<string, string> = {
  COMPLETE: "Данные полные",
  INCOMPLETE: "Данные неполные",
  UNKNOWN: "Полнота данных неизвестна",
};

function formatMoment(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export default function ServiceAnalyticsPage() {
  // §22.6 «Фильтры синхронизируй с URL»: период — единственный фильтр среза.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const presetsQuery = useAnalyticsPresets();

  const urlPreset = searchParams.get("period");
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";
  const custom = urlPreset === "CUSTOM" && urlFrom !== "" && urlTo !== "";

  const defaultPreset = presetsQuery.data?.defaultPresetCode ?? null;
  const period: AnalyticsPeriodRequest | null = custom
    ? { presetCode: null, from: urlFrom, to: urlTo }
    : urlPreset !== null && urlPreset !== "CUSTOM"
      ? { presetCode: urlPreset, from: "", to: "" }
      : defaultPreset === null
        ? null
        : { presetCode: defaultPreset, from: "", to: "" };

  const snapshotQuery = useServiceAnalytics(period);
  const snapshot = snapshotQuery.data;
  const attentionQuery = useAttentionItems(period);

  // Раскрытие хранится ВМЕСТЕ со снимком, которому принадлежит: смена периода
  // даёт другой snapshotId, и выборка перестаёт быть раскрытой САМА (§22.12).
  const [opened, setOpened] = useState<{
    snapshotId: string;
    metricCode: string;
    cursor: string | null;
  } | null>(null);
  const active =
    opened !== null && opened.snapshotId === snapshot?.snapshotId ? opened : null;
  const openMetric = active?.metricCode ?? null;
  const cursor = active?.cursor ?? null;
  const [customFrom, setCustomFrom] = useState(urlFrom);
  const [customTo, setCustomTo] = useState(urlTo);

  const drilldownQuery = useAnalyticsDrilldown(
    active === null || snapshot === undefined || period === null
      ? null
      : {
          snapshotId: active.snapshotId,
          metricCode: active.metricCode,
          presetCode: period.presetCode,
          from: period.from,
          to: period.to,
          cursor: active.cursor,
        }
  );

  function replaceParams(next: URLSearchParams): void {
    const queryString = next.toString();
    router.replace(queryString === "" ? pathname : `${pathname}?${queryString}`);
  }

  function selectPreset(presetCode: string): void {
    const next = new URLSearchParams(searchParams);
    next.set("period", presetCode);
    next.delete("from");
    next.delete("to");
    replaceParams(next);
  }

  function applyCustom(): void {
    const next = new URLSearchParams(searchParams);
    next.set("period", "CUSTOM");
    next.set("from", customFrom);
    next.set("to", customTo);
    replaceParams(next);
  }

  function resetFilters(): void {
    // §22.6: «Сбросить» возвращает разрешённые сервером значения по умолчанию
    // — экран просто убирает свой выбор из URL.
    replaceParams(new URLSearchParams());
    setCustomFrom("");
    setCustomTo("");
  }

  const filtersActive = urlPreset !== null;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Activity className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Аналитика службы</h1>
            <p className="text-muted-foreground">
              Показатели считает сервер: экран печатает пришедшие значения и их
              состояние.
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Разделы аналитики">
          <span className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Аналитика службы
          </span>
          <Link
            href="/security-ops/analytics/operations"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Аналитика мероприятий
          </Link>
          <Link
            href="/security-ops/ratings/analytics"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Аналитика рейтинга
          </Link>
        </nav>

        {/* §22.6 общая шапка аналитики. */}
        <section
          role="group"
          aria-label="Шапка аналитики"
          className="rounded-xl border bg-card p-4"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(presetsQuery.data?.results ?? []).map((preset) => (
              <button
                key={preset.presetCode}
                type="button"
                className={
                  period?.presetCode === preset.presetCode
                    ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                    : "rounded-md border px-3 py-1.5 text-sm"
                }
                onClick={() => selectPreset(preset.presetCode)}
              >
                {preset.safeLabel}
              </button>
            ))}
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => void snapshotQuery.refetch()}
            >
              Обновить
            </button>
            {filtersActive && (
              <>
                <span className="text-xs font-semibold text-primary">
                  Фильтры активны
                </span>
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-sm"
                  onClick={resetFilters}
                >
                  Сбросить
                </button>
              </>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Начало периода
              <input
                type="date"
                className="rounded-md border bg-background p-2 text-sm font-normal"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Конец периода
              <input
                type="date"
                className="rounded-md border bg-background p-2 text-sm font-normal"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={
                customFrom === "" ||
                customTo === "" ||
                // Недоступность решил СЕРВЕР (прислал причину вместо предела).
                presetsQuery.data?.customPeriodUnavailableReason != null
              }
              onClick={applyCustom}
            >
              Произвольный период
            </button>
            {presetsQuery.data?.customPeriodUnavailableReason != null ? (
              <span className="text-xs text-muted-foreground">
                {presetsQuery.data.customPeriodUnavailableReason}
              </span>
            ) : (
              presetsQuery.data?.maxCustomPeriodDays != null && (
                <span className="text-xs text-muted-foreground">
                  Предел произвольного периода —{" "}
                  {presetsQuery.data.maxCustomPeriodDays} дней, его проверяет
                  сервер (редакция политики{" "}
                  {presetsQuery.data.limitPolicyVersion})
                </span>
              )
            )}
          </div>

          {snapshot !== undefined && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr_auto_1fr]">
              <dt className="font-semibold">Период</dt>
              <dd>
                {snapshot.period.from} — {snapshot.period.to}
              </dd>
              <dt className="font-semibold">Business date</dt>
              <dd>
                {snapshot.businessDate} ({snapshot.timezone})
              </dd>
              <dt className="font-semibold">Scope</dt>
              <dd>{snapshot.scope.safeLabel}</dd>
              <dt className="font-semibold">Снимок сформирован</dt>
              <dd>{formatMoment(snapshot.generatedAt)}</dd>
              <dt className="font-semibold">Источники обновлены</dt>
              <dd>
                {snapshot.sourceUpdatedAt === null
                  ? "источник не читался"
                  : formatMoment(snapshot.sourceUpdatedAt)}
              </dd>
              <dt className="font-semibold">Версия расчёта</dt>
              <dd>{snapshot.calculationVersion}</dd>
              <dt className="font-semibold">Актуальность</dt>
              <dd>{FRESHNESS_LABEL[snapshot.freshnessState] ?? snapshot.freshnessState}</dd>
              <dt className="font-semibold">Полнота</dt>
              <dd>
                {COMPLETENESS_LABEL[snapshot.completenessState] ??
                  snapshot.completenessState}
              </dd>
            </dl>
          )}
        </section>

        {/* §22.11: блок приезжает СВОИМ ответом и печатается дословно. */}
        <section
          role="group"
          aria-label="Требует внимания"
          className="rounded-xl border bg-card p-4"
        >
          <h2 className="mb-2 text-sm font-semibold">Требует внимания</h2>
          {attentionQuery.error !== null ? (
            <p className="text-sm text-destructive">
              {attentionQuery.error.message}
            </p>
          ) : attentionQuery.data === undefined ? (
            <p className="text-sm text-muted-foreground">Загрузка наблюдений…</p>
          ) : attentionQuery.data.data.detectionState === "UNAVAILABLE" ? (
            // Пустой список и неработающий детектор различаются ВСЛУХ.
            <p className="text-sm text-muted-foreground">
              {attentionQuery.data.data.detectionUnavailableReason}
            </p>
          ) : attentionQuery.data.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ни один серверный детектор не сработал в этом периоде.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {attentionQuery.data.data.items.map((item) => (
                <AttentionCard key={item.attentionId} item={item} />
              ))}
            </ul>
          )}
          {attentionQuery.data !== undefined && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Версия политики наблюдений: {attentionQuery.data.policyVersion}
            </p>
          )}
        </section>

        {snapshotQuery.error !== null && (
          <p className="text-sm text-destructive">{snapshotQuery.error.message}</p>
        )}
        {snapshotQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка аналитики…</p>
        )}

        {snapshot !== undefined && (
          <>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {snapshot.data.metrics.map((metric) => (
                <MetricCard
                  key={metric.metricCode}
                  metric={metric}
                  open={openMetric === metric.metricCode}
                  drilldownAllowed={snapshot.drilldownAllowed}
                  deniedReason={snapshot.drilldownDeniedReason}
                  onToggle={() => {
                    setOpened(
                      openMetric === metric.metricCode
                        ? null
                        : {
                            snapshotId: snapshot.snapshotId,
                            metricCode: metric.metricCode,
                            cursor: null,
                          }
                    );
                  }}
                />
              ))}
            </section>

            {active !== null && (
              <section
                className="rounded-xl border bg-card p-4"
                aria-label="Выборка показателя"
              >
                <h2 className="mb-2 text-sm font-semibold">Строки показателя</h2>
                {drilldownQuery.error !== null ? (
                  <p className="text-sm text-destructive">
                    {drilldownQuery.error.message}
                  </p>
                ) : drilldownQuery.data === undefined ? (
                  <p className="text-sm text-muted-foreground">Загрузка выборки…</p>
                ) : (
                  <>
                    {drilldownQuery.data.data.personalDetailSuppressed && (
                      <p className="mb-2 text-xs text-muted-foreground">
                        {drilldownQuery.data.data.personalDetailReason}
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[36rem] text-left text-sm">
                        <thead>
                          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="py-2 pr-3 font-semibold">Дата</th>
                            <th className="py-2 pr-3 font-semibold">Объект</th>
                            <th className="py-2 pr-3 font-semibold">Состояние</th>
                            <th className="py-2 font-semibold">Сотрудник</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drilldownQuery.data.data.rows.map((row) => (
                            <tr key={row.rowId} className="border-b last:border-0">
                              <td className="py-2 pr-3">{row.businessDate}</td>
                              <td className="py-2 pr-3">{row.objectLabel}</td>
                              <td className="py-2 pr-3">{row.stateLabel}</td>
                              <td className="py-2">{row.employeeLabel ?? "скрыт"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        Всего строк: {drilldownQuery.data.data.totalCount}
                      </span>
                      <button
                        type="button"
                        className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                        disabled={drilldownQuery.data.data.nextCursor === null}
                        onClick={() =>
                          setOpened({
                            ...active,
                            cursor: drilldownQuery.data.data.nextCursor,
                          })
                        }
                      >
                        Следующая страница
                      </button>
                      {cursor !== null && (
                        <button
                          type="button"
                          className="rounded-md border px-3 py-1.5 text-sm"
                          onClick={() => setOpened({ ...active, cursor: null })}
                        >
                          В начало
                        </button>
                      )}
                    </div>
                  </>
                )}
              </section>
            )}

            <LoadSection />

            <section className="rounded-xl border border-dashed bg-muted/30 p-4">
              <h2 className="mb-2 text-sm font-semibold">Чего в этом снимке нет</h2>
              <ul className="flex flex-col gap-2">
                {[
                  ...snapshot.data.unavailableMetrics,
                  ...snapshot.unavailableHeaderBlocks,
                  ...(attentionQuery.data?.data.unavailableDetectors ?? []),
                ].map((item) => (
                  <li key={item.code} className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {item.label}
                    </span>{" "}
                    — {item.reason}
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

/** §22.11 элемент наблюдения: заголовок, описание, количество и область
 * приходят готовыми, класс идёт от severity ответа. Маршрут перехода повторно
 * проверит право сам (§22.27). */
function AttentionCard({ item }: { item: AttentionItem }) {
  return (
    <li className={`rounded-lg border p-3 ${SEVERITY_CLASS[item.severity]}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{item.safeTitle}</span>
        {item.count !== null && (
          <span className="text-sm font-bold tabular-nums">{item.count}</span>
        )}
        {item.scopeLabel !== null && (
          <span className="text-[11px] text-muted-foreground">{item.scopeLabel}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.safeDescription}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span>Наблюдение зафиксировано: {formatMoment(item.detectedAt)}</span>
        {item.targetRoute !== null && (
          <Link className="font-semibold underline" href={item.targetRoute}>
            Перейти к записям
          </Link>
        )}
      </div>
    </li>
  );
}

function MetricCard({
  metric,
  open,
  drilldownAllowed,
  deniedReason,
  onToggle,
}: {
  metric: MetricValue;
  open: boolean;
  drilldownAllowed: boolean;
  deniedReason: string | null;
  onToggle: () => void;
}) {
  const canOpen = metric.drilldownAvailable && drilldownAllowed;
  return (
    <div
      role="group"
      aria-label={metric.safeLabel}
      className={`rounded-xl border p-4 ${STATE_CLASS[metric.state]}`}
    >
      <div className="text-xs font-semibold text-muted-foreground">
        {metric.safeLabel}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">
        {metric.displayValue}
      </div>
      <div className="mt-1 text-[11px] font-semibold text-muted-foreground">
        {STATE_LABEL[metric.state]}
      </div>
      <button
        type="button"
        className="mt-2 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        disabled={!canOpen}
        title={
          canOpen
            ? undefined
            : !drilldownAllowed
              ? (deniedReason ?? undefined)
              : "Показатель не рассчитан — раскрывать нечего."
        }
        onClick={onToggle}
      >
        {open ? "Свернуть строки" : "Показать строки"}
      </button>
    </div>
  );
}

/** Подпись минут: часами, десятичная запятая. */
function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  return `${String(Math.round((minutes / 60) * 10) / 10).replace(".", ",")} ч`;
}

const LOAD_STATE_LABEL: Record<string, string> = {
  NORMAL: "Норма",
  WARNING: "Предупреждение",
  OVERLOADED: "Перегрузка",
  UNKNOWN: "Не рассчитано",
};

/** §22.9: план и факт приезжают разными полями и печатаются разными колонками;
 * состояние красит сервер по порогам LOAD_POLICY. */
function LoadSection() {
  const query = useLoadAnalytics();
  if (query.isPending) {
    return (
      <section className="rounded-xl border bg-card p-4" aria-label="Нагрузка">
        <p className="text-xs text-muted-foreground">Загрузка нагрузки…</p>
      </section>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <section className="rounded-xl border bg-card p-4" aria-label="Нагрузка">
        <p className="text-xs text-muted-foreground">
          Аналитика нагрузки сейчас недоступна.
        </p>
      </section>
    );
  }
  const { view, unavailable } = query.data;
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Нагрузка">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Нагрузка</h2>
        {view.policy !== null ? (
          <span className="text-[11px] text-muted-foreground">
            Окно {view.policy.periodDays} сут. · методика {view.policy.policyVersion}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground" role="status">
            Методика нагрузки не задана — состояния не рассчитываются.
          </span>
        )}
      </div>
      {view.units.length === 0 && view.employees.length === 0 ? (
        <p className="text-xs text-muted-foreground">Смен в окне расчёта нет.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="mb-1 text-left text-[11px] font-semibold text-muted-foreground">
                По подразделениям
              </caption>
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    Подразделение
                  </th>
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    План
                  </th>
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    Факт
                  </th>
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    Состояние
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.units.map((row) => (
                  <tr key={row.organizationUnitId} className="border-b last:border-b-0">
                    <td className="py-1 pr-2">{row.safeLabel}</td>
                    <td className="py-1 pr-2 tabular-nums">
                      {formatMinutes(row.plannedMinutes)}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">
                      {formatMinutes(row.actualMinutes)}
                    </td>
                    <td className="py-1 pr-2">
                      {LOAD_STATE_LABEL[row.loadState] ?? row.loadState}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="mb-1 text-left text-[11px] font-semibold text-muted-foreground">
                По сотрудникам
              </caption>
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    Сотрудник
                  </th>
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    План
                  </th>
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    Факт
                  </th>
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    Состояние
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.employees.map((row) => (
                  <tr
                    key={row.employeeId ?? row.safeLabel}
                    className="border-b last:border-b-0"
                  >
                    <td className="py-1 pr-2">{row.safeLabel}</td>
                    <td className="py-1 pr-2 tabular-nums">
                      {formatMinutes(row.plannedMinutes)}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">
                      {formatMinutes(row.actualMinutes)}
                    </td>
                    <td className="py-1 pr-2">
                      {LOAD_STATE_LABEL[row.loadState] ?? row.loadState}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {view.unlinkedShiftsCount > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground" role="status">
          Смен без установленной связи с сотрудником: {view.unlinkedShiftsCount} — их
          минуты никому не приписаны.
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-1">
        {unavailable.map((item) => (
          <li key={item.code} className="text-[11px] text-muted-foreground">
            <span className="font-semibold">{item.label}</span> — {item.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
