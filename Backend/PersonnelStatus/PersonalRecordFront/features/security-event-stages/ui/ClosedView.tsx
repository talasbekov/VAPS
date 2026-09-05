"use client";

import { Lock } from "lucide-react";

// Архив дела — read-only разбор закрытого ОМ: сводка, итоги направлений,
// бюллетень, расчёты и заявки, расстановка снимком, замены, журнал штаба и
// сводка оценивания. Собран по экрану прототипа «Архив дела»: будущий старший
// наряда открывает дело, чтобы понять, какие силы привлекались, кто стоял,
// какие были инциденты и решения.
//
// Отдельного маршрута у архива нет намеренно: закрытое дело — это карточка ОМ
// на стадии «Закрыто», и второй адрес показывал бы ровно то же самое.
//
// Чего из прототипа НЕТ: «все версии расстановки» (версий у расстановки не
// существует — бэк хранит один действующий состав) и оценочные показатели
// «средняя оценка / распределение / благодарности». Последние невыводимы не
// по лени: сама оценка за мероприятие наружу не едет ни одним полем (§19.2),
// а `aggregateRating` в реестре — агрегат СОТРУДНИКА за период политики, а не
// его оценка за это ОМ. Среднее по нему было бы другой величиной под чужой
// подписью.
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JOURNAL_TYPE_LABEL, objectLabel } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useEvaluationRegistry } from "@/hooks/use-ops-ratings";
import { EMPTY_FILTERS } from "@/entities/operational-rating";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";
import { Button } from "@/components/ui/button";
import { useRenderEventDocument } from "@/hooks/use-ops-reports";
import { saveBinaryFile } from "@/features/ops-reports/report-shared";
import { useState } from "react";

/**
 * Период мероприятия строкой. Архив — единственное место, где ОМ читают уже
 * НЕ зная его наизусть, и одна дата вместо периода прямо врёт о длительности:
 * трёхдневное мероприятие выглядело однодневным и в шапке архива, и в
 * «Карточке, бюллетене, программе».
 */
function eventPeriod(event: SecurityEvent): string {
  const start = formatIsoDate(event.businessDate);
  if (
    event.businessDateEnd === null ||
    event.businessDateEnd === event.businessDate
  ) {
    return start;
  }
  return `${start} — ${formatIsoDate(event.businessDateEnd)}`;
}

