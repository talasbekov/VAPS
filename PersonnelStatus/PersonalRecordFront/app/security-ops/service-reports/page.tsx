"use client";

// Отчётный реестр службы (§22.18-22.25, §20.32): запуск отчёта, состояния
// работы, метаданные артефакта и скачивание. Экран НИЧЕГО не формирует сам:
// выборка строк, маскирование и сборка файла живут на сервере (§22.24), сюда
// приходят метаданные; содержимое появляется в памяти вкладки ровно на время
// сохранения файла.
import { useMemo, useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import {
  useCreateReportJob,
  useDownloadArtifact,
  useReportJobs,
  useReportTypes,
} from "@/hooks/use-ops-reports";
import {
  JOB_STATE_LABEL,
  formatMoment,
  formatSize,
  saveFile,
} from "@/features/ops-reports/report-shared";
import type {
  ReportArtifactSummary,
  ReportJobState,
} from "@/entities/service-report";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

const JOB_STATE_CLASS: Record<ReportJobState, string> = {
  PENDING:
    "inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground",
  PROCESSING:
    "inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800",
  COMPLETED:
    "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-900",
  FAILED:
    "inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800",
};

export default function ServiceReportsPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const typesQuery = useReportTypes();
  const jobsQuery = useReportJobs();
  const createJob = useCreateReportJob();
  const download = useDownloadArtifact((file) => saveFile(file.fileName, file.content));

  const reportType = typesQuery.data?.results[0] ?? null;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [attempt, setAttempt] = useState(1);

  const artifactsByJob = useMemo(() => {
    const map = new Map<string, ReportArtifactSummary>();
    for (const artifact of jobsQuery.data?.artifacts ?? [])
      map.set(artifact.reportJobId, artifact);
    return map;
  }, [jobsQuery.data]);

  function submit(): void {
    if (reportType === null) return;
    createJob.mutate({
      reportTypeCode: reportType.reportTypeCode,
      format: "CSV",
      from,
      to,
      sensitive,
      // §22.21: ключ определяется ПАРАМЕТРАМИ запроса — повторный клик по той
      // же форме не создаёт вторую работу; attempt растёт после запуска, и
      // осознанный повтор тех же параметров остаётся возможным.
      idempotencyKey: `${reportType.reportTypeCode}:${from}:${to}:${sensitive ? "S" : "N"}:${attempt}`,
    });
    setAttempt((value) => value + 1);
  }

  if (!permissionsLoading && !hasPermission("report.generate")) {
    return <OpsAccessDenied what="служебных отчётов" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Отчёты службы"
          description="Асинхронное формирование отчётов, метаданные артефактов и выгрузка."
        />

        <nav className="flex flex-wrap gap-2" aria-label="Разделы отчётов">
          <span className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Запуск отчёта
          </span>
          <Link
            href="/security-ops/service-reports/history"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            История отчётов
          </Link>
        </nav>

        {typesQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        )}
        {typesQuery.isError && (
          <LoadFailure
            what="типы отчётов"
            onRetry={() => void typesQuery.refetch()}
            isRetrying={typesQuery.isFetching}
          />
        )}

        {reportType !== null && typesQuery.data !== undefined && (
          <section
            role="group"
            aria-label="Форма запуска отчёта"
            className="rounded-xl border bg-card p-4"
          >
            <div className="mb-1 text-sm font-semibold">{reportType.safeTitle}</div>
            <p className="mb-3 text-xs text-muted-foreground">
              {reportType.description}
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Начало периода
                <input
                  type="date"
                  className="rounded-md border bg-background p-2 text-sm font-normal"
                  aria-label="Начало периода"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Конец периода
                <input
                  type="date"
                  className="rounded-md border bg-background p-2 text-sm font-normal"
                  aria-label="Конец периода"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={sensitive}
                  disabled={!typesQuery.data.canExportSensitive}
                  onChange={(event) => setSensitive(event.target.checked)}
                />
                Включить скрытые поля (sensitive export)
              </label>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                onClick={submit}
                disabled={
                  createJob.isPending ||
                  from === "" ||
                  to === "" ||
                  // Недоступность типа решил СЕРВЕР (§22.5) — экран её не
                  // выводит сам.
                  reportType.unavailableReason !== null
                }
              >
                Сформировать отчёт
              </button>
            </div>

            {!typesQuery.data.canExportSensitive && (
              <p className="mt-2 text-xs text-muted-foreground">
                Sensitive export недоступен: нужно отдельное право выгрузки
                скрытых полей (ops.report.export_sensitive) — право формировать
                отчёт его не включает (§20.32).
              </p>
            )}
            {reportType.unavailableReason !== null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {reportType.unavailableReason}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Период — не длиннее {reportType.maxPeriodDays} дней (значение
                приходит из политики «Настроек», а не задано в форме). Артефакт
                хранится {typesQuery.data.retentionPolicy.retentionDays} дней
                (редакция политики {typesQuery.data.retentionPolicy.policyVersion}).
              </p>
            )}
            {createJob.error !== null && (
              <p className="mt-2 text-xs text-destructive-ink">
                {createJob.error.message}
              </p>
            )}
          </section>
        )}

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Работы и артефакты</h2>
          {jobsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Загрузка реестра…</p>
          ) : jobsQuery.data === undefined ? (
            <LoadFailure
              what="реестр работ"
              onRetry={() => void jobsQuery.refetch()}
              isRetrying={jobsQuery.isFetching}
            />
          ) : jobsQuery.data.results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Отчёты ещё не запускались.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {jobsQuery.data.results.map((job) => {
                const artifact = artifactsByJob.get(job.reportJobId) ?? null;
                return (
                  <li key={job.reportJobId} className="rounded-lg border p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className={JOB_STATE_CLASS[job.state]}>
                        {JOB_STATE_LABEL[job.state]}
                      </span>
                      {/* §22.26: у чужого запуска периода в ответе нет вовсе. */}
                      <span className="text-sm font-semibold">
                        {job.parameters === null
                          ? "период скрыт (чужой запуск)"
                          : `${job.parameters.from} — ${job.parameters.to}`}
                      </span>
                      {job.sensitive && (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                          Со скрытыми полями
                        </span>
                      )}
                      {job.progressPercent !== null && job.state === "PROCESSING" && (
                        <span className="text-[11px] text-muted-foreground">
                          {job.progressPercent}%
                        </span>
                      )}
                      <Link
                        className="text-xs underline"
                        href={`/security-ops/service-reports/${job.reportJobId}`}
                      >
                        Карточка работы
                      </Link>
                    </div>

                    {/* §22.21 «Success показывай только после COMPLETED и
                        получения artifactId». */}
                    {artifact === null ? (
                      <p className="text-xs text-muted-foreground">
                        {job.state === "FAILED"
                          ? `${job.failureCode}: ${job.safeFailureMessage}`
                          : "Артефакт ещё не сформирован — отчёт готовится на сервере."}
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        <span>
                          Сформирован {formatMoment(artifact.generatedAt)} · редакция{" "}
                          {artifact.revision} · {formatSize(artifact.fileSize)} ·
                          контрольная сумма {artifact.hash}
                        </span>
                        <span>
                          Расчёт {artifact.calculationVersion} · маскирование{" "}
                          {artifact.maskingPolicyVersion}
                        </span>
                        <span>
                          {artifact.available
                            ? `Доступен до ${formatMoment(artifact.expiresAt)}`
                            : "Срок хранения истёк"}
                        </span>
                        <div>
                          <button
                            type="button"
                            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                            disabled={!artifact.available || download.isPending}
                            title={
                              artifact.available ? undefined : "Срок хранения истёк"
                            }
                            onClick={() =>
                              download.mutate({ artifactId: artifact.artifactId })
                            }
                          >
                            Скачать CSV
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {download.error !== null && (
            <p className="mt-2 text-xs text-destructive-ink">
              {download.error.message}
            </p>
          )}
        </section>

        {typesQuery.data !== undefined && (
          <section className="rounded-xl border border-dashed bg-muted/30 p-4">
            <h2 className="mb-2 text-sm font-semibold">
              Что отчёт не содержит и почему
            </h2>
            <ul className="flex flex-col gap-2">
              {[
                ...typesQuery.data.maskedFields,
                ...typesQuery.data.unavailableFormats,
                ...typesQuery.data.unavailableArtifactFields,
              ].map((item) => (
                <li key={item.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{item.label}</span>{" "}
                  — {item.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
