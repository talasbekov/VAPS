"use client";

import { CapabilityNotes } from "@/shared/ui/capability-notes";

// Сводный экран оперативного рейтинга (§19.19). Экран НИЧЕГО не считает:
// агрегат, период, методика и состояние приходят готовыми. Строки
// отсортированы сервером по подписи, а не по значению: сортировка по рейтингу
// и есть таблица лидеров, запрещённая §22.16.
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useOperationalRatings } from "@/hooks/use-ops-ratings";
import { RatingsNav } from "@/features/ops-ratings/ratings-nav";
import { RatingDynamicsSection } from "@/features/ops-ratings/rating-dynamics-section";
import { DATA_STATE_LABEL } from "@/entities/operational-rating";
import type { OperationalRatingSummary } from "@/entities/operational-rating";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { isRatingScopeUnavailable, RatingReadFailure } from "@/features/ops-ratings/rating-read-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

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
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const query = useOperationalRatings({
    enabled: !permissionsLoading && hasPermission(MODULE_PERMISSION["/security-ops/ratings"]),
  });
  const data = isRatingScopeUnavailable(query.error) ? undefined : query.data;

  if (!permissionsLoading && !hasPermission(MODULE_PERMISSION["/security-ops/ratings"])) {
    return <OpsAccessDenied what="рейтингов" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Оценка и отчётность"
          title="Оперативный рейтинг"
          description="Сводные итоги. Отдельные оценки, оценщики и комментарии недоступны."
        />

        <RatingsNav />

        {(permissionsLoading || query.isLoading) && (
          <p className="text-sm text-muted-foreground">Загрузка рейтинга…</p>
        )}
        {query.error !== null && (
          /* Сырое серверное сообщение человеку не адресовано: у мутаций
             5xx уже обезличивается (use-ops-mutation), у запросов такой
             развилки не было. Плюс повтор — раньше это был тупик. */
          <RatingReadFailure
            error={query.error}
            what="оперативный рейтинг"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
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

            <section className="rounded-xl border bg-card">
              {/* Скролл теперь даёт сам примитив Table — двойная обёртка
                  overflow-x-auto давала вложенный скролл. */}
              <Table className="min-w-[48rem]">
                <caption className="sr-only">
                  Агрегированный оперативный рейтинг участников мероприятий
                </caption>
                <TableHeader>
                  <TableRow>
                    {[
                      "Сотрудник",
                      "Агрегат",
                      "Учтено оценок",
                      "Период",
                      "Состояние",
                    ].map((title) => (
                      <TableHead key={title} scope="col">
                        {title}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.capabilities.operationalRatings && data.results.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Участников рейтинга пока нет.
                      </TableCell>
                    </TableRow>
                  )}
                  {data.results.map((summary) => (
                    <TableRow key={summary.employeeId}>
                      <TableCell className="font-medium">
                        {summary.safeLabel}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {aggregateLabel(summary)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {summary.evaluationsCount}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {periodLabel(summary)}
                      </TableCell>
                      <TableCell>
                        {DATA_STATE_LABEL[summary.dataState]}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            {data.capabilities.operationalRatings && data.results.length > 0 && (
              <RatingDynamicsSection />
            )}

            <CapabilityNotes title="Как читать рейтинг" items={[...data.unavailableFactors, ...data.unavailableViews]} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
