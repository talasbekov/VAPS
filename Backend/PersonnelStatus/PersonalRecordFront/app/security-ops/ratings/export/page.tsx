"use client";

import { CapabilityNotes } from "@/shared/ui/capability-notes";

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
import {
  useCancelRatingExport,
  useRatingExports,
} from "@/hooks/use-ops-ratings";
import { RatingsNav } from "@/features/ops-ratings/ratings-nav";
import type {
  RatingExportJob,
  RatingExportScope,
} from "@/entities/operational-rating";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { formatIsoDateTime } from "@/shared/lib/date";

const STATE_LABEL: Record<RatingExportJob["state"], string> = {
  QUEUED: "В очереди",
  GENERATING: "Формируется",
  READY: "Готов",
  FAILED: "Ошибка",
  CANCELLED: "Отменён",
};

const SCOPE_LABEL: Record<RatingExportScope, string> = {
  AGGREGATE: "Агрегированная сводка",
  INDIVIDUAL: "Индивидуальные оценки",
};

// Момент печатается модулем `formatIsoDateTime` (Plane №935): своя копия
// отдавала сырую ISO-строку вместо «—» и печатала секунды, которых на экране
// нет ни у кого. Один формат на все экраны — «дд.мм.гггг, чч:мм».

export default function RatingExportPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const query = useRatingExports();
  const data = query.data;
  const cancel = useCancelRatingExport();

  const artifactsByJob = new Map(
    (data?.artifacts ?? []).map((artifact) => [artifact.exportJobId, artifact])
  );

  if (!permissionsLoading && !hasPermission("rating.export")) {
    return <OpsAccessDenied what="выгрузок рейтинга" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Оценка и отчётность"
          title="История выгрузок рейтинга"
          description="Ранее созданные выгрузки оперативного рейтинга и состояния их обработки."
        />

        <RatingsNav />

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка выгрузок…</p>
        )}
        {query.error !== null && (
          <LoadFailure
            what="выгрузки рейтинга"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        )}

        {data !== undefined && (
          <>
            <section className="rounded-xl border bg-card">
              <Table>
                <caption className="sr-only">Мои выгрузки рейтинга</caption>
                <TableHeader>
                  <TableRow>
                    {[
                      "Заказана",
                      "Что выгружается",
                      "Формат",
                      "Состояние",
                      "Файл",
                      "Действия",
                    ].map((title) => (
                      <TableHead key={title} scope="col">
                        {title}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.results.map((job) => {
                    const artifact = artifactsByJob.get(job.exportJobId);
                    return (
                      <TableRow key={job.exportJobId}>
                        <TableCell className="tabular-nums">
                          {formatIsoDateTime(job.createdAt)}
                        </TableCell>
                        <TableCell>{SCOPE_LABEL[job.scope]}</TableCell>
                        <TableCell>{job.format}</TableCell>
                        <TableCell>
                          {STATE_LABEL[job.state]}
                          {job.safeFailureMessage !== null && (
                            <span className="ml-1 text-muted-foreground">
                              {job.safeFailureMessage}
                            </span>
                          )}
                        </TableCell>
                        {/* Ссылки на файл в строке нет: пока сервер не отдал
                            артефакт, показывать нечего. */}
                        <TableCell className="text-muted-foreground">
                          {artifact === undefined
                            ? "—"
                            : `${artifact.fileName} · строк ${artifact.rowCount}`}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {(job.state === "QUEUED" ||
                              job.state === "GENERATING") && (
                              <button
                                type="button"
                                className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
                                disabled={cancel.isPending}
                                onClick={() =>
                                  cancel.mutate({ exportJobId: job.exportJobId })
                                }
                              >
                                Отменить
                              </button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {data.results.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  Выгрузок пока нет.
                </p>
              )}
            </section>

            {cancel.error !== null && (
              <p className="text-sm text-destructive-ink">{cancel.error.message}</p>
            )}

            <CapabilityNotes title="Состав и форматы выгрузки" items={[...data.unavailableScopes, ...data.unavailableFormats]} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
