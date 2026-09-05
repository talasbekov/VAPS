"use client";

// Аналитика службы (§22.3-22.7, §22.9, §22.11-22.12) по экрану прототипа
// Smart Josparlau: состояние службы и личного состава.
//
// Два источника, и это НЕ случайность разметки, а разделение владельцев:
//
// * дежурства, конфликты и нагрузку считает аналитика раздела ОМ — экран
//   печатает её displayValue и state, цвет по числу здесь не назначается
//   нигде;
// * численность, статусы, вакансии и укомплектованность приходят из ЖИВОГО
//   расхода (строевой записки) — владельца этих чисел. Аналитика раздела сама
//   объявляет кадровые показатели недоступными («кадрового источника у неё
//   нет»), и посчитать их из смен значило бы назвать личным составом тех,
//   кого поставили в наряд.
//
// Сдача дня по подразделениям берётся у светофора — тем же ответом, что
// питает его собственный экран: свой счёт «сдали / не сдали» разошёлся бы с
// ним, а сличают их как раз тогда, когда что-то пошло не так.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import {
  useAnalyticsDrilldown,
  useAnalyticsPresets,
  useAttentionItems,
  useLoadAnalytics,
  useServiceAnalytics,
} from "@/hooks/use-ops-analytics";
import {
  useStrengthReport,
  useStrengthReportPeriod,
  useTrafficLightTree,
} from "@/hooks/use-strength-report";
import { useOpsLaggingNotifications } from "@/hooks/use-ops-lagging-notifications";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { AnalyticsPeriodRequest } from "@/hooks/use-ops-analytics";
import type {
  AnalyticsPeriod,
  AttentionItem,
  AttentionSeverity,
  MetricState,
  MetricValue,
} from "@/entities/service-analytics";
import type {
  OpsNotification,
  StrengthReport,
  StrengthReportRow,
  TrafficLightNode,
} from "@/lib/api";
import { apiClient } from "@/lib/api";
import {
  SUBMISSION_LABEL,
  buildDivisionForest,
  classifyLeaf,
  countSubmissions,
} from "@/entities/daily-grid";
import { opsApiClient } from "@/lib/ops-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { DIVISIONS, ruPlural } from "@/lib/ru-plural";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

/** Блоки прототипа, которым источника нет. Список статический намеренно: это
 * не данные сервера, а решение переноса — почему блок не нарисован. Причины,
 * которые знает сам сервер (недоступные показатели, закрытые блоки шапки,
 * неработающие детекторы), печатаются рядом из его ответов. */
const MISSING_BLOCKS: readonly { title: string; reason: string }[] = [
  {
    title: "«Доступны для службы» и «Временно недоступны»",
    reason:
      "Расход раскладывает личный состав по статусам, но не делит статусы на доступные и недоступные — такого признака в справочнике нет. Провести черту на экране значило бы завести вторую классификацию рядом с кадровой, и она разошлась бы с ней при первом же новом статусе.",
  },
  {
    title: "Фильтры по подразделению, уровню детализации и статусу",
    reason:
      "Область видимости сужает выборку сам сервер, а уровней детализации у расхода нет: он отдаёт подразделения одним уровнем. Фильтр по статусу пересчитал бы показатели на клиенте — это уже вторая методика рядом с расходом.",
  },
  {
    title: "Прогноз доступности на 7 дней",
    reason:
      "Прогноза не считает никто: расход существует только за прошедшие дни и сегодня, а плановые статусы будущего в него не складываются. Нарисованный тренд был бы выдумкой с видом измерения.",
  },
  {
    title: "Ночные часы, замены и «поверх отдыха» в блоке нагрузки",
    reason:
      "Их называет сам сервер аналитики нагрузки (ниже, в её собственном списке недоступного): границы дня и ночи в модели нет, отдельных read model отдыха и замен — тоже.",
  },
  {
    title: "«Средняя нагрузка» и «Обновление» в таблице подразделений",
    reason:
      "Нагрузку считает аналитика §22.9 по своей политике из «Настроек» и в разрезе смен, а не подразделений расхода; дисциплину обновления показывает светофор выше. Оба числа уже есть на экране — в своих блоках и по своим методикам.",
  },
  {
    title: "Экспорт дэшборда (PDF, XLSX, изображение)",
    reason:
      "Сервер сам объявляет выгрузку из шапки недоступной (см. выше). Расход выгружается со своего экрана, где у файла есть подразделение, дата и формат.",
  },
];