export function ClosedView({ event }: { event: SecurityEvent }) {
  // `[ЗАК-10]`/`[ЗАК-13]` (Plane №448): ОДНА страница с якорями «Итог ·
  // Оценки · Инциденты · Документы · История». Отдельных карточек «Итоги
  // направлений», «Карточка, бюллетень, программа», «Расчёты и заявки» и
  // надписей «read-only»/«Архив» больше нет — бюллетень и паспорт
  // живут в «Документах», старые итоги направлений — в «Истории».
  const summary = event.closureSummary;
  const incidents = event.journalEntries.filter((entry) => entry.type === "INCIDENT");
  const postById = new Map(event.reconSectorPosts.map((post) => [post.id, post]));
  const anchors: [string, string][] = [
    ["archive-summary", "Итог"],
    ["archive-evaluations", "Оценки"],
    ["archive-incidents", "Инциденты"],
    ["archive-documents", "Документы"],
    ["archive-history", "История"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            Архив · {event.code}
          </h2>
          <p className="text-xs text-muted-foreground">
            {event.title} · {eventPeriod(event)} · {objectLabel(event)}
            {event.closedAt !== null ? ` · закрыто ${formatIsoDateTime(event.closedAt)}` : ""}
            {event.ownerName ? ` · ${event.ownerName}` : ""}
          </p>
        </div>
        <CaseDownload event={event} />
      </div>
      <nav aria-label="Разделы архива" className="flex flex-wrap gap-2 text-xs" data-slot="archive-anchors">
        {anchors.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border px-2.5 py-1 font-semibold hover:bg-muted">
            {label}
          </a>
        ))}
      </nav>

      <Card id="archive-summary">
        <CardHeader>
          <CardTitle>Итог</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm tabular-nums" data-slot="closure-summary-line">
            Постов <b>{summary.posts}</b> · назначено <b>{summary.assigned} из {summary.need}</b> · замен{" "}
            <b>{summary.replacements}</b> · отказов <b>{summary.declines}</b> · инцидентов{" "}
            <b>{summary.incidents}</b>
          </p>
          {event.closingComment !== "" && (
            <p className="text-sm" data-slot="closing-comment">
              <span className="text-muted-foreground">Итоговый комментарий:</span> {event.closingComment}
            </p>
          )}
          {event.visitObjects.map((visit) => {
            // ЧИСЛА ПО ПОСТАМ МОГУТ БЫТЬ НЕИЗВЕСТНЫ (Plane №726): у второго и
            // последующих объектов, пока в расчёте есть неразмеченные строки,
            // сервер отдаёт null — то же «неизвестно», что и у placementNeed
            // в реестре. Печатать вместо него ноль значило бы утверждать
            // «постов нет», чего система не знает; подпись причины взята
            // ОДНА В ОДНУ у реестра ОМ — два разных текста про одно и то же
            // читались бы как два разных состояния.
            const known = visit.closureSummary.posts !== null;
            return (
              <p key={visit.id} className="text-xs text-muted-foreground tabular-nums">
                «{visit.objectName}»:{" "}
                {known ? (
                  <>
                    постов {visit.closureSummary.posts} · назначено{" "}
                    {visit.closureSummary.assigned} из {visit.closureSummary.need}
                  </>
                ) : (
                  "расчёт постов не размечен по объектам"
                )}
                {visit.closingComment !== "" ? ` · ${visit.closingComment}` : ""}
              </p>
            );
          })}
        </CardContent>
      </Card>

      <div id="archive-evaluations">
        <EvaluationsSection event={event} />
      </div>

      <Card id="archive-incidents">
        <CardHeader>
          <CardTitle>Инциденты</CardTitle>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Инцидентов не было</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {incidents.map((entry) => {
                const post = entry.postId ? postById.get(entry.postId) : undefined;
                return (
                  <li key={entry.id} className="rounded-md border p-2.5 text-sm">
                    <span className="text-muted-foreground tabular-nums">
                      {formatIsoDateTime(entry.occurredAt ?? entry.createdAt)}
                    </span>{" "}
                    · {post ? `${post.sector} · ${post.post}` : "пост не указан"} ·{" "}
                    <span className="font-semibold">{entry.title}</span>
                    {entry.description !== "" && (
                      <span className="text-muted-foreground"> — {entry.description}</span>
                    )}
                    {(entry.measures ?? "") !== "" && (
                      <p className="text-xs">Принятые меры: {entry.measures}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card id="archive-documents">
        <CardHeader>
          <CardTitle>Документы</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5 text-sm" data-slot="archive-documents">
            {event.visitObjects.map((visit) => {
              const current = visit.documentVersions[visit.documentVersions.length - 1];
              return (
                <li key={visit.id}>
                  Расстановка сил · «{visit.objectName}»
                  {current ? ` · версия ${current.number}` : " · не отправлялась"}
                  {" · лист ознакомления в приложении"} — в деле (PDF выше)
                </li>
              );
            })}
            <li>
              <Link
                href={`/security-ops/events/${event.id}/?stage=RECON`}
                className="font-semibold text-primary-ink"
              >
                Рекогносцировка (чек-лист, посты) →
              </Link>
            </li>
            <li>
              <Link
                href={`/security-ops/events/${event.id}/?stage=BULLETIN`}
                className="font-semibold text-primary-ink"
              >
                Бюллетень →
              </Link>
              {event.passportBinding !== null && (
                <>
                  {" · "}
                  <Link
                    href={`/security-ops/objects/${event.passportBinding.objectId}/passports/${event.passportBinding.versionId}`}
                    className="font-semibold text-primary-ink"
                  >
                    Паспорт объекта вер. {event.passportBinding.versionNumber} (снимок) →
                  </Link>
                </>
              )}
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card id="archive-history">
        <CardHeader>
          <CardTitle>История</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="flex flex-col gap-1 text-sm" data-slot="archive-history">
            {event.visitObjects.flatMap((visit) =>
              visit.documentVersions.map((version) => (
                <li key={`${visit.id}-${version.number}`} className="text-muted-foreground">
                  «{visit.objectName}» · версия {version.number}{" "}
                  {version.status === "APPROVED"
                    ? "согласована"
                    : version.status === "RETURNED"
                      ? "возвращена"
                      : version.status === "SUBMITTED"
                        ? "на согласовании"
                        : "черновик"}
                  {version.decidedAt ? ` ${formatIsoDateTime(version.decidedAt)}` : version.sentAt ? ` ${formatIsoDateTime(version.sentAt)}` : ""}
                </li>
              ))
            )}
            {event.journalEntries
              .filter((entry) => entry.type !== "INCIDENT")
              .map((entry) => (
                <li key={entry.id} className="text-muted-foreground">
                  {formatIsoDateTime(entry.createdAt)} · {JOURNAL_TYPE_LABEL[entry.type]} · {entry.title}
                  {entry.description !== "" ? ` — ${entry.description}` : ""}
                </li>
              ))}
            {event.closedAt !== null && (
              <li className="font-semibold">закрыто {formatIsoDateTime(event.closedAt)}</li>
            )}
          </ul>
          {event.closureDirectionSummaries.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Итоги направлений (до Plane №448)
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {event.closureDirectionSummaries.map((item) => (
                  <li key={item.direction}>
                    <span className="font-semibold">{item.direction}</span> —{" "}
                    <span className="text-muted-foreground">{item.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-xs font-semibold text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </p>
  );
}

/**
 * Сводка оценивания по делу. Считается по строкам реестра оценок этого ОМ —
 * тем, что контракт действительно отдаёт: сколько участников оценено, чем
 * (вручную или системной подстановкой), сколько записей исправлено. Значений
 * оценок здесь нет и быть не может (§19.2).
 */
function EvaluationsSection({ event }: { event: SecurityEvent }) {
  const { hasPermission } = useOpsPermissions();
  const canView = hasPermission("rating.view_aggregate");
  const registry = useEvaluationRegistry({
    ...EMPTY_FILTERS,
    event: canView ? event.code : null,
  });

  if (!canView) return null;

  const rows = registry.data?.results ?? [];
  const manual = rows.filter((row) => row.method === "MANUAL").length;
  const systemDefault = rows.filter(
    (row) => row.method === "SYSTEM_DEFAULT"
  ).length;
  const corrected = rows.filter((row) => row.corrected).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Оценки участников</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {registry.isLoading ? (
          <p className="text-xs text-muted-foreground">Загрузка реестра оценок…</p>
        ) : registry.isError ? (
          <p className="text-xs text-destructive-ink">
            Реестр оценок недоступен.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{registry.data?.total ?? 0}</b>
              <span className="text-muted-foreground">оценено</span>
            </span>
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{manual}</b>
              <span className="text-muted-foreground">вручную</span>
            </span>
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{systemDefault}</b>
              <span className="text-muted-foreground">системной подстановкой</span>
            </span>
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{corrected}</b>
              <span className="text-muted-foreground">исправлено</span>
            </span>
          </div>
        )}
        <Link
          href={`/security-ops/ratings/evaluations?event=${encodeURIComponent(event.code)}`}
          className="inline-block text-xs font-semibold text-primary-ink"
        >
          Итоговые оценки участников ОМ →
        </Link>
      </CardContent>
    </Card>
  );
}


/**
 * «Скачать дело» (`[ЗАК-11]`, Plane №437): один файл со всеми вложениями —
 * расстановка с версиями, лист ознакомления, замечания, оценки, журнал.
 * Тот же путь, что у экрана отчётов: ручка отдаёт base64, файл сохраняется
 * по нажатию (мутация, не запрос — у скачивания нет кэша).
 */
function CaseDownload({ event }: { event: SecurityEvent }) {
  const [saved, setSaved] = useState<string | null>(null);
  const render = useRenderEventDocument((file) => {
    saveBinaryFile(file.fileName, file.contentBase64, file.contentType);
    setSaved(file.fileName);
  });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-slot="case-download">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={render.isPending}
        onClick={() => render.mutate({ kind: "case", eventCode: event.code, format: "pdf" })}
      >
        {render.isPending ? "Сборка дела…" : "Скачать дело (PDF)"}
      </Button>
      <span className="text-xs text-muted-foreground">
        расстановка с версиями · лист ознакомления · замечания · оценки · журнал
      </span>
      {saved !== null && (
        <span className="text-xs text-muted-foreground" role="status">
          сохранено: {saved}
        </span>
      )}
      {render.error && (
        <span role="alert" className="text-destructive-ink text-xs">
          {render.error.message}
        </span>
      )}
    </div>
  );
}
