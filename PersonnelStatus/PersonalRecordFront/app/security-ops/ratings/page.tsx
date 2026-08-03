"use client";

// Сводный экран оперативного рейтинга (§19.19). Экран НИЧЕГО не считает:
// агрегат, период, методика и состояние приходят готовыми. Строки
// отсортированы сервером по подписи, а не по значению: сортировка по рейтингу
// и есть таблица лидеров, запрещённая §22.16.
import { DashboardLayout } from "@/components/dashboard-layout";
import { Star } from "lucide-react";
import { useOperationalRatings } from "@/hooks/use-ops-ratings";
import { RatingsNav } from "@/features/ops-ratings/ratings-nav";
import { RatingDynamicsSection } from "@/features/ops-ratings/rating-dynamics-section";
import { DATA_STATE_LABEL } from "@/entities/operational-rating";
import type { OperationalRatingSummary } from "@/entities/operational-rating";

/** Печать канонического значения: округляет сервер, здесь только запятая —
 * toFixed был бы округлением на клиенте. */
function aggregateLabel(summary: OperationalRatingSummary): string {
  if (summary.aggregateRating === null) return "—";
  return String(summary.aggregateRating).replace(".", ",");
}

function periodLabel(summary: OperationalRatingSummary): string {
  if (summary.periodStartsAt === null || summary.periodEndsAt === null)
    return "—";
  return `${summary.periodStartsAt} — ${summary.periodEndsAt}`;
}

export default function OperationalRatingsPage() {
  const query = useOperationalRatings();
  const data = query.data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Star className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Оперативный рейтинг</h1>
            <p className="text-muted-foreground">
              Агрегированные итоги оценивания участников мероприятий. Отдельные
              оценки, оценщики и комментарии закрыты и на сервере не
              запрашиваются.
            </p>
          </div>
        </div>

        <RatingsNav />

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка рейтинга…</p>
        )}
        {query.error !== null && (
          <p className="text-sm text-destructive">{query.error.message}</p>
        )}

        {data !== undefined && (
          <>
            {!data.capabilities.operationalRatings && (
              <p className="rounded-xl border bg-card p-4 text-sm">
                Оперативный рейтинг пока недоступен: функция выключена сервером
                (ENABLE_OPERATIONAL_RATINGS). Это не рейтинг «0» — оценок нет
                ни у кого, потому что их никто не выставлял.
              </p>
            )}

            <section
              className="rounded-xl border bg-card p-4"
              aria-label="Методика расчёта"
            >
              {data.policy === null ? (
                <p className="text-sm">Методика расчёта не определена</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr_auto_1fr]">
                  <dt className="font-semibold">Методика</dt>
                  <dd className="font-mono">{data.policy.policyVersion}</dd>
                  <dt className="font-semibold">Период расчёта</dt>
                  <dd>{data.policy.periodDays} сут.</dd>
                  <dt className="font-semibold">Минимум оценок</dt>
                  <dd>{data.policy.minEvaluations}</dd>
                  <dt className="font-semibold">Шкала</dt>
                  <dd>1–10</dd>
                </dl>
              )}
            </section>

            <section className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Агрегированный оперативный рейтинг участников мероприятий
                </caption>
                <thead>
                  <tr>
                    {[
                      "Сотрудник",
                      "Агрегат",
                      "Учтено оценок",
                      "Период",
                      "Состояние",
                    ].map((title) => (
                      <th
                        key={title}
                        scope="col"
                        className="p-3 text-[11px] font-semibold text-muted-foreground"
                      >
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((summary) => (
                    <tr key={summary.employeeId} className="border-t align-top">
                      <td className="p-3 text-sm font-medium">
                        {summary.safeLabel}
                      </td>
                      <td className="p-3 text-sm tabular-nums">
                        {aggregateLabel(summary)}
                      </td>
                      <td className="p-3 text-sm tabular-nums">
                        {summary.evaluationsCount}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {periodLabel(summary)}
                      </td>
                      <td className="p-3 text-xs">
                        {DATA_STATE_LABEL[summary.dataState]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <RatingDynamicsSection />

            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">
                Что в расчёт не входит
              </h2>
              <ul className="flex flex-col gap-2">
                {data.unavailableFactors.map((factor) => (
                  <li key={factor.code} className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {factor.label}.{" "}
                    </span>
                    {factor.reason}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Что не показывается</h2>
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