function formatMoment(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export default function ServiceAnalyticsPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
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

  // Отметка свежести — только после монтирования: время последнего ответа в
  // разметке сервера и в браузере разное, и печать его напрямую давала бы
  // hydration mismatch (тот же дефект чинили на /dashboard).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const lastAnswer = Math.max(
    snapshotQuery.dataUpdatedAt,
    attentionQuery.dataUpdatedAt
  );
  const freshness =
    mounted && lastAnswer > 0
      ? `данные на ${new Date(lastAnswer).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : null;
  const refreshing = snapshotQuery.isFetching || attentionQuery.isFetching;

  // Расход закрыт своим правом (`status.view`), и его отсутствие называется
  // вслух в самом блоке: незагруженные права при этом ещё не отказ — тот же
  // порядок ветвей, что в командном центре.
  const canReadStrength = hasPermission("status.view");
  const strengthGate = permissionsLoading
    ? "loading"
    : canReadStrength
      ? "allowed"
      : "denied";

  if (!permissionsLoading && !hasPermission(MODULE_PERMISSION["/security-ops/analytics"])) {
    return <OpsAccessDenied what="сервисной аналитики" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Ежедневный расход"
          title="Состояние службы и личного состава"
          description="Оперативная картина численности, статусов, дежурств и нагрузки подразделений"
          actions={
            <>
              {freshness !== null && (
                <span className="text-xs text-muted-foreground">{freshness}</span>
              )}
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={refreshing}
                onClick={() => {
                  void snapshotQuery.refetch();
                  void attentionQuery.refetch();
                }}
              >
                {refreshing ? "Обновление…" : "Обновить"}
              </button>
            </>
          }
        />

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
                <span className="text-xs font-semibold text-primary-ink">
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

        {/* Кадровая часть прототипа: численность, статусы, подразделения и
            вакансии. Её источник — расход, а не аналитика раздела. */}
        <PersonnelSection
          gate={strengthGate}
          period={snapshot?.period ?? null}
          businessDate={snapshot?.businessDate ?? null}
        />

        <DaySubmissionSection gate={strengthGate} />

        <LaggingRemindersSection gate={strengthGate} />

        {snapshotQuery.error !== null && (
          <p className="text-sm text-destructive-ink">{snapshotQuery.error.message}</p>
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
                  <p className="text-sm text-destructive-ink">
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
                    <Table className="min-w-[36rem]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Дата</TableHead>
                          <TableHead>Объект</TableHead>
                          <TableHead>Состояние</TableHead>
                          <TableHead>Сотрудник</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drilldownQuery.data.data.rows.map((row) => (
                          <TableRow key={row.rowId}>
                            <TableCell>{row.businessDate}</TableCell>
                            <TableCell>{row.objectLabel}</TableCell>
                            <TableCell>{row.stateLabel}</TableCell>
                            <TableCell>{row.employeeLabel ?? "скрыт"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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

            {/* §22.11: блок приезжает СВОИМ ответом и печатается дословно.
                Стоит последним, как в прототипе: наблюдения — вывод из всего
                показанного выше, а не вступление к нему. */}
            <section
              role="group"
              aria-label="Требует внимания"
              className="rounded-xl border bg-card p-4"
            >
              <h2 className="mb-2 text-sm font-semibold">Требует внимания</h2>
              {attentionQuery.error !== null ? (
                <p className="text-sm text-destructive-ink">
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
              <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
                {MISSING_BLOCKS.map((block) => (
                  <li key={block.title} className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {block.title}
                    </span>{" "}
                    — {block.reason}
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
          <Table>
            <TableCaption className="mb-1 mt-0 text-left text-[11px] font-semibold text-muted-foreground">
              По подразделениям
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Подразделение</TableHead>
                <TableHead scope="col">План</TableHead>
                <TableHead scope="col">Факт</TableHead>
                <TableHead scope="col">Состояние</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.units.map((row) => (
                <TableRow key={row.organizationUnitId}>
                  <TableCell>{row.safeLabel}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatMinutes(row.plannedMinutes)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMinutes(row.actualMinutes)}
                  </TableCell>
                  <TableCell>
                    {LOAD_STATE_LABEL[row.loadState] ?? row.loadState}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table>
            <TableCaption className="mb-1 mt-0 text-left text-[11px] font-semibold text-muted-foreground">
              По сотрудникам
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Сотрудник</TableHead>
                <TableHead scope="col">План</TableHead>
                <TableHead scope="col">Факт</TableHead>
                <TableHead scope="col">Состояние</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.employees.map((row) => (
                <TableRow key={row.employeeId ?? row.safeLabel}>
                  <TableCell>{row.safeLabel}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatMinutes(row.plannedMinutes)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMinutes(row.actualMinutes)}
                  </TableCell>
                  <TableCell>
                    {LOAD_STATE_LABEL[row.loadState] ?? row.loadState}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

/* ------------------------------------------------------------------ */
/* Кадровая часть: численность, статусы, подразделения, вакансии       */
/* ------------------------------------------------------------------ */

/** Право на расход ещё не загружено / есть / отсутствует. */
type StrengthGate = "loading" | "allowed" | "denied";

/** Палитра долей доната статусов. Цвет — оформление: порядок и состав колонок
 * задаёт СЕРВЕР, палитра лишь идёт по кругу. */
const STATUS_COLORS: readonly string[] = [
  "hsl(142 71% 45%)",
  "hsl(221 83% 53%)",
  "hsl(239 84% 67%)",
  "hsl(38 92% 50%)",
  "hsl(0 84% 60%)",
  "hsl(271 81% 56%)",
  "hsl(199 89% 48%)",
  "hsl(160 84% 39%)",
  "hsl(25 95% 53%)",
  "hsl(48 96% 53%)",
  "hsl(215 16% 47%)",
];

function PersonnelSection({
  gate,
  period,
  businessDate,
}: {
  gate: StrengthGate;
  period: AnalyticsPeriod | null;
  businessDate: string | null;
}) {
  const report = useStrengthReport(gate === "allowed");

  // Ряд динамики — за период СНИМКА, обрезанный датой раздела: расхода на
  // будущее не существует, и запрос за него сервер отклоняет (не молча — 400
  // «Период не может уходить в будущее»).
  const chartPeriod =
    period === null || businessDate === null
      ? null
      : period.from > businessDate
        ? null
        : { from: period.from, to: period.to > businessDate ? businessDate : period.to };
  const series = useStrengthReportPeriod(chartPeriod, gate === "allowed");

  if (gate === "loading") {
    return (
      <section role="group" className="rounded-xl border bg-card p-4" aria-label="Личный состав">
        <p className="text-xs text-muted-foreground">Загрузка прав…</p>
      </section>
    );
  }
  if (gate === "denied") {
    return (
      <section role="group" className="rounded-xl border bg-card p-4" aria-label="Личный состав">
        <h2 className="mb-1 text-sm font-semibold">Личный состав</h2>
        <p className="text-xs text-muted-foreground">
          Численность, статусы и вакансии закрыты правом «Статусы: просмотр» —
          показатели не рассчитываются, а не показываются нулями.
        </p>
      </section>
    );
  }
  if (report.isPending) {
    return (
      <section role="group" className="rounded-xl border bg-card p-4" aria-label="Личный состав">
        <p className="text-xs text-muted-foreground">Загрузка расхода…</p>
      </section>
    );
  }
  if (report.isError || report.data === undefined) {
    return (
      <section role="group" className="rounded-xl border bg-card p-4" aria-label="Личный состав">
        <h2 className="mb-1 text-sm font-semibold">Личный состав</h2>
        <p className="text-xs text-muted-foreground">
          Расход сейчас недоступен — численность и статусы не показаны.
        </p>
      </section>
    );
  }

  return (
    <>
      <PersonnelKpi report={report.data} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <AvailabilityChart
          pages={series.data?.pages ?? []}
          pending={series.isPending && chartPeriod !== null}
          failed={series.isError}
          clamped={
            chartPeriod !== null && period !== null && period.to !== chartPeriod.to
          }
          businessDate={businessDate}
        />
        <StatusDonut report={report.data} />
      </div>
      <DivisionComparison report={report.data} />
      <StaffingSection report={report.data} />
    </>
  );
}

/** Плитки прототипа. Числа берутся у расхода — владельца численности; второй
 * счёт здесь разошёлся бы с экраном «Расход и светофор». */
function PersonnelKpi({ report }: { report: StrengthReport }) {
  const totals = report.totals;
  const inService = totals.columns["IN_SERVICE"];
  const items = [
    {
      key: "staff",
      label: "Списочная численность",
      value: formatNumber(totals.staff_total),
      cap: "по штатному расписанию",
    },
    {
      key: "list",
      label: "Фактическая численность",
      value: formatNumber(totals.list_total),
      cap:
        totals.staff_total === 0
          ? "штат не задан"
          : `${sharePercent(totals.list_total, totals.staff_total)} от списочной`,
    },
    {
      key: "in-service",
      label: "В строю",
      // Колонки задаёт сервер: нет колонки — прочерк, а не ноль. Ноль здесь
      // читался бы как «в строю никого».
      value: inService === undefined ? "—" : formatNumber(inService),
      cap:
        inService === undefined
          ? "в расходе нет колонки «в строю»"
          : totals.list_total === 0
            ? "списочной численности нет"
            : `${sharePercent(inService, totals.list_total)} фактической`,
    },
    {
      key: "vacancies",
      label: "Вакансии",
      value: formatNumber(totals.vacancies),
      cap:
        totals.staff_total === 0
          ? "штат не задан"
          : `укомплектованность ${sharePercent(totals.list_total, totals.staff_total)}`,
    },
    {
      key: "attached",
      label: "Придано",
      value: formatNumber(totals.attached),
      cap: "сверх списка подразделения",
    },
    {
      key: "off-list",
      label: "Откомандировано",
      value: formatNumber(totals.off_list),
      cap: "числятся, но не в своём списке",
    },
  ];

  return (
    <section
      role="group"
      aria-label="Численность личного состава"
      className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6"
    >
      {items.map((item) => (
        <div key={item.key} className="rounded-xl border bg-card p-4">
          <p className="truncate text-[11px] font-semibold text-muted-foreground">
            {item.label}
          </p>
          <p className="text-xl font-bold tabular-nums">{item.value}</p>
          <p className="text-[11px] text-muted-foreground">{item.cap}</p>
        </div>
      ))}
    </section>
  );
}

/** «Динамика доступности» прототипа: ряд по датам из расхода за период.
 * Строится ТОЛЬКО из страниц ответа — своей интерполяции и сглаживания здесь
 * нет, пропущенный день был бы виден разрывом, а не дорисован. */
function AvailabilityChart({
  pages,
  pending,
  failed,
  clamped,
  businessDate,
}: {
  pages: { business_date: string; totals: { list_total: number; columns: Record<string, number> } }[];
  pending: boolean;
  failed: boolean;
  clamped: boolean;
  businessDate: string | null;
}) {
  const [asPercent, setAsPercent] = useState(false);

  const points = useMemo(
    () =>
      pages.map((page) => {
        const list = page.totals.list_total;
        const inService = page.totals.columns["IN_SERVICE"] ?? null;
        return {
          date: page.business_date,
          list,
          inService,
          value:
            inService === null
              ? null
              : asPercent
                ? list === 0
                  ? null
                  : (inService / list) * 100
                : inService,
        };
      }),
    [pages, asPercent]
  );

  const measured = points.filter((point) => point.value !== null);
  const max = measured.reduce((best, point) => Math.max(best, point.value as number), 0);
  const min = measured.reduce(
    (best, point) => Math.min(best, point.value as number),
    max
  );
  // Ряд может быть ПОСТОЯННЫМ (все дни одинаковы). Тогда «от минимума» дало бы
  // нулевую высоту у каждого столбца — график выглядел бы как отсутствие
  // данных. Постоянный ряд рисуется ровной полосой и назван словами.
  const flat = measured.length > 0 && max === min;
  const span = max - min || 1;

  return (
    <section
      role="group"
      aria-label="Динамика доступности"
      className="rounded-xl border bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Динамика доступности</h2>
          <p className="text-xs text-muted-foreground">
            Фактическая численность и «в строю» по дням периода
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={
              asPercent
                ? "rounded-md border px-3 py-1.5 text-sm"
                : "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            }
            onClick={() => setAsPercent(false)}
          >
            Количество
          </button>
          <button
            type="button"
            className={
              asPercent
                ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                : "rounded-md border px-3 py-1.5 text-sm"
            }
            onClick={() => setAsPercent(true)}
          >
            Процент
          </button>
        </div>
      </div>

      {pending ? (
        <p className="text-xs text-muted-foreground">Загрузка ряда…</p>
      ) : failed ? (
        <p className="text-xs text-muted-foreground">
          Ряд за период сейчас недоступен.
        </p>
      ) : measured.length < 2 ? (
        // Строка прототипа: одна точка — не динамика.
        <p className="text-xs text-muted-foreground">
          Недостаточно данных для графика за один день
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex w-14 shrink-0 flex-col justify-between py-1 text-right text-[10px] tabular-nums text-muted-foreground">
              <span>{asPercent ? formatPercent(max) : formatNumber(max)}</span>
              {!flat && (
                <span>{asPercent ? formatPercent(min) : formatNumber(min)}</span>
              )}
            </div>
            <ul className="flex flex-1 items-end gap-1" style={{ height: "10rem" }}>
              {points.map((point) => (
                <li
                  key={point.date}
                  className="flex h-full flex-1 flex-col justify-end"
                  title={`${point.date}: в строю ${point.inService ?? "нет данных"} из ${point.list}`}
                >
                  {point.value === null ? (
                    <span className="block h-1 w-full rounded-sm bg-muted" />
                  ) : (
                    <span
                      className="block w-full rounded-t-sm bg-primary"
                      style={{
                        // Полоса от МИНИМУМА ряда, а не от нуля: у «в строю»
                        // разброс мал, и от нуля все дни выглядели бы
                        // одинаковыми. Ось подписана обоими краями.
                        height: flat
                          ? "60%"
                          : `${8 + ((point.value - min) / span) * 92}%`,
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
          {flat && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Значение одинаково во все дни периода — ряд ровный, это не сбой
              масштаба.
            </p>
          )}
          <ul className="mt-1 flex gap-1 pl-16 text-[10px] text-muted-foreground">
            {points.map((point) => (
              <li key={point.date} className="flex-1 truncate text-center">
                {point.date.slice(8, 10)}.{point.date.slice(5, 7)}
              </li>
            ))}
          </ul>
        </>
      )}

      {clamped && businessDate !== null && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Ряд обрывается на {businessDate}: расхода за будущие дни не существует,
          и сервер такой период отклоняет.
        </p>
      )}
    </section>
  );
}

/** «Состояние личного состава»: донат по колонкам расхода. Подписи — с
 * сервера (`column_labels`), общие с выгрузками. */
function StatusDonut({ report }: { report: StrengthReport }) {
  const total = report.columns.reduce(
    (sum, code) => sum + (report.totals.columns[code] ?? 0),
    0
  );
  let offset = 0;
  const stops: string[] = [];
  const legend = report.columns.map((code, index) => {
    const count = report.totals.columns[code] ?? 0;
    const color = STATUS_COLORS[index % STATUS_COLORS.length];
    const share = total === 0 ? 0 : (count / total) * 100;
    stops.push(`${color} ${offset.toFixed(3)}% ${(offset + share).toFixed(3)}%`);
    offset += share;
    return { code, count, color, share };
  });

  return (
    <section
      role="group"
      aria-label="Состояние личного состава"
      className="rounded-xl border bg-card p-4"
    >
      <h2 className="text-sm font-semibold">Состояние личного состава</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Колонки расхода на {report.business_date}
      </p>
      <div className="flex flex-wrap items-center gap-5">
        <div
          className="relative h-32 w-32 shrink-0 rounded-full"
          role="img"
          aria-label={`Всего по списку: ${total}`}
          style={{
            background:
              total === 0 ? "hsl(var(--muted))" : `conic-gradient(${stops.join(", ")})`,
          }}
        >
          <span className="absolute inset-[24%] grid place-items-center rounded-full bg-card text-center">
            <span>
              <span className="block text-[10px] text-muted-foreground">Всего</span>
              <span className="block text-lg font-bold tabular-nums">
                {formatNumber(total)}
              </span>
            </span>
          </span>
        </div>
        <ul className="min-w-[12rem] flex-1 space-y-0.5">
          {legend.map((item) => (
            <li key={item.code} className="flex items-baseline gap-2 text-xs">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.color }}
              />
              <span className="flex-1 truncate">
                {report.column_labels[item.code] ?? item.code}
              </span>
              <b className="tabular-nums">{formatNumber(item.count)}</b>
              <span className="w-12 text-right tabular-nums text-muted-foreground">
                {total === 0 ? "—" : formatPercent(item.share)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** «Сравнение подразделений»: строки расхода с поиском и режимом диаграммы. */
/**
 * Путь до подразделения по его идентификатору (Plane №249).
 *
 * 🔴 Имена уникальны только внутри родителя: на структуре из трёх
 * департаментов «Второе сквозное управление» есть в каждом, и таблица
 * сравнения печатала три одинаковые строки — по ней нельзя было сказать, чьё
 * управление отстаёт.
 *
 * Путь берётся у лёгкой ручки подразделений, а не у службы расхода: её
 * контракт читают выгрузки DOCX/CSV/XLSX, и менять его ради подписи на экране
 * нельзя (то же решение, что на борде расхода, №235).
 */
function useDivisionPaths() {
  const query = useQuery<{ results: { id: string; name: string; ancestors?: string[] }[] }>({
    queryKey: ["ops-daily", "divisions", "paths"],
    queryFn: () =>
      opsApiClient.get<{ results: { id: string; name: string; ancestors?: string[] }[] }>(
        "/api/ops/daily/divisions/"
      ),
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const row of query.data?.results ?? []) {
      const path = row.ancestors ?? [];
      if (path.length > 0) map.set(String(row.id), path.join(" › "));
    }
    return map;
  }, [query.data]);
}

function DivisionComparison({ report }: { report: StrengthReport }) {
  const paths = useDivisionPaths();
  const [search, setSearch] = useState("");
  const [asChart, setAsChart] = useState(false);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle === ""
      ? report.rows
      : report.rows.filter((row) =>
          `${row.name} ${paths.get(String(row.division_id)) ?? ""}`
            .toLowerCase()
            .includes(needle)
        );
  }, [report.rows, search, paths]);

  return (
    <section
      role="group"
      aria-label="Сравнение подразделений"
      className="rounded-xl border bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Сравнение подразделений</h2>
          <p className="text-xs text-muted-foreground">
            Численность, укомплектованность и статусы; строки и колонки задаёт
            расход
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
            placeholder="Поиск подразделения…"
            aria-label="Поиск подразделения"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            className={
              asChart
                ? "rounded-md border px-3 py-1.5 text-sm"
                : "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            }
            onClick={() => setAsChart(false)}
          >
            Таблица
          </button>
          <button
            type="button"
            className={
              asChart
                ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                : "rounded-md border px-3 py-1.5 text-sm"
            }
            onClick={() => setAsChart(true)}
          >
            Диаграмма
          </button>
        </div>
      </div>

      {asChart ? (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.division_id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">
                  {row.name}
                  {paths.get(String(row.division_id)) && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {paths.get(String(row.division_id))}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  укомплектованность{" "}
                  {row.staff_total === 0
                    ? "—"
                    : sharePercent(row.list_total, row.staff_total)}
                </span>
              </div>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{
                    width:
                      row.staff_total === 0
                        ? "0%"
                        : `${Math.min(100, (row.list_total / row.staff_total) * 100)}%`,
                  }}
                />
              </span>
              <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
                <span>в строю</span>
                <span className="tabular-nums">
                  {row.columns["IN_SERVICE"] ?? "нет данных"} из {row.list_total}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Подразделение</TableHead>
              <TableHead>Штат</TableHead>
              <TableHead>По списку</TableHead>
              <TableHead>Вакансии</TableHead>
              <TableHead>Укомплектованность</TableHead>
              {report.columns.map((code) => (
                <TableHead key={code}>
                  {report.column_labels[code] ?? code}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row: StrengthReportRow) => (
              <TableRow key={row.division_id}>
                <TableCell>
                  {row.name}
                  {/* Путь — подписью под именем: одноимённых управлений на
                      реальной структуре трое (Plane №249). */}
                  {paths.get(String(row.division_id)) && (
                    <span className="block text-xs text-muted-foreground">
                      {paths.get(String(row.division_id))}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{row.staff_total}</TableCell>
                <TableCell className="tabular-nums">{row.list_total}</TableCell>
                <TableCell className="tabular-nums">{row.vacancies}</TableCell>
                <TableCell className="tabular-nums">
                  {row.staff_total === 0
                    ? "—"
                    : sharePercent(row.list_total, row.staff_total)}
                </TableCell>
                {report.columns.map((code) => (
                  <TableCell key={code} className="tabular-nums">
                    {row.columns[code] ?? 0}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {report.rows.length > 0 && rows.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          По запросу «{search}» подразделений нет.
        </p>
      )}
      {report.rows.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          В вашей области видимости подразделений нет.
        </p>
      )}
    </section>
  );
}

/** «Укомплектованность и вакансии» прототипа — из тех же строк расхода. */
function StaffingSection({ report }: { report: StrengthReport }) {
  const totals = report.totals;
  const withVacancies = [...report.rows]
    .filter((row) => row.vacancies > 0)
    .sort((a, b) => b.vacancies - a.vacancies);

  return (
    <section
      role="group"
      aria-label="Укомплектованность и вакансии"
      className="rounded-xl border bg-card p-4"
    >
      <h2 className="text-sm font-semibold">Укомплектованность и вакансии</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Общая{" "}
        {totals.staff_total === 0
          ? "—"
          : sharePercent(totals.list_total, totals.staff_total)}{" "}
        · штатных единиц {formatNumber(totals.staff_total)} · занято{" "}
        {formatNumber(totals.list_total)} · вакансий{" "}
        {formatNumber(totals.vacancies)}
      </p>
      {withVacancies.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Незакрытых штатных единиц нет.
        </p>
      ) : (
        <ul className="space-y-2">
          {withVacancies.map((row) => (
            <li key={row.division_id}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate">{row.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  вакансий {row.vacancies} из {row.staff_total}
                </span>
              </div>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{
                    width:
                      row.staff_total === 0
                        ? "0%"
                        : `${Math.min(100, (row.list_total / row.staff_total) * 100)}%`,
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Срок открытия вакансии расход не хранит — «длительно открытых» здесь
        нет: у штатной единицы есть занятость, но не дата, с которой она пуста.
      </p>
    </section>
  );
}

/** Поимённое расхождение жёлтого узла. Грузится ПО КЛИКУ (точечная ручка
 * светофора): дерево деталей не несёт, а тянуть их для всех жёлтых сразу
 * значило бы N запросов ради свёрнутых блоков. Имя доклеивает бэк; id без
 * имени показывается номером — человек уже не находится в кадрах. */
function SubmissionDriftDetails({ divisionId }: { divisionId: number }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["traffic-light", "division", divisionId],
    queryFn: () => apiClient.getDivisionTrafficLight(divisionId),
    enabled: open,
  });
  const name = (drift: { names: Record<string, string> }, id: number) =>
    drift.names[String(id)] ?? `№${id}`;
  return (
    <div className="w-full">
      <button
        type="button"
        className="text-xs text-primary underline-offset-2 hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Скрыть расхождение" : "Показать расхождение"}
      </button>
      {open && (
        <div className="mt-1 rounded-md border bg-muted/40 p-2 text-xs">
          {detail.isPending && <p>Загрузка…</p>}
          {detail.isError && <p>Расхождение сейчас недоступно.</p>}
          {detail.data &&
            (detail.data.drift === null ? (
              <p>
                Расхождение уже ушло: живые данные снова отвечают сданному дню.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {detail.data.drift.changed.map((row) => (
                  <li key={`c-${row.employee_id}`}>
                    {name(detail.data.drift!, row.employee_id)}: {row.from} → {row.to}
                  </li>
                ))}
                {detail.data.drift.added.map((id) => (
                  <li key={`a-${id}`}>{name(detail.data.drift!, id)} — появился в составе</li>
                ))}
                {detail.data.drift.removed.map((id) => (
                  <li key={`r-${id}`}>{name(detail.data.drift!, id)} — выбыл из состава</li>
                ))}
              </ul>
            ))}
        </div>
      )}
    </div>
  );
}

/** «17:00:00» → «17:00». Секунды у порога не значат ничего: сравнение идёт по
 * времени суток, и хвост нулей в подписи только шумит.
 *
 * `null` — значение НЕВАЛИДНО (пусто, не строка формата HH:MM…) — тогда
 * вызывающий код печатает честную фразу («Контрольный час не задан.») вместо
 * эха сырого значения: полуоборванная фраза «Контрольный час  — сдача…»
 * читалась бы как баг компонента, а не как честное «сервер не прислал час».
 * Порт ТОЙ ЖЕ функции из `ExpenseTrafficCard.formatControlHour`
 * (`features/command-expense/ui/ExpenseTrafficCard.tsx`) — второй словарь
 * форматирования того же поля здесь не заводится; известный долг задачи 6
 * («не трогаем чужой файл, зафиксирован текстом отчёта») закрыт этой
 * правкой. */
function formatControlHour(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return /^\d{2}:\d{2}/.test(raw) ? raw.slice(0, 5) : null;
}

const SUBMISSION_DOT: Record<TrafficLightNode["status"], string> = {
  GREEN: "bg-green-600",
  YELLOW: "bg-amber-500",
  RED: "bg-red-600",
  NEUTRAL: "bg-muted-foreground",
  UNKNOWN: "bg-muted-foreground",
};

/** Узел «проблемный» — RED/YELLOW/UNKNOWN (тот же словарь, что раньше нёс
 * список «Проблемные подразделения» этого файла: RED — не сдали, YELLOW —
 * сдали, но данные разошлись, UNKNOWN — справочник узла сломан, «не знаю»
 * СТАРШЕ красного). Проверка полноты switch на этапе компиляции — тот же
 * приём, что `classifyLeaf`/`assertNeverStatus` (`entities/daily-grid`):
 * пополнится `TrafficLightNode["status"]` шестым значением — `default` перестанет
 * сужаться до `never`, и `tsc` откажется собирать файл вместо того, чтобы
 * шестой статус молча посчитался «здоровым» и свернулся в сводку. */
function isProblemStatus(status: TrafficLightNode["status"]): boolean {
  switch (status) {
    case "RED":
    case "YELLOW":
    case "UNKNOWN":
      return true;
    case "GREEN":
    case "NEUTRAL":
      return false;
    default:
      return assertNeverTrafficStatus(status);
  }
}

function assertNeverTrafficStatus(value: never): never {
  throw new Error(`Неизвестный статус светофора: ${String(value)}`);
}

/** Русское склонение слова «подразделение» по числу: 1 — подразделение,
 * 2-4 — подразделения, 0/5+ и 11-14 — подразделений. Своя функция, а не
 * `Intl.PluralRules`: правило здесь короче собственного вызова, а результат
 * пинится e2e-пробой дословно. */
function divisionsPlural(count: number): string {
  return ruPlural(count, DIVISIONS);
}

/** Число узлов ПОД веткой (не считая её саму) — для сводки свёрнутой
 * здоровой ветки. Каскад светофора (`traffic_light_tree()` бэка)
 * гарантирует: если сама ветка GREEN/NEUTRAL, ни один её потомок не может
 * быть RED/YELLOW/UNKNOWN — иначе каскад отразил бы худшее состояние
 * потомка в статусе самой ветки. Сворачивать здоровую ветку безопасно: ни
 * один проблемный узел под сводкой спрятаться не может.
 *
 * Считается СТРУКТУРА, а не сдача: подпись сводки называет подразделения, а
 * не «сдавших» (находка ревью ветки 22.08, отменяющая прежнее решение
 * координатора). Прежнее «+N сдавших» утверждало о данных неправду: под
 * зелёной веткой каскад ДОПУСКАЕТ NEUTRAL-потомков («сдавать некого»), и
 * целиком нейтральная ветка читалась как «нечего сдавать … + 3 сдавших».
 * Одним словом эту смесь не назвать честно и через корзины `classifyLeaf`:
 * потомки могут одновременно попадать в `submitted`, `late` и вне корзин —
 * поэтому подпись говорит только то, что действительно посчитано. */
function countDescendants(
  divisionId: number,
  childrenOf: Map<number, TrafficLightNode[]>
): number {
  const children = childrenOf.get(divisionId) ?? [];
  let total = children.length;
  for (const child of children) {
    total += countDescendants(child.division_id, childrenOf);
  }
  return total;
}

/**
 * Строка дерева, рекурсивно. Проблемные ветки (RED/YELLOW/UNKNOWN)
 * развёрнуты по умолчанию; здоровые (GREEN/NEUTRAL) свёрнуты в сводку
 * «+N подразделений», разворачиваемую по клику. Переключатель
 * (`aria-expanded`) — только у узла с потомками; у листа переключать нечего.
 *
 * Свой стейт раскрытия у каждого узла ЛОКАЛЬНЫЙ и пересоздаётся при
 * сворачивании/разворачивании родителя (снова дефолт по статусу) — вместо
 * того чтобы помнить ручной клик пользователя вглубь уже скрытой ветки, чего
 * требование задачи не просит.
 */
function DivisionTreeRow({
  node,
  childrenOf,
  cyclic,
}: {
  node: TrafficLightNode;
  childrenOf: Map<number, TrafficLightNode[]>;
  cyclic: Set<number>;
}) {
  const children = childrenOf.get(node.division_id) ?? [];
  const hasChildren = children.length > 0;
  const isCyclic = cyclic.has(node.division_id);
  const descendants = countDescendants(node.division_id, childrenOf);
  const [expanded, setExpanded] = useState(() => isProblemStatus(node.status));

  return (
    <li data-division-id={node.division_id}>
      <div className="flex flex-wrap items-center gap-2 border-b py-1 text-xs last:border-0">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Свернуть" : "Развернуть"} ${node.name}`}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${SUBMISSION_DOT[node.status]}`}
        />
        <span className="flex-1 truncate">{node.name}</span>
        <span className="text-muted-foreground">{SUBMISSION_LABEL[node.status]}</span>
        {node.late && <span className="text-muted-foreground">с опозданием</span>}
        {/* Находка ревью 22.08: parent_id этого узла замкнут в цикл — его
            МЕСТО в иерархии структурно не определить (не «нет данных», а
            «данные противоречивы»), честная пометка вместо тихой потери
            узла или произвольного места в дереве. */}
        {isCyclic && (
          <span className="text-destructive-ink">
            структура зациклена — место в иерархии не определить
          </span>
        )}
        {node.status === "YELLOW" && (
          <SubmissionDriftDetails divisionId={node.division_id} />
        )}
      </div>
      {hasChildren &&
        (expanded ? (
          <ul className="ml-2 border-l pl-3">
            {children.map((child) => (
              <DivisionTreeRow
                key={child.division_id}
                node={child}
                childrenOf={childrenOf}
                cyclic={cyclic}
              />
            ))}
          </ul>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={expanded}
            className="ml-6 block py-1 text-left text-xs text-muted-foreground hover:underline"
          >
            + {descendants} {divisionsPlural(descendants)}
          </button>
        ))}
    </li>
  );
}

/** «Актуальность ежедневного расхода»: счёт берётся у СВЕТОФОРА — владельца
 * витрины сдачи дня, и раскладывается по корзинам ОБЩЕЙ функцией раздела
 * (`countSubmissions`, `entities/daily-grid`), а не своим маппингом. Свой
 * разбор разошёлся бы с карточкой «Расход дня» командного центра — ровно это
 * ревью ветки 22.08 и нашло. Разбивка здесь ТОНЬШЕ трёх корзин, но выведена
 * из них: «сдали» — это в точности «Сдано» карточки на том же дереве. */
function DaySubmissionSection({ gate }: { gate: StrengthGate }) {
  const tree = useTrafficLightTree(gate === "allowed");

  if (gate === "loading" || (gate === "allowed" && tree.isPending)) {
    return (
      <section role="group" className="rounded-xl border bg-card p-4" aria-label="Сдача дня">
        <p className="text-xs text-muted-foreground">Загрузка светофора…</p>
      </section>
    );
  }
  if (gate === "denied") {
    return (
      <section role="group" className="rounded-xl border bg-card p-4" aria-label="Сдача дня">
        <h2 className="mb-1 text-sm font-semibold">
          Актуальность ежедневного расхода
        </h2>
        <p className="text-xs text-muted-foreground">
          Светофор сдачи закрыт правом «Статусы: просмотр».
        </p>
      </section>
    );
  }
  if (tree.isError || tree.data === undefined) {
    return (
      <section role="group" className="rounded-xl border bg-card p-4" aria-label="Сдача дня">
        <h2 className="mb-1 text-sm font-semibold">
          Актуальность ежедневного расхода
        </h2>
        <p className="text-xs text-muted-foreground">
          Светофор сейчас недоступен.
        </p>
      </section>
    );
  }

  // Корзины сдачи — ОБЩЕЙ функцией раздела (`countSubmissions`,
  // `entities/daily-grid`), той же, что кормит карточку «Расход дня» в
  // командном центре: до ревью ветки 22.08 этот экран раскладывал ответ по
  // корзинам сам, и его «сдали» (GREEN, в том числе опоздавшие) не совпадало
  // с «Сдано» карточки (GREEN|YELLOW и НЕ late) на том же дереве. Теперь
  // «сдали» здесь — это ровно «Сдано» там.
  //
  // Считаются ЛИСТЬЯ дерева: цвет узла с потомками — худший в поддереве
  // (каскад светофора), и сложение его с детьми посчитало бы одно
  // подразделение дважды.
  const counts = countSubmissions(tree.data.nodes);
  const nodes = counts.leaves;
  // Разбивка ТОНЬШЕ трёх корзин — но ВЫВЕДЕННАЯ из них, а не своим
  // маппингом: `missing` раскладывается на RED («не сдали») и UNKNOWN
  // («неизвестно»), а YELLOW — это ПОМЕТКА ВНУТРИ сдавших и просрочивших,
  // отдельной долей она здесь не считается (её строка ниже это говорит).
  const missingRed = nodes.filter(
    (node) => classifyLeaf(node) === "missing" && node.status === "RED"
  );
  const missingUnknown = nodes.filter(
    (node) => classifyLeaf(node) === "missing" && node.status === "UNKNOWN"
  );
  const drift = nodes.filter(
    (node) => classifyLeaf(node) !== null && node.status === "YELLOW"
  );
  const total = nodes.length || 1;
  const controlHour = formatControlHour(tree.data.control_hour);
  // Дерево ниже рисует ВСЕ узлы ответа (не только листья) — полная
  // иерархия подразделений, а не сводка по обязанности сдавать.
  const forest = buildDivisionForest(tree.data.nodes);

  return (
    <section
      role="group"
      aria-label="Актуальность ежедневного расхода"
      className="rounded-xl border bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            Актуальность ежедневного расхода
          </h2>
          <p className="text-xs text-muted-foreground">
            На {tree.data.business_date} · подразделений {nodes.length} · сдали{" "}
            {counts.submitted} · с опозданием {counts.late} · не сдали{" "}
            {missingRed.length} · неизвестно {missingUnknown.length} · нечего
            сдавать {counts.neutral}
          </p>
          {/* «С расхождением» — НЕ шестая доля рядом с пятью выше, а пометка
              внутри уже посчитанных: жёлтый узел это СДАЧА, у которой живые
              данные разошлись с подписанным снимком. Без этой оговорки числа
              строки выше не сходились бы в сумму, и читателю пришлось бы
              гадать, что с чем складывать. */}
          <p className="text-xs text-muted-foreground">
            С расхождением данных {drift.length} — уже посчитаны в «сдали» и «с
            опозданием».
          </p>
          {/* Контрольный час назван рядом со счётчиком опозданий: именно по
              нему сервер выставляет `late`, и без порога «с опозданием N»
              нечем отличить от нормы. Час приходит с тем же ответом, а не
              зашит числом — в настройках раздела он меняется. */}
          <p className="text-xs text-muted-foreground">
            {controlHour !== null
              ? `Контрольный час ${controlHour} — сдача после него считается опозданием.`
              : "Контрольный час не задан."}
          </p>
        </div>
        <Link
          href="/reports"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Открыть расход
        </Link>
      </div>

      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {/* Полоса — ТЕ ЖЕ три корзины, что и числа над ней (сдали /
            с опозданием / не сдали), а не свой разрез по цвету статуса:
            иначе доли и подписи говорили бы о разном на одном экране.
            «Нечего сдавать» доли не занимает — остаток полосы. */}
        <span
          className="block bg-green-600"
          style={{ width: `${(counts.submitted / total) * 100}%` }}
        />
        <span
          className="block bg-amber-500"
          style={{ width: `${(counts.late / total) * 100}%` }}
        />
        <span
          className="block bg-red-600"
          style={{ width: `${(counts.missing / total) * 100}%` }}
        />
      </div>

      {forest.roots.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-xs font-semibold text-muted-foreground">
            Подразделения
          </p>
          <ul className="space-y-0.5">
            {forest.roots.map((root) => (
              <DivisionTreeRow
                key={root.division_id}
                node={root}
                childrenOf={forest.childrenOf}
                cyclic={forest.cyclic}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** «2026-08-21» → «21.08». Деловая дата у напоминания своя (догон проходит
 * пропущенные дни), поэтому она названа у каждой строки. Нечитаемое значение
 * возвращается как есть — выдумывать за сервер нечего. */
function formatBusinessDate(raw: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[3]}.${match[2]}` : raw;
}

