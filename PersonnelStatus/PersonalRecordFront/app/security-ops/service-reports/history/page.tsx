"use client";

// История отчётов (§22.25). Экран не решает, что можно делать со строкой:
// доступность каждого действия и причина отказа приходят с сервера — здесь
// нет ни одной ветки «если работа упала, выключить кнопку».
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { History } from "lucide-react";
import {
  useDownloadArtifact,
  useReportJobs,
  useRerunReportJob,
} from "@/hooks/use-ops-reports";
import {
  ACTION_LABEL,
  JOB_STATE_LABEL,
  formatMoment,
  formatSize,
  saveFile,
} from "@/features/ops-reports/report-shared";
import type {
  ReportArtifactSummary,
  ReportJobAction,
  ReportJobState,
} from "@/entities/service-report";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

/** Порядок фильтра состояний — порядок жизни работы, а не алфавит. */
const STATE_FILTERS: readonly ReportJobState[] = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
];

function isState(value: string | null): value is ReportJobState {
  return value !== null && STATE_FILTERS.includes(value as ReportJobState);
}

export default function ReportHistoryPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  // Фильтры — в URL: ссылка на отфильтрованную историю переживает
  // перезагрузку и пересылается другому человеку.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stateParam = searchParams.get("state");
  const state = isState(stateParam) ? stateParam : undefined;
  const mine = searchParams.get("mine") === "true";

  const jobsQuery = useReportJobs({ state, mine });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const download = useDownloadArtifact((file) => saveFile(file.fileName, file.content));
  const rerun = useRerunReportJob((result) => {
    // Два исхода §22.25 названы разными словами: «отдан прежний файл» и
    // «запущена новая работа» — разные события.
    setNotice(
      result.reused
        ? "Готовый артефакт с теми же параметрами уже есть — новая работа не запускалась."
        : "Запущена новая работа с теми же параметрами."
    );
  });

  const artifactsByJob = useMemo(() => {
    const map = new Map<string, ReportArtifactSummary>();
    for (const artifact of jobsQuery.data?.artifacts ?? [])
      map.set(artifact.reportJobId, artifact);
    return map;
  }, [jobsQuery.data]);

  const actionsByJob = useMemo(() => {
    const map = new Map<string, ReportJobAction[]>();
    for (const entry of jobsQuery.data?.actions ?? [])
      map.set(entry.reportJobId, entry.actions);
    return map;
  }, [jobsQuery.data]);

  function updateFilter(key: "state" | "mine", value: string | null): void {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    const queryString = next.toString();
    router.replace(queryString === "" ? pathname : `${pathname}?${queryString}`);
  }

  const data = jobsQuery.data;

  if (!permissionsLoading && !hasPermission("report.generate")) {
    return <OpsAccessDenied what="истории отчётов" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <History className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">История отчётов</h1>
            <p className="text-muted-foreground">
              Работы и артефакты, доступные вам, с параметрами, редакциями и
              сроком хранения.
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Разделы отчётов">
          <Link
            href="/security-ops/service-reports"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Запуск отчёта
          </Link>
          <span className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            История отчётов
          </span>
        </nav>

        <section
          role="group"
          aria-label="Фильтры истории отчётов"
          className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
        >
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Состояние
            <select
              aria-label="Состояние работы"
              className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
              value={state ?? ""}
              onChange={(event) =>
                updateFilter(
                  "state",
                  event.target.value === "" ? null : event.target.value
                )
              }
            >
              <option value="">Все состояния</option>
              {STATE_FILTERS.map((code) => (
                <option key={code} value={code}>
                  {JOB_STATE_LABEL[code]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={mine}
              onChange={(event) =>
                updateFilter("mine", event.target.checked ? "true" : null)
              }
            />
            Только мои запуски
          </label>
          <p className="text-xs text-muted-foreground">
            Фильтры применяет сервер: строки, которые не показаны, в браузер не
            приезжают (§22.24).
          </p>
        </section>

        {notice !== null && (
          <p role="status" className="text-sm font-semibold text-primary">
            {notice}
          </p>
        )}
        {rerun.error !== null && (
          <p className="text-sm text-destructive">{rerun.error.message}</p>
        )}
        {download.error !== null && (
          <p className="text-sm text-destructive">{download.error.message}</p>
        )}

        <section className="rounded-xl border bg-card p-4">
          {jobsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Загрузка истории…</p>
          ) : data === undefined ? (
            // Развилка была на `data === undefined` без ветки ошибки: после
            // retry: 1 экран застревал в «Загрузка истории…» навсегда.
            <LoadFailure
              what="историю отчётов"
              onRetry={() => void jobsQuery.refetch()}
              isRetrying={jobsQuery.isFetching}
            />
          ) : data.results.length === 0 ? (
            // «Ничего не нашлось» и «отчётов ещё не запускали» — разные факты.
            <p className="text-sm text-muted-foreground">
              {data.totalVisible === 0
                ? "Отчёты ещё не запускались."
                : "По выбранным фильтрам работ нет."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">Отчёт</th>
                    <th className="py-2 pr-3 font-semibold">Период</th>
                    <th className="py-2 pr-3 font-semibold">Формат</th>
                    <th className="py-2 pr-3 font-semibold">Состояние</th>
                    <th className="py-2 pr-3 font-semibold">Редакция</th>
                    <th className="py-2 pr-3 font-semibold">Сформировал</th>
                    <th className="py-2 pr-3 font-semibold">Создан</th>
                    <th className="py-2 pr-3 font-semibold">Завершён</th>
                    <th className="py-2 pr-3 font-semibold">Срок доступности</th>
                    <th className="py-2 font-semibold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((job) => {
                    const artifact = artifactsByJob.get(job.reportJobId) ?? null;
                    const actions = actionsByJob.get(job.reportJobId) ?? [];
                    return (
                      <tr
                        key={job.reportJobId}
                        className="border-b align-top last:border-0"
                      >
                        <td className="py-2 pr-3">
                          <Link
                            className="font-semibold text-primary underline"
                            href={`/security-ops/service-reports/${job.reportJobId}`}
                          >
                            {artifact?.safeTitle ?? job.reportTypeCode}
                          </Link>
                          {job.sensitive && (
                            <span className="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                              Со скрытыми полями
                            </span>
                          )}
                        </td>
                        {/* §22.26: период чужого запуска сюда не приезжает. */}
                        <td className="py-2 pr-3">
                          {job.parameters === null ? (
                            <span className="text-muted-foreground">
                              скрыт (чужой запуск)
                            </span>
                          ) : (
                            `${job.parameters.from} — ${job.parameters.to}`
                          )}
                        </td>
                        <td className="py-2 pr-3">{job.format}</td>
                        <td className="py-2 pr-3 font-semibold">
                          {JOB_STATE_LABEL[job.state]}
                        </td>
                        {/* Редакция — свойство собранного артефакта. */}
                        <td className="py-2 pr-3">
                          {artifact === null ? "—" : artifact.revision}
                        </td>
                        <td className="py-2 pr-3">{job.createdBy.safeLabel}</td>
                        <td className="py-2 pr-3">{formatMoment(job.createdAt)}</td>
                        <td className="py-2 pr-3">
                          {job.completedAt === null
                            ? "—"
                            : formatMoment(job.completedAt)}
                        </td>
                        <td className="py-2 pr-3">
                          {artifact === null
                            ? "—"
                            : artifact.available
                              ? `до ${formatMoment(artifact.expiresAt)}`
                              : "срок истёк"}
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {actions.map((action) => (
                              <button
                                key={action.code}
                                type="button"
                                className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
                                disabled={
                                  !action.available ||
                                  download.isPending ||
                                  rerun.isPending
                                }
                                title={action.reason ?? undefined}
                                onClick={() => {
                                  setNotice(null);
                                  if (action.code === "OPEN_PARAMETERS") {
                                    setExpanded((current) =>
                                      current === job.reportJobId
                                        ? null
                                        : job.reportJobId
                                    );
                                  } else if (action.code === "VIEW_ERROR") {
                                    setErrorShown((current) =>
                                      current === job.reportJobId
                                        ? null
                                        : job.reportJobId
                                    );
                                  } else if (
                                    action.code === "DOWNLOAD" &&
                                    artifact !== null
                                  ) {
                                    download.mutate({
                                      artifactId: artifact.artifactId,
                                    });
                                  } else if (action.code === "RETRY") {
                                    rerun.mutate({
                                      reportJobId: job.reportJobId,
                                      mode: "RETRY",
                                    });
                                  } else if (action.code === "NEW_REVISION") {
                                    rerun.mutate({
                                      reportJobId: job.reportJobId,
                                      mode: "NEW_REVISION",
                                    });
                                  }
                                }}
                              >
                                {ACTION_LABEL[action.code]}
                              </button>
                            ))}
                          </div>

                          {expanded === job.reportJobId && (
                            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <dt className="font-semibold">Период</dt>
                              <dd>
                                {job.parameters === null
                                  ? job.parametersRedactedReason
                                  : `${job.parameters.from} — ${job.parameters.to} (границы включительно)`}
                              </dd>
                              <dt className="font-semibold">Режим выгрузки</dt>
                              <dd>
                                {job.sensitive ? "со скрытыми полями" : "обычный"}
                              </dd>
                              <dt className="font-semibold">Ключ идемпотентности</dt>
                              <dd>{job.idempotencyKey}</dd>
                              {artifact !== null && (
                                <>
                                  <dt className="font-semibold">Расчёт</dt>
                                  <dd>{artifact.calculationVersion}</dd>
                                  <dt className="font-semibold">Маскирование</dt>
                                  <dd>{artifact.maskingPolicyVersion}</dd>
                                  <dt className="font-semibold">Размер</dt>
                                  <dd>
                                    {formatSize(artifact.fileSize)} · контрольная
                                    сумма {artifact.hash}
                                  </dd>
                                </>
                              )}
                            </dl>
                          )}
                          {errorShown === job.reportJobId &&
                            job.safeFailureMessage !== null && (
                              <p className="mt-2 text-xs text-destructive">
                                {job.failureCode}: {job.safeFailureMessage}
                              </p>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {data !== undefined && (
          <section className="rounded-xl border border-dashed bg-muted/30 p-4">
            <h2 className="mb-2 text-sm font-semibold">
              Колонок §22.25, которых здесь нет
            </h2>
            <ul className="flex flex-col gap-2">
              {data.unavailableColumns.map((column) => (
                <li key={column.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {column.label}
                  </span>{" "}
                  — {column.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
