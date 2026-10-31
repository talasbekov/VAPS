"use client";

import { CapabilityNotes } from "@/shared/ui/capability-notes";

// Карточка работы отчёта (§22.27 «Прямые ссылки», §22.28). Доступ
// перепроверяется на каждый запрос карточки; параметры чужого запуска сюда не
// приезжают — сервер вырезает их из ответа, экран печатает причину.
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { LoadFailure } from "@/components/load-failure";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { PageHeader } from "@/components/page-header";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  useReportJob,
} from "@/hooks/use-ops-reports";
import {
  JOB_STATE_LABEL,
  formatMoment,
  formatSize,
} from "@/features/ops-reports/report-shared";

export default function ReportJobPage() {
  const queryClient = useQueryClient();
  const params = useParams<{ reportJobId: string }>();
  const reportJobId = params.reportJobId ?? "";
  const jobQuery = useReportJob(reportJobId);

  const { hasPermission, isLoading: permissionsLoading, error: permissionsError } = useOpsPermissions();

  // Выше ветки jobQuery.error: без гварда отказ по правам приезжал сюда как
  // 403 и печатался экраном «Работа недоступна» — той же формулировкой, что
  // и чужой/удалённый запуск.
  if (permissionsError) {
    return <DashboardLayout><LoadFailure what="права доступа к отчётам" onRetry={() => void queryClient.resetQueries({ queryKey: ["ops-me"], exact: true })} /></DashboardLayout>;
  }
  if (permissionsLoading) {
    return <DashboardLayout><p role="status">Проверяем доступ к отчётам…</p></DashboardLayout>;
  }
  if (!hasPermission("report.generate")) {
    return <OpsAccessDenied what="карточки работы отчёта" />;
  }

  if (jobQuery.error !== null) {
    // §22.27: отказ — это ВЕСЬ экран, а не бейдж поверх карточки.
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">Работа недоступна</h1>
          <p className="text-sm text-muted-foreground">
            {jobQuery.error.message}
          </p>
          <LoadFailure what="работу отчёта" onRetry={() => void jobQuery.refetch()} isRetrying={jobQuery.isFetching} />
          <p>
            <Link
              className="text-sm font-semibold text-primary-ink underline"
              href="/security-ops/service-reports/history"
            >
              ← История отчётов
            </Link>
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const data = jobQuery.data;
  if (data === undefined) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Загрузка работы…</p>
      </DashboardLayout>
    );
  }

  const { job, artifact } = data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <PageHeader
            
            title={data.reportTypeTitle}
            description={`${job.reportJobId} · ${data.isOwn ? "ваш запуск" : "запуск другого пользователя"}`}
          />
          <Link
            className="text-sm font-semibold text-primary-ink underline"
            href="/security-ops/service-reports/history"
          >
            ← История отчётов
          </Link>
        </div>

        <section
          className="rounded-xl border bg-card p-4"
          aria-label="Состояние работы"
        >
          <h2 className="mb-3 text-sm font-semibold">Состояние</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="font-semibold text-muted-foreground">Состояние</dt>
            <dd>{JOB_STATE_LABEL[job.state]}</dd>
            <dt className="font-semibold text-muted-foreground">Готовность</dt>
            {/* §22.21: доля выполненного у не начатой работы — выдумка. */}
            <dd>
              {job.progressPercent === null ? "не начата" : `${job.progressPercent}%`}
            </dd>
            <dt className="font-semibold text-muted-foreground">Сформировал</dt>
            <dd>{job.createdBy.safeLabel}</dd>
            <dt className="font-semibold text-muted-foreground">Создана</dt>
            <dd>{formatMoment(job.createdAt)}</dd>
            <dt className="font-semibold text-muted-foreground">Завершена</dt>
            <dd>{job.completedAt === null ? "—" : formatMoment(job.completedAt)}</dd>
            <dt className="font-semibold text-muted-foreground">Формат</dt>
            <dd>{job.format}</dd>
          </dl>
          {job.state === "FAILED" && job.safeFailureMessage !== null && (
            <p className="mt-3 text-sm text-destructive-ink">
              {job.failureCode}: {job.safeFailureMessage}
            </p>
          )}
        </section>

        <section
          className="rounded-xl border bg-card p-4"
          aria-label="Параметры запуска"
        >
          <h2 className="mb-3 text-sm font-semibold">Параметры запуска</h2>
          {job.parameters === null ? (
            <p className="text-sm text-muted-foreground">
              {job.parametersRedactedReason}
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="font-semibold text-muted-foreground">Период</dt>
              <dd>
                {job.parameters.from} — {job.parameters.to} (границы включительно)
              </dd>
              <dt className="font-semibold text-muted-foreground">Режим выгрузки</dt>
              <dd>{job.sensitive ? "со скрытыми полями" : "обычный"}</dd>
              <dt className="font-semibold text-muted-foreground">
                Ключ идемпотентности
              </dt>
              <dd>{job.idempotencyKey}</dd>
            </dl>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4" aria-label="Артефакт">
          <h2 className="mb-3 text-sm font-semibold">Артефакт</h2>
          {artifact === null ? (
            <p className="text-sm text-muted-foreground">
              Артефакта нет: он создаётся ровно при переходе работы в состояние
              «Готов» и больше не меняется (§22.22).
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="font-semibold text-muted-foreground">Редакция</dt>
              <dd>{artifact.revision}</dd>
              <dt className="font-semibold text-muted-foreground">Собран</dt>
              <dd>{formatMoment(artifact.generatedAt)}</dd>
              <dt className="font-semibold text-muted-foreground">
                Срок доступности
              </dt>
              <dd>
                {artifact.available
                  ? `до ${formatMoment(artifact.expiresAt)}`
                  : "срок хранения истёк"}
              </dd>
              <dt className="font-semibold text-muted-foreground">Размер</dt>
              <dd>{formatSize(artifact.fileSize)}</dd>
              <dt className="font-semibold text-muted-foreground">
                Контрольная сумма
              </dt>
              <dd>{artifact.hash}</dd>
              <dt className="font-semibold text-muted-foreground">Версия расчёта</dt>
              <dd>{artifact.calculationVersion}</dd>
              <dt className="font-semibold text-muted-foreground">
                Версия маскирования
              </dt>
              <dd>{artifact.maskingPolicyVersion}</dd>
            </dl>
          )}
        </section>

        <CapabilityNotes title="Состав карточки отчёта" items={[...data.unavailableBlocks, ...data.unavailableArtifactFields]} />
      </div>
    </DashboardLayout>
  );
}
