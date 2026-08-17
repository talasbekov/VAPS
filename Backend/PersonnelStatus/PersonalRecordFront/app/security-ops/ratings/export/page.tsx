"use client";

// Экспорт оперативного рейтинга (§19.29). Экран не собирает файл, не
// придумывает ему имя и не строит ссылку: кнопка «Скачать» появляется, когда
// работа READY и у неё есть артефакт, а сам файл выдаёт отдельная серверная
// операция. Недоступные форматы и режимы приходят с сервера С ПРИЧИНОЙ.
import { useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { FileDown } from "lucide-react";
import {
  useCancelRatingExport,
  useCreateRatingExport,
  useDownloadRatingExport,
  useRatingExports,
} from "@/hooks/use-ops-ratings";
import { RatingsNav } from "@/features/ops-ratings/ratings-nav";
import { newIdempotencyKey } from "@/entities/operational-rating";
import type {
  RatingExportJob,
  RatingExportScope,
} from "@/entities/operational-rating";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

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

function saveFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function dateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

export default function RatingExportPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const query = useRatingExports();
  const data = query.data;
  // Ключ живёт ОДИН заказ и переживает его повторные отправки (§19.26).
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const create = useCreateRatingExport();
  const cancel = useCancelRatingExport();
  const download = useDownloadRatingExport((file) =>
    saveFile(file.fileName, file.content)
  );

  const artifactsByJob = new Map(
    (data?.artifacts ?? []).map((artifact) => [artifact.exportJobId, artifact])
  );

  if (!permissionsLoading && !hasPermission("rating.export")) {
    return <OpsAccessDenied what="выгрузок рейтинга" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <FileDown className="h-8 w-8 text-primary-ink" />
          <div>
            <h1 className="text-2xl font-bold">Выгрузка рейтинга</h1>
            <p className="text-muted-foreground">
              Агрегированная сводка оперативного рейтинга. Отдельных оценок,
              оценщиков, комментариев и оснований в файле нет — он собирается из
              той же сводки, что и экран.
            </p>
          </div>
        </div>

        <RatingsNav />

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка выгрузок…</p>
        )}
        {query.error !== null && (
          <p className="text-sm text-destructive-ink">{query.error.message}</p>
        )}

        {data !== undefined && (
          <>
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Заказать выгрузку</h2>
              {!data.capabilities.operationalRatings && (
                <p className="mb-2 text-xs text-destructive-ink">
                  Оперативный рейтинг выключен: сводки, из которой собирается
                  файл, не существует.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {SCOPE_LABEL.AGGREGATE} · {data.formats.join(", ")}
                </span>
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                  disabled={
                    create.isPending || !data.capabilities.operationalRatings
                  }
                  onClick={() => {
                    create.mutate({
                      scope: "AGGREGATE",
                      format: "CSV",
                      idempotencyKey,
                    });
                    // Следующий заказ — СВОЙ ключ: иначе повтор через минуту
                    // вернул бы прежнюю работу вместо новой выгрузки.
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                >
                  Заказать CSV
                </button>
              </div>
              {create.error !== null && (
                <p className="mt-2 text-sm text-destructive-ink">
                  {create.error.message}
                </p>
              )}
            </section>

            <section className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Мои выгрузки рейтинга</caption>
                <thead>
                  <tr>
                    {[
                      "Заказана",
                      "Что выгружается",
                      "Формат",
                      "Состояние",
                      "Файл",
                      "Действия",
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
                  {data.results.map((job) => {
                    const artifact = artifactsByJob.get(job.exportJobId);
                    return (
                      <tr key={job.exportJobId} className="border-t align-top">
                        <td className="p-3 text-xs tabular-nums">
                          {dateTime(job.createdAt)}
                        </td>
                        <td className="p-3 text-sm">{SCOPE_LABEL[job.scope]}</td>
                        <td className="p-3 text-xs">{job.format}</td>
                        <td className="p-3 text-xs">
                          {STATE_LABEL[job.state]}
                          {job.safeFailureMessage !== null && (
                            <span className="ml-1 text-muted-foreground">
                              {job.safeFailureMessage}
                            </span>
                          )}
                        </td>
                        {/* Ссылки на файл в строке нет: пока сервер не отдал
                            артефакт, показывать нечего. */}
                        <td className="p-3 text-xs text-muted-foreground">
                          {artifact === undefined
                            ? "—"
                            : `${artifact.fileName} · строк ${artifact.rowCount}`}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            {job.state === "READY" && artifact !== undefined && (
                              <button
                                type="button"
                                className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
                                disabled={download.isPending}
                                onClick={() =>
                                  download.mutate({
                                    artifactId: artifact.artifactId,
                                  })
                                }
                              >
                                Скачать
                              </button>
                            )}
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.results.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  Выгрузок пока нет.
                </p>
              )}
            </section>

            {download.error !== null && (
              <p className="text-sm text-destructive-ink">
                {download.error.message}
              </p>
            )}
            {cancel.error !== null && (
              <p className="text-sm text-destructive-ink">{cancel.error.message}</p>
            )}

            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Что не выгружается</h2>
              <ul className="flex flex-col gap-2">
                {[...data.unavailableScopes, ...data.unavailableFormats].map(
                  (view) => (
                    <li
                      key={view.code}
                      className="text-xs text-muted-foreground"
                    >
                      <span className="font-semibold text-foreground">
                        {view.label}.{" "}
                      </span>
                      {view.reason}
                    </li>
                  )
                )}
              </ul>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