/**
 * «Напоминания об отставших» — личная лента уведомлений раздела рядом со
 * светофором сдачи.
 *
 * ВТОРОГО СЧЁТА СДАЧИ ЗДЕСЬ НЕТ. Владелец витрины «сдали / не сдали» —
 * светофор выше; лента отвечает на другой вопрос: о чём МЕНЯ уже оповестили.
 * Числа этих двух блоков законно расходятся — светофор говорит про сейчас,
 * напоминание про день, за который оно ушло, — и сводить их к одному счётчику
 * значило бы обещать равенство, которого нет.
 *
 * ИМЕНА ДОКЛЕИВАЮТСЯ ИЗ ДЕРЕВА СВЕТОФОРА. Уведомление хранит только
 * идентификаторы (оно переживает удаление того, о чём сообщало), а дерево на
 * этом же экране уже загружено — тот же ключ кэша, без второго запроса. Узел,
 * которого в дереве нет, показывается номером: обязанность сдавать держит
 * плоский список идентификаторов, и подразделения за ним может уже не быть.
 *
 * ЛЕНТА ЖИВЁТ БЕЗ ПРАВА НА СВЕТОФОР: её гейт — аутентификация. Поэтому запрос
 * уходит и при `denied`, только имена тогда взять неоткуда.
 */
