"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ScrollText } from "lucide-react";
import { formatIsoDateTime } from "@/shared/lib/date";
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { ReportSectionCard } from "@/components/reports/report-section-card";
import { ReportNavigation } from "@/components/reports/report-navigation";
import {
  useBulletinIssueFile,
  useBulletinIssues,
  useEventDocumentKinds,
  useIssueBulletin,
  useRenderEventDocument,
  useReportJobs,
} from "@/hooks/use-ops-reports";
import {
  JOB_STATE_LABEL,
  formatMoment,
  formatSize,
  saveBinaryFile,
} from "@/features/ops-reports/report-shared";
import type {
  ReportArtifactSummary,
  ReportJobState,
  EventDocumentFormat,
} from "@/entities/service-report";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION } from "@/entities/portal-access";

const JOB_STATE_CLASS: Record<ReportJobState, string> = {
  PENDING:
    "inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground",
  PROCESSING:
    "inline-flex rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground",
  COMPLETED:
    "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-900",
  FAILED:
    "inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800",
};

export default function ServiceReportsPage() {
  const queryClient = useQueryClient();
  const { hasPermission, isLoading: permissionsLoading, error: permissionsError } = useOpsPermissions();
  const jobsQuery = useReportJobs();

  // Документы ОМ (Plane №159, шаг ПД-3). Список видов приходит С СЕРВЕРА:
  // свой список на экране разошёлся бы с реестром сборщиков и предложил бы
  // документ, которого ручка не соберёт.
  const documentKinds = useEventDocumentKinds();
  const [documentKind, setDocumentKind] = useState("");
  const [documentEvent, setDocumentEvent] = useState("");
  // PDF — единственный пользовательский формат (Plane №986, [ОТЧ-ОМ-04]).
  // До №986 умолчание было DOCX (образцы заказчика — рабочие бланки Word,
  // дозаполняемые руками, Plane №156); решение заказчика 26-27.08.2026 сняло
  // DOCX из пользовательской выгрузки, ручка теперь отдаёт только PDF.
  const [documentFormat, setDocumentFormat] = useState<EventDocumentFormat>("pdf");
  const [documentSaved, setDocumentSaved] = useState<string | null>(null);
  // Срез бюллетеня (`[БЛН-04]`, Plane №420): дата и время, от которых идёт
  // отбор и которые печатаются в заголовке. Умолчание — сегодня, 08:00, как в
  // образце заголовка («на 08:00 ч. ДД.ММ.ГГГГ»).
  const [documentAsOf, setDocumentAsOf] = useState(() => defaultSliceLocal());
  const renderDocument = useRenderEventDocument((file) => {
    saveBinaryFile(file.fileName, file.contentBase64, file.contentType);
    setDocumentSaved(file.fileName);
  }, documentKinds.readKey);
  const chosenKind =
    documentKinds.data?.results.find((row) => row.kind === documentKind) ?? null;
  const needsAsOf = chosenKind?.needsAsOf === true;
  // Выпуски бюллетеня — только когда выбран бюллетень: у остальных видов
  // выпусков нет, и список ни о чём не говорил бы.
  const bulletinIssues = useBulletinIssues(needsAsOf);
  const [issued, setIssued] = useState<string | null>(null);
  const issueBulletin = useIssueBulletin((issue) => setIssued(issue.fileName), [documentKinds.readKey, bulletinIssues.readKey]);
  // Какую СТРОКУ скачиваем (Plane №627): `isPending` у мутации один на весь
  // список, и по нему гасить кнопки нельзя — гаснут все сразу, и какая строка
  // занята, не видно. Хук про свои переменные наружу не рассказывает, поэтому
  // строку помнит экран.
  const [downloadingIssueId, setDownloadingIssueId] = useState<string | null>(null);
  const issueFile = useBulletinIssueFile((file) => {
    saveBinaryFile(file.fileName, file.contentBase64, file.contentType);
    setDocumentSaved(file.fileName);
  }, bulletinIssues.readKey);
  const busyIssueId = issueFile.isPending ? downloadingIssueId : null;
  // Кнопка выключается ровно тогда, когда собрать НЕЛЬЗЯ, и причина
  // называется словами рядом — выключенная кнопка без объяснения оставляет
  // человека гадать, что он сделал не так.
  const documentBlocker =
    chosenKind === null
      ? "Выберите вид документа"
      : chosenKind.needsEvent && documentEvent.trim() === ""
        ? `Документ «${chosenKind.label}» строится по мероприятию — укажите его код`
        : null;

  const artifactsByJob = useMemo(() => {
    const map = new Map<string, ReportArtifactSummary>();
    for (const artifact of jobsQuery.data?.artifacts ?? [])
      map.set(artifact.reportJobId, artifact);
    return map;
  }, [jobsQuery.data]);

  if (permissionsError) {
    return <DashboardLayout><LoadFailure what="права доступа к отчётам" onRetry={() => void queryClient.resetQueries({ queryKey: ["ops-me"], exact: true })} /></DashboardLayout>;
  }
  if (permissionsLoading) {
    return <DashboardLayout><p role="status">Проверяем доступ к отчётам…</p></DashboardLayout>;
  }
  if (!hasPermission(MODULE_PERMISSION["/security-ops/service-reports"])) {
    return <OpsAccessDenied what="служебных отчётов" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Отчёты"
          title="Дежурства и документы ОМ"
          description="Выберите мероприятие для формирования документа. Готовые отчёты — в истории."
        />

        <ReportNavigation current="service" />

        <nav className="flex flex-wrap gap-2" aria-label="Разделы отчётов">
          <span className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Документы ОМ
          </span>
          <Link
            href="/security-ops/service-reports/history"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            История отчётов
          </Link>
        </nav>

        <ReportSectionCard
          role="group"
          aria-label="Выгрузка документов ОМ"
          icon={FileText}
          title="Документы по мероприятию"
          description="Файл содержит текущие данные. Для сохранения неизменного бюллетеня создайте выпуск."
        >
          {!hasPermission("event.view") ? <p className="text-sm text-muted-foreground">Выгрузка документов доступна с правом просмотра мероприятий.</p> : documentKinds.isError || documentKinds.readAccessBlocked ? (
            <LoadFailure what="виды документов" onRetry={() => void documentKinds.refetch()} isRetrying={documentKinds.isFetching} />
          ) : documentKinds.isPending ? (
            <p className="text-sm text-muted-foreground">Загрузка видов документов…</p>
          ) : documentKinds.data === undefined ? (
            <p className="text-sm text-muted-foreground">
              Список документов сейчас недоступен.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] font-bold uppercase text-muted-foreground">
                Вид документа
                <select
                  aria-label="Вид документа"
                  className="mt-0.5 block h-9 w-56 rounded-md border border-input bg-background px-2 text-sm"
                  value={documentKind}
                  onChange={(e) => {
                    setDocumentKind(e.target.value);
                    setDocumentSaved(null);
                  }}
                >
                  <option value="">— выберите —</option>
                  {documentKinds.data.results.map((row) => (
                    <option key={row.kind} value={row.kind}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* Формат — тем же видом, что и вид документа: два разных
                  органа управления для двух одинаковых по смыслу выборов
                  заставили бы человека читать форму дважды. */}
              {/* `?? []` не про типы: старый сервер (в разработке он живёт с
                  `--noreload` и переживает правку) ответит без поля, и разбор
                  списка уронил бы ВЕСЬ экран отчётов ради одного выбора. Без
                  списка формат не спрашивается, и ручка отдаёт своё умолчание
                  — PDF, как было до Plane №156. */}
              {(documentKinds.data.formats ?? []).length > 0 && (
                <label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Формат
                  <select
                    aria-label="Формат документа"
                    className="mt-0.5 block h-9 w-40 rounded-md border border-input bg-background px-2 text-sm"
                    value={documentFormat}
                    onChange={(e) => {
                      setDocumentFormat(e.target.value as EventDocumentFormat);
                      setDocumentSaved(null);
                    }}
                  >
                    {(documentKinds.data.formats ?? []).map((row) => (
                      <option key={row.format} value={row.format}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {/* Поле мероприятия показывается ТОЛЬКО тем видам, которым оно
                  нужно: спрашивать код ОМ у бюллетеня, который строится по
                  всем мероприятиям, значило бы требовать лишнее. */}
              {needsAsOf && (
                <label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Срез (дата и время)
                  <input
                    type="datetime-local"
                    aria-label="Срез бюллетеня"
                    className="mt-0.5 block h-9 w-52 rounded-md border border-input bg-background px-2 text-sm"
                    value={documentAsOf}
                    onChange={(e) => {
                      setDocumentAsOf(e.target.value);
                      setDocumentSaved(null);
                    }}
                  />
                </label>
              )}
              {chosenKind?.needsEvent === true && (
                <label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Код мероприятия
                  <input
                    aria-label="Код мероприятия"
                    className="mt-0.5 block h-9 w-44 rounded-md border border-input bg-background px-2 text-sm"
                    placeholder="ОМ-2026-1"
                    value={documentEvent}
                    onChange={(e) => {
                      setDocumentEvent(e.target.value);
                      setDocumentSaved(null);
                    }}
                  />
                </label>
              )}
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={documentBlocker !== null || renderDocument.isPending || documentKinds.canAct === false}
                aria-busy={renderDocument.isPending}
                onClick={() => {
                  if (documentKinds.canAct === false) return;
                  setDocumentSaved(null);
                  renderDocument.mutate({
                    kind: documentKind,
                    eventCode: documentEvent,
                    asOf: needsAsOf ? documentAsOf : undefined,
                    // Формат шлём только когда сервер его предложил: иначе
                    // старая ручка получила бы незнакомый параметр.
                    format:
                      (documentKinds.data?.formats ?? []).length > 0
                        ? documentFormat
                        : undefined,
                  });
                }}
              >
                {renderDocument.isPending
                  ? "Собираем…"
                  : `Выгрузить ${
                      (documentKinds.data?.formats ?? []).length > 0
                        ? documentFormat.toUpperCase()
                        : "PDF"
                    }`}
              </button>
            </div>
          )}
          {/* Ответ на нажатие обязателен: клик без отклика читается как
              поломка. Сборка занимает доли секунды, поэтому здесь не спиннер
              поверх экрана, а подпись у самой кнопки. */}
          {documentBlocker !== null && (
            <p className="mt-2 text-xs text-muted-foreground">{documentBlocker}</p>
          )}
          {renderDocument.error !== null && (
            <p className="mt-2 text-xs text-red-700" role="alert">
              Документ не собрался: {renderDocument.error.message}
            </p>
          )}
          {documentSaved !== null && (
            <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
              Файл «{documentSaved}» передан браузеру для скачивания.
            </p>
          )}
          {needsAsOf && (
            /* Выпуск — ХРАНИМЫЙ документ (`[МД-01]`, Plane №420): сборка выше
               отвечает «как бюллетень выглядит сейчас», выпуск — «что ушло
               адресатам» на выбранный срез, и повторно его не пересобирают. */
            <div
              className="mt-4 rounded-lg border bg-muted/30 p-3"
              role="group"
              aria-label="Выпуски бюллетеня"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold">Выпуски бюллетеня</p>
                  <p className="text-[11px] text-muted-foreground">
                    Выпуск сохраняет строки и PDF на выбранный срез. Скачайте сохранённый выпуск для передачи адресатам.
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={documentAsOf.trim() === "" || issueBulletin.isPending || documentKinds.canAct === false || bulletinIssues.canAct === false || !hasPermission("event.bulletin")}
                  aria-busy={issueBulletin.isPending}
                  onClick={() => {
                    if (documentKinds.canAct === false || bulletinIssues.canAct === false || !hasPermission("event.bulletin")) return;
                    setIssued(null);
                    issueBulletin.mutate({ asOf: documentAsOf });
                  }}
                >
                  {issueBulletin.isPending ? "Выпускаем…" : "Выпустить на этот срез"}
                </button>
              </div>
              {issueBulletin.error !== null && (
                <p className="mt-2 text-xs text-red-700" role="alert">
                  Выпуск не состоялся: {issueBulletin.error.message}
                </p>
              )}
              {issued !== null && (
                <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                  Выпущен «{issued}».
                </p>
              )}
              {/* 🔴 ОТКАЗ ЗАПРОСА — НЕ «ВЫПУСКОВ НЕТ» (Plane №626). Ветка ошибки
                  не проверялась вовсе: при 500, истёкшей сессии или обрыве сети
                  `isPending` уже false, `data` пуст, и человеку говорили
                  «Выпусков ещё не было» — утверждение о МИРЕ вместо факта о
                  запросе. Соседние блоки этого же экрана ошибку рисуют. */}
              {bulletinIssues.isPending ? (
                <p className="mt-2 text-xs text-muted-foreground">Загрузка выпусков…</p>
              ) : bulletinIssues.error !== null ? (
                <p className="mt-2 text-xs text-red-700" role="alert">
                  Список выпусков не загрузился: {bulletinIssues.error.message}{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => void bulletinIssues.refetch()}
                    disabled={bulletinIssues.isFetching}
                  >
                    {bulletinIssues.isFetching ? "Повторяем…" : "Повторить"}
                  </button>
                </p>
              ) : (bulletinIssues.data?.results ?? []).length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Выпусков ещё не было.
                </p>
              ) : (
                <ul className="mt-2 divide-y text-xs" aria-label="Список выпусков">
                  {(bulletinIssues.data?.results ?? []).map((issue) => (
                    <li
                      key={issue.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                    >
                      <span>
                        <span className="font-semibold tabular-nums">
                          на {formatIsoDateTime(issue.asOf)}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}· {issue.eventCount} стр. · {issue.issuedBy || "—"}
                          {issue.issuedAt !== null && ` · ${formatIsoDateTime(issue.issuedAt)}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        // Гаснет ТОЛЬКО нажатая строка (Plane №627): конвертация
                        // идёт секунды, и погашенный целиком список читается как
                        // замёрзший экран.
                        disabled={busyIssueId === issue.id || bulletinIssues.canAct === false}
                        aria-busy={busyIssueId === issue.id}
                        onClick={() => {
                          if (bulletinIssues.canAct === false) return;
                          setDocumentSaved(null);
                          setDownloadingIssueId(issue.id);
                          issueFile.mutate({ id: issue.id });
                        }}
                      >
                        {busyIssueId === issue.id ? "Готовим…" : "Скачать PDF"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* 🔴 ОТКАЗ СКАЧИВАНИЯ БЫЛ НЕВИДИМ (Plane №627). При 403, 404 или
                  порче хранилища мутация завершалась, кнопка включалась обратно,
                  и не появлялось НИЧЕГО — нажатие читалось как пустое, и человек
                  жал снова. */}
              {issueFile.error !== null && (
                <p className="mt-2 text-xs text-red-700" role="alert">
                  Выпуск не скачался: {issueFile.error.message}
                </p>
              )}
            </div>
          )}
        </ReportSectionCard>

        <ReportSectionCard icon={ScrollText} title="Готовность отчётов и файлы">
          {jobsQuery.isError && jobsQuery.data !== undefined && <>
            <LoadFailure what="список отчётов" onRetry={() => void jobsQuery.refetch()} isRetrying={jobsQuery.isFetching} />
            <p role="status" className="mb-3 text-sm text-muted-foreground">Показаны ранее загруженные данные. Действия доступны после успешного обновления.</p>
          </>}
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
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ReportSectionCard>
      </div>
    </DashboardLayout>
  );
}

/** Сегодня 08:00 в формате `datetime-local` — умолчание среза бюллетеня. */
function defaultSliceLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T08:00`;
}
