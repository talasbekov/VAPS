"use client";

// Карточка сотрудника при праве только на агрегат (§19.17): агрегат,
// количество учтённых, период, версия методики, дата расчёта и агрегированная
// динамика — без отдельных оценок и оценщиков. Возврат ведёт на СОХРАНЁННЫЙ
// запрос реестра — он приехал параметром `back`.
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
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
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useRatingEmployeeDetail } from "@/hooks/use-ops-ratings";
import { RatingsNav } from "@/features/ops-ratings/ratings-nav";
import { DATA_STATE_LABEL } from "@/entities/operational-rating";

export default function RatingEmployeeDetailPage() {
  const params = useParams<{ employeeId: string }>();
  const searchParams = useSearchParams();
  const employeeId = params.employeeId ?? null;
  const query = useRatingEmployeeDetail(employeeId);
  const data = query.data;
  const back = searchParams.get("back") ?? "";
  const backTo =
    back === ""
      ? "/security-ops/ratings/evaluations"
      : `/security-ops/ratings/evaluations?${back}`;
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  // Тот же код, что у реестра оценок (`ratings/evaluations`), откуда сюда
  // ведёт ссылка: карточка агрегата достижима и прямой ссылкой.
  if (!permissionsLoading && !hasPermission("rating.view_aggregate")) {
    return <OpsAccessDenied what="карточки рейтинга участника" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Оценка и отчётность"
          title="Агрегированный рейтинг участника"
          actions={
            <Link className="text-sm underline" href={backTo}>
              Вернуться к отбору
            </Link>
          }
        />

        <RatingsNav />

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка карточки…</p>
        )}
        {query.error !== null && (
          <LoadFailure
            what="карточку участника"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        )}

        {data !== undefined && (
          <>
            <section
              className="rounded-xl border bg-card p-4"
              aria-label="Агрегат участника"
            >
              <h2 className="mb-2 text-sm font-semibold">
                {data.safeLabel} · {data.unitSafeLabel}
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
                <dt className="font-semibold">Итоговый рейтинг</dt>
                <dd className="tabular-nums">
                  {data.summary.aggregateRating === null
                    ? "—"
                    : String(data.summary.aggregateRating).replace(".", ",")}
                </dd>
                <dt className="font-semibold">Состояние</dt>
                <dd>{DATA_STATE_LABEL[data.summary.dataState]}</dd>
                <dt className="font-semibold">Учтено оценок</dt>
                <dd className="tabular-nums">{data.summary.evaluationsCount}</dd>
                <dt className="font-semibold">Период</dt>
                <dd>
                  {data.summary.periodStartsAt === null
                    ? "—"
                    : `${data.summary.periodStartsAt} — ${data.summary.periodEndsAt}`}
                </dd>
                <dt className="font-semibold">Методика</dt>
                <dd className="font-mono">
                  {data.summary.calculationPolicyVersion ?? "—"}
                </dd>
                <dt className="font-semibold">Рассчитано</dt>
                <dd>{data.summary.calculatedAt}</dd>
              </dl>
              {/* §19.31: канонические формулировки отсутствующего агрегата —
                  дословно; строка «Состояние» отвечает ПОЧЕМУ. */}
              {data.summary.dataState === "INSUFFICIENT_DATA" && (
                <p className="mt-2 text-xs text-muted-foreground" role="status">
                  Оценок пока недостаточно для отображения итогового рейтинга.
                </p>
              )}
              {data.summary.dataState === "POLICY_UNDEFINED" && (
                <p className="mt-2 text-xs text-muted-foreground" role="status">
                  Итоговый рейтинг пока не сформирован.
                </p>
              )}
            </section>

            <section
              className="rounded-xl border bg-card p-4"
              aria-label="Агрегированная динамика"
            >
              <h2 className="mb-2 text-sm font-semibold">
                Агрегированная динамика
              </h2>
              {data.points.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Закрытых периодов ещё нет.
                </p>
              ) : (
                <Table>
                  <caption className="sr-only">
                    Агрегаты закрытых периодов
                  </caption>
                  <TableHeader>
                    <TableRow>
                      {["Период", "Агрегат", "Учтено оценок", "Методика"].map(
                        (title) => (
                          <TableHead key={title} scope="col">
                            {title}
                          </TableHead>
                        )
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.points.map((point) => (
                      <TableRow key={point.period}>
                        <TableCell className="tabular-nums">
                          {point.period}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {/* Пропуск печатается прочерком, а не нулём. */}
                          {point.aggregateRating === null
                            ? "—"
                            : String(point.aggregateRating).replace(".", ",")}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {point.evaluationsCount}
                        </TableCell>
                        <TableCell className="font-mono">
                          {point.policyVersion}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
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
