"use client";

// Карточка работы отчёта (§22.27 «Прямые ссылки», §22.28). Доступ
// перепроверяется на каждый запрос карточки; параметры чужого запуска сюда не
// приезжают — сервер вырезает их из ответа, экран печатает причину.
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { FileSearch } from "lucide-react";
import {
  useDownloadArtifact,
  useReportJob,
  useRerunReportJob,
} from "@/hooks/use-ops-reports";
import {
  ACTION_LABEL,
  JOB_STATE_LABEL,
  formatMoment,
  formatSize,
  saveFile,
} from "@/features/ops-reports/report-shared";
import type { ReportJobAction } from "@/entities/service-report";

/** Действия, которые на карточке ничего не открывают: параметры и ошибка уже
 * развёрнуты — карточка и есть развёрнутая строка. */
const INLINE_ACTIONS: readonly ReportJobAction["code"][] = [
  "OPEN_PARAMETERS",
  "VIEW_ERROR",
];

export default function ReportJobPage() {
  const params = useParams<{ reportJobId: string }>();
  const reportJobId = params.reportJobId ?? "";
  const jobQuery = useReportJob(reportJobId);

  const download = useDownloadArtifact((file) => saveFile(file.fileName, file.content));
  const rerun = useRerunReportJob(() => undefined);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  // Выше ветки jobQuery.error: без гварда отказ по правам приезжал сюда как
  // 403 и печатался экраном «Работа недоступна» — той же формулировкой, что
  // и чужой/удалённый запуск.
  if (!permissionsLoading && !hasPermission("report.generate")) {
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
  const rerunResult = rerun.data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <FileSearch className="h-8 w-8 text-primary-ink" />
          <div>
            <h1 className="text-2xl font-bold">{data.reportTypeTitle}</h1>
            <p className="text-muted-foreground">
              <span>{job.reportJobId}</span> ·{" "}
              <span>{data.isOwn ? "ваш запуск" : "запуск другого пользователя"}</span>
            </p>
            <Link
              className="text-sm font-semibold text-primary-ink underline"
              href="/security-ops/service-reports/history"
            >
              ← История отчётов
            </Link>
          </div>
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

        <section role="group" aria-label="Действия работы">
          <div className="flex flex-wrap gap-2">
            {data.actions
              .filter((action) => !INLINE_ACTIONS.includes(action.code))
              .map((action) => (
                <button
                  key={action.code}
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                  disabled={!action.available || download.isPending || rerun.isPending}
                  title={action.reason ?? undefined}
                  onClick={() => {
                    if (action.code === "DOWNLOAD" && artifact !== null) {
                      download.mutate({ artifactId: artifact.artifactId });
                    } else if (
                      action.code === "RETRY" ||
                      action.code === "NEW_REVISION"
                    ) {
                      rerun.mutate({ reportJobId: job.reportJobId, mode: action.code });
                    }
                  }}
                >
                  {ACTION_LABEL[action.code]}
                </button>
              ))}
          </div>
          {/* Причины отказа — не только в title: подсказка мыши недоступна с
              клавиатуры и скринридеру у выключенной кнопки. */}
          <ul className="mt-2 flex flex-col gap-1">
            {data.actions
              .filter((action) => !action.available && action.reason !== null)
              .map((action) => (
                <li key={action.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {ACTION_LABEL[action.code]}
                  </span>{" "}
                  — {action.reason}
                </li>
              ))}
          </ul>
          {rerun.error !== null && (
            <p className="mt-2 text-sm text-destructive-ink">{rerun.error.message}</p>
          )}
          {download.error !== null && (
            <p className="mt-2 text-sm text-destructive-ink">
              {download.error.message}
            </p>
          )}
          {rerunResult !== undefined && (
            <p role="status" className="mt-2 text-sm font-semibold text-primary-ink">
              {rerunResult.reused ? (
                "Готовый артефакт с теми же параметрами уже есть — новая работа не запускалась."
              ) : (
                <>
                  Запущена новая работа.{" "}
                  <Link
                    className="underline"
                    href={`/security-ops/service-reports/${rerunResult.reportJobId}`}
                  >
                    Открыть её карточку
                  </Link>
                </>
              )}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-dashed bg-muted/30 p-4">
          <h2 className="mb-2 text-sm font-semibold">Чего в этой карточке нет</h2>
          <ul className="flex flex-col gap-2">
            {[...data.unavailableBlocks, ...data.unavailableArtifactFields].map(
              (block) => (
                <li key={block.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {block.label}
                  </span>{" "}
                  — {block.reason}
                </li>
              )
            )}
          </ul>
        </section>
      </div>
    </DashboardLayout>
  );
}