function LaggingRemindersSection({ gate }: { gate: StrengthGate }) {
  const feed = useOpsLaggingNotifications();
  const tree = useTrafficLightTree(gate === "allowed");
  const queryClient = useQueryClient();

  /**
   * POST /api/operations/notifications/{id}/read/ — снят с `/api/schema/`
   * (operationId `api_operations_notifications_read_create`): тела у запроса
   * нет, момент прочтения ставит сервер, действие идемпотентно (повторный
   * вызов момент не двигает). 404 — уведомление чужое или его уже нет.
   *
   * ОПТИМИСТИЧНОЙ ПРАВКИ КЭША ЗДЕСЬ НЕТ: onSuccess только инвалидирует
   * запрос, и лента перечитывается у сервера. Патч в кэш заранее замаскировал
   * бы отказ (404/403) видимостью успеха — строка погасла бы, а read_at на
   * сервере остался бы null.
   */
  const markRead = useOpsMutation<OpsNotification, { id: number }>({
    mutationFn: ({ id }) =>
      opsApiClient.post<OpsNotification>(`/api/operations/notifications/${id}/read/`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["ops-notifications", "feed"],
      });
    },
  });

  function handleMarkRead(id: number) {
    markRead.mutate({ id });
  }

  const names = new Map<number, string>(
    (tree.data?.nodes ?? []).map((node) => [node.division_id, node.name])
  );
  const rows = feed.data?.results ?? [];
  // Счётчик — НЕПРОЧИТАННЫЕ, а не длина ленты: отметка строки обязана его
  // уменьшить, иначе кнопка визуально ничего не меняла бы в шапке блока.
  const unreadCount = rows.filter((row) => row.read_at === null).length;
  // Один вызов на рендер — тот же приём, что `controlHour` в
  // `DaySubmissionSection` (находка ревью 22.08: было два вызова подряд).
  const controlHour = tree.data ? formatControlHour(tree.data.control_hour) : null;

  return (
    <section
      role="group"
      aria-label="Напоминания об отставших"
      className="rounded-xl border bg-card p-4"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Напоминания об отставших</h2>
          <p className="text-xs text-muted-foreground">
            {controlHour !== null
              ? `Уходят ответственным автоматически после контрольного часа ${controlHour} — одно за день.`
              : "Уходят ответственным автоматически после контрольного часа — одно за день."}
          </p>
        </div>
        {unreadCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            {unreadCount}
          </span>
        )}
      </div>

      {feed.isPending && (
        <p className="text-xs text-muted-foreground">Загрузка напоминаний…</p>
      )}
      {feed.isError && (
        <p className="text-xs text-muted-foreground">
          Лента напоминаний сейчас недоступна.
        </p>
      )}
      {feed.data && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Напоминаний нет: за вами не числится дней, о которых оповестили.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((row) => {
            const ids = row.payload.laggard_division_ids ?? [];
            const isRead = row.read_at !== null;
            return (
              <li
                key={row.id}
                // Прочитанное гаснет (muted): opacity — единственный сигнал
                // прочтения слишком тонок, поэтому слово «прочитано» ниже
                // остаётся при любой теме и остроте зрения.
                className={`flex flex-wrap items-center gap-2 border-b py-1 text-xs last:border-0 ${isRead ? "opacity-60" : ""}`}
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatBusinessDate(row.business_date)}
                </span>
                <span className="flex-1">
                  {ids.length === 0
                    ? "Отставшие в напоминании не названы"
                    : ids
                        .map((id) => names.get(id) ?? `№${id}`)
                        .join(", ")}
                </span>
                <span className="shrink-0 flex items-center gap-2 text-muted-foreground">
                  {isRead ? (
                    "прочитано"
                  ) : (
                    <>
                      не прочитано
                      {/* disabled — ОБЩИЙ на все непрочитанные строки, пока
                          мутация в полёте, а не только на кликнутую. Мутация
                          одна на блок (useOpsMutation-инстанс один), и её
                          isPending/error отражают ТОЛЬКО последний вызов —
                          пометка «занята только эта строка» по id развязала
                          бы соседние кнопки, пока первый запрос ещё летит
                          (react-query не даёт per-variables статус второй
                          мутации на том же хуке), и второй клик до ответа
                          сервера бил бы по чужому pk без видимой блокировки. */}
                      <button
                        type="button"
                        onClick={() => handleMarkRead(row.id)}
                        disabled={markRead.isPending}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Прочитано
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Молчаливый канал useOpsMutation — ТОЛЬКО 5xx и обрыв сети (тост
          внутри хука). 401/403/404 и остальное приезжают ОДНИМ OpsApiError
          без отдельной ветки на код — фича обязана показать mutation.error
          сама, что и делает блок ниже. */}
      {markRead.error !== null && (
        <p role="alert" className="mt-2 text-xs text-destructive-ink">
          Не удалось отметить уведомление прочитанным. Попробуйте ещё раз.
        </p>
      )}

      {/* Чего в разделе НЕТ — названо словами, а не нарисовано пустой кнопкой:
          эскалации руководителю (прототип обещает её на полчаса позже) бэк не
          знает вовсе, а срок рассылки — это контрольный час, отдельного
          времени напоминания в настройках нет. Экрана настройки напоминаний
          тоже нет: получателей задаёт справочник раздела. */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Эскалации руководителю и отдельного времени напоминания раздел пока не
        хранит: рассылка привязана к контрольному часу, получателей задаёт
        справочник ответственных.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Счёт и формат                                                       */
/* ------------------------------------------------------------------ */

/** Разряды разделяются вручную неразрывным пробелом: `toLocaleString` зависит
 * от ICU, а он у Node и браузера разный — числа разъезжались бы на гидрации. */
function formatNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatPercent(share: number): string {
  return `${share.toFixed(1).replace(".", ",")}%`;
}

/** Доля с одним знаком: «84,7%». Делитель ноль вызывающий отсекает сам —
 * сто процентов от ничего не бывает. */
function sharePercent(part: number, whole: number): string {
  return formatPercent((part / whole) * 100);
}
