"use client";

// Отчёт аналитики рейтинга (§22.16-22.17). Экран не считает ничего — включая
// «стандартную» восьмёрку: полосы распределения, средние по группам, покрытие
// и количество исправленных приходят готовыми; подавленная группа приходит БЕЗ
// значения, а не со скрытым в разметке. Группы отсортированы сервером по
// подписи — сортировка по значению и есть «место».
import { DashboardLayout } from "@/components/dashboard-layout";
import { BarChart3 } from "lucide-react";
import { useRatingAnalytics } from "@/hooks/use-ops-ratings";
import { RatingsNav } from "@/features/ops-ratings/ratings-nav";
import type { RatingGroupAggregate } from "@/entities/operational-rating";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

/** Формулировка §22.17 — дословно. */
const SUPPRESSED_LABEL = "Недостаточно данных для безопасного отображения";

const UNPUBLISHED_LABEL: Record<string, string> = {
  FEATURE_DISABLED:
    "Оперативный рейтинг выключен сервером — отчёт не формируется.",
  POLICY_UNDEFINED: "Методика расчёта не определена",
  SUPPRESSION_UNDEFINED:
    "Правило безопасной агрегации не задано в «Настройках» — отчёт не публикуется. Порог приватности выбирает политика, а не экран.",
};

function groupValue(group: RatingGroupAggregate): string {
  if (group.state === "SUPPRESSED") return SUPPRESSED_LABEL;
  if (group.state === "NO_AGGREGATE") return "Рассчитанных агрегатов нет";
  return String(group.aggregateRating).replace(".", ",");
}

export default function RatingAnalyticsPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const query = useRatingAnalytics();
  const data = query.data;
  const figures = data?.figures ?? null;

  if (!permissionsLoading && !hasPermission("analytics.view")) {
    return <OpsAccessDenied what="аналитики рейтинга" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Аналитика рейтинга</h1>
            <p className="text-muted-foreground">
              Только агрегированные значения. Отдельные оценки, оценщики и
              комментарии в отчёт не входят и с сервера не запрашиваются.
            </p>
          </div>
        </div>

        <RatingsNav />

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка отчёта…</p>
        )}
        {query.error !== null && (
          <p className="text-sm text-destructive">{query.error.message}</p>
        )}

        {data !== undefined && data.unpublishedReason !== null && (
          <p className="rounded-xl border bg-card p-4 text-sm">
            {UNPUBLISHED_LABEL[data.unpublishedReason]}
          </p>
        )}

        {data !== undefined && figures !== null && (
          <>
            <section
              className="rounded-xl border bg-card p-4"
              aria-label="Условия отчёта"
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr_auto_1fr]">
                <dt className="font-semibold">Действующая методика</dt>
                <dd className="font-mono">{data.policy?.policyVersion}</dd>
                <dt className="font-semibold">Разрешённый период</dt>
                <dd>
                  {data.periodStartsAt} — {data.periodEndsAt}
                </dd>
                <dt className="font-semibold">Минимум оценок</dt>
                <dd>{data.policy?.minEvaluations}</dd>
                <dt className="font-semibold">Порог безопасной агрегации</dt>
                <dd>{data.suppressionMinGroupSize}</dd>
              </dl>
            </section>

            <section
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              aria-label="Количественные показатели"
            >
              {[
                {
                  label: "С рассчитанным агрегатом",
                  value: figures.ratedParticipants,
                },
                {
                  label: "Покрытие оцениванием",
                  value: `${figures.coveredParticipants} из ${figures.totalParticipants}`,
                },
                { label: "Без готового агрегата", value: figures.withoutAggregate },
                {
                  label: "Исправленных оценок",
                  value: figures.correctedEvaluations,
                },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border bg-card p-4">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-2xl font-bold tabular-nums">{item.value}</p>
                </div>
              ))}
            </section>

            <section className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full border-collapse text-left">
                <caption className="p-3 text-left text-sm font-semibold">
                  Распределение агрегированных значений
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="p-3 text-[11px] font-semibold text-muted-foreground"
                    >
                      Полоса
                    </th>
                    <th
                      scope="col"
                      className="p-3 text-[11px] font-semibold text-muted-foreground"
                    >
                      Участников
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {figures.distribution.map((band) => (
                    <tr key={band.code} className="border-t">
                      <td className="p-3 text-sm">{band.label}</td>
                      <td className="p-3 text-sm tabular-nums">{band.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full border-collapse text-left">
                <caption className="p-3 text-left text-sm font-semibold">
                  Агрегат по группам участников
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="p-3 text-[11px] font-semibold text-muted-foreground"
                    >
                      Группа
                    </th>
                    <th
                      scope="col"
                      className="p-3 text-[11px] font-semibold text-muted-foreground"
                    >
                      Агрегат
                    </th>
                    <th
                      scope="col"
                      className="p-3 text-[11px] font-semibold text-muted-foreground"
                    >
                      С агрегатом
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {figures.groups.map((group) => (
                    <tr key={group.groupCode} className="border-t align-top">
                      <td className="p-3 text-sm font-medium">
                        {group.safeLabel}
                      </td>
                      <td className="p-3 text-sm tabular-nums">
                        {groupValue(group)}
                      </td>
                      <td className="p-3 text-sm tabular-nums">
                        {group.ratedCount} из {group.memberCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">
                Что в отчёт не входит
              </h2>
              <ul className="flex flex-col gap-2">
                {data.unavailableViews.map((view) => (
                  <li key={view.code} className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {view.label}.{" "}
                    </span>
                    {view.reason}
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
