"use client";

// Страница визита иностранного ОЛ (`[ГВО-01]`, `[ГВО-04]`, `[ГВО-07]`,
// `[ГВО-09]`, Plane №436, Ш-20 плана P2).
//
// Отдельная карточка визита: открывается из вкладки «Визиты иностранных ОЛ»
// реестра и из карточки ОМ. У внутреннего мероприятия визита нет — страница
// говорит это словами, а не отказом: адрес ведёт к ОМ, у которого «нечего
// показывать», и это ответ.
//
// Шапка — «тип визита · статус · прогресс обязательных · PDF / Утвердить»;
// «Утвердить» недоступна, пока обязательные не заполнены (список — в
// подсказке), и открыта штабу (`gvo.manage`). Вкладки «Сводные данные ГВО /
// Объекты посещения / Бюллетень / Транспорт» — каркас `[ГВО-02]`; единый
// режим редактирования (`[ГВО-05]`) и порядок блоков — P3 №441.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { useSecurityEvent } from "@/hooks/use-security-events";
import { useApproveVisit, useGvoSummary } from "@/hooks/use-gvo-summaries";
import { useRenderEventDocument } from "@/hooks/use-ops-reports";
import { saveBinaryFile } from "@/features/ops-reports/report-shared";
import { GvoSummaryPanel } from "@/widgets/gvo-summary";
import { SECURITY_EVENT_KIND_LABEL } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import type { GvoSummaryRow } from "@/entities/gvo-summary";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";

const VISIT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  READY: "Заполнен",
  APPROVED: "Утверждён",
};

const VISIT_STATUS_CLASS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  READY: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  APPROVED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
};

export default function VisitPage() {
  // useParams в клиентском поддереве: граница Suspense — конвенция раздела.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <VisitScreen />
    </Suspense>
  );
}

function VisitScreen() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const query = useSecurityEvent(id);

  if (!permissionsLoading && !hasPermission(MODULE_PERMISSION["/security-ops/visits"])) {
    return <OpsAccessDenied what="карточки визита" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {query.isPending && <p className="text-sm text-muted-foreground">Загрузка визита…</p>}
        {query.isError && (
          <LoadFailure what="визит" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
        )}
        {/* 🔴 ОТБИВАЕТСЯ ВНУТРЕННИЙ, А НЕ «НЕ-ИНОСТРАННЫЙ» (Plane №692). Ветка
            шла по `kind === "FOREIGN"`, и мероприятие БЕЗ ТИПА (`kind: null`
            — записи до появления типа; ограничение БД такие допускает)
            попадало в «визита нет». Ссылка «Карточка визита →» рисуется по
            прямо обратному правилу — `kind !== "INTERNAL"` с записанным
            доводом «скрывать по незнанию нельзя», — то есть ссылка вела на
            страницу, которая тут же объявляла ОМ внутренним. Правило теперь
            одно на оба места. */}
        {query.data !== undefined &&
          (query.data.kind === "INTERNAL" ? (
            <NoVisit event={query.data} />
          ) : (
            <VisitCard event={query.data} />
          ))}
      </div>
    </DashboardLayout>
  );
}

/** У внутреннего ОМ визита не существует (`[ГВО-01]`) — говорим словами. */
function NoVisit({ event }: { event: SecurityEvent }) {
  return (
    <>
      <PageHeader
        eyebrow="Охранные мероприятия"
        title={`Визит · ${event.code}`}
        description="Карточка визита ведётся только у мероприятий с участием иностранцев"
        inDevelopment={false}
      />
      <Card>
        <CardContent className="p-6 text-sm" data-slot="visit-none">
          {/* Тип НАЗЫВАЕТСЯ ТОЛЬКО КОГДА ОН ЕСТЬ (Plane №692). Подстановка
              `event.kind ?? "INTERNAL"` утверждала про запись тип, которого у
              неё нет. Сюда теперь доходят только настоящие внутренние ОМ, но
              подстановку всё равно снимаем: она была вторым местом, где
              незнание выдавалось за факт. */}
          <p>
            «{event.title}» —{" "}
            {event.kind === null
              ? "мероприятие без указанного типа"
              : SECURITY_EVENT_KIND_LABEL[event.kind].toLowerCase()}
            : визита у него нет.
          </p>
          <Link
            href={`/security-ops/events/${event.id}/`}
            className="mt-2 inline-block font-semibold text-primary-ink"
          >
            К карточке мероприятия →
          </Link>
        </CardContent>
      </Card>
    </>
  );
}

function VisitCard({ event }: { event: SecurityEvent }) {
  const { hasPermission } = useOpsPermissions();
  /** В форме правки сводки есть несохранённое (Plane №693): вкладка остаётся
   * в DOM, но не видна, и метка на её ярлыке — единственное, что об этом
   * говорит. */
  const [summaryDirty, setSummaryDirty] = useState(false);
  const summary = useGvoSummary(event.code);
  const approve = useApproveVisit();
  const render = useRenderEventDocument((file) =>
    saveBinaryFile(file.fileName, file.contentBase64, file.contentType)
  );
  const row: GvoSummaryRow | undefined = summary.data;
  const status = row?.visit?.status ?? "DRAFT";
  const missing = row?.missingRequired ?? [];
  const total = row?.requiredTotal ?? 0;
  const filled = row?.requiredFilled ?? 0;
  const canApprove = hasPermission("gvo.manage");
  const approveBlocker =
    status === "APPROVED"
      ? "Визит уже утверждён"
      : missing.length > 0
        ? `Заполните обязательные поля: ${missing.join(", ")}`
        : !canApprove
          ? "Утверждает штаб (право на сводку ГВО)"
          : null;

  return (
    <>
      <PageHeader
        eyebrow="Охранные мероприятия · визит"
        title={`${event.code} · ${event.title}`}
        description={[
          SECURITY_EVENT_KIND_LABEL[event.kind ?? "INTERNAL"],
          event.protectedPersonName !== "" ? `ОЛ: ${event.protectedPersonName}` : null,
          formatIsoDate(event.businessDate),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2" data-slot="visit-head">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VISIT_STATUS_CLASS[status] ?? ""}`}
              data-slot="visit-status"
            >
              {VISIT_STATUS_LABEL[status] ?? status}
            </span>
            {total > 0 && (
              <span className="text-xs text-muted-foreground" data-slot="visit-progress">
                заполнено {filled} из {total} обязательных
              </span>
            )}
            {row?.visit?.approvedAt && (
              <span className="text-xs text-muted-foreground">
                утверждён {formatIsoDateTime(row.visit.approvedAt)}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={render.isPending}
              onClick={() =>
                render.mutate({ kind: "summary", eventCode: event.code, format: "pdf" })
              }
            >
              {render.isPending ? "Собираем…" : "PDF"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={approveBlocker !== null || approve.isPending}
              title={approveBlocker ?? undefined}
              aria-busy={approve.isPending}
              onClick={() => approve.mutate({ omCode: event.code })}
            >
              {approve.isPending ? "Утверждаем…" : "Утвердить"}
            </Button>
          </div>
        }
      />
      {missing.length > 0 && status !== "APPROVED" && (
        <p className="text-xs text-amber-900" data-slot="visit-missing">
          Обязательные поля без данных: {missing.join(", ")}. Пустое поле можно пометить
          «уточняется» — тогда оно не держит утверждение.
        </p>
      )}
      {approve.error !== null && (
        <p className="text-xs text-red-700" role="alert">
          Не утверждено: {approve.error.message}
        </p>
      )}

      <Tabs defaultValue="summary">
        <TabsList aria-label="Разделы визита">
          <TabsTrigger value="summary">
            Сводные данные ГВО
            {/* Метка несохранённого черновика (Plane №693). Сам черновик от
                переключения больше не гибнет, но вкладка неактивна и не видна
                — без метки человек может уйти со страницы, считая правку
                сохранённой. Тот же довод, что у `bulletinDirty` на карточке
                ОМ; здесь достаточно метки, а не предупреждения: терять больше
                нечего. */}
            {summaryDirty && (
              <span className="ml-1 text-amber-700" title="Есть несохранённые правки">
                •<span className="sr-only"> есть несохранённые правки</span>
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="objects">Объекты посещения ({event.visitObjects.length})</TabsTrigger>
          <TabsTrigger value="bulletin">Бюллетень</TabsTrigger>
          <TabsTrigger value="transport">Транспорт</TabsTrigger>
        </TabsList>
        {/* 🔴 `forceMount` — ЧЕРНОВИК ПЕРЕЖИВАЕТ ПЕРЕКЛЮЧЕНИЕ (Plane №693).
            Radix размонтирует неактивную вкладку, и вместе с ней исчезала
            форма правки со всем набранным: человек жал «Редактировать»,
            заполнял десяток полей, переходил на «Объекты посещения»
            свериться — и, вернувшись, находил пустоту, без предупреждения.
            Ровно тот класс потери, ради которого на карточке ОМ заведён
            `bulletinDirty`. Держится в DOM ТОЛЬКО эта вкладка: у остальных
            терять нечего, а ранняя загрузка их данных обошлась бы лишними
            запросами на каждом открытии визита. */}
        <TabsContent value="summary" forceMount>
          <GvoSummaryPanel
            event={event}
            variant="page"
            onDirtyChange={setSummaryDirty}
          />
        </TabsContent>
        <TabsContent value="objects">
          <Card>
            <CardContent className="p-4 text-sm">
              {event.visitObjects.length === 0 ? (
                <p className="text-muted-foreground">Объекты посещения не добавлены.</p>
              ) : (
                <ul className="divide-y">
                  {event.visitObjects.map((visit) => (
                    <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-semibold">{visit.objectName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {visit.visitDay !== null ? formatIsoDate(visit.visitDay) : "дата не указана"} · старший:{" "}
                          {visit.chiefName === "" ? "не назначен" : visit.chiefName}
                        </span>
                      </span>
                      {/* Клик по объекту → этапы объекта (`[ГВО-02]`). */}
                      <Link
                        href={`/security-ops/events/${event.id}/?visit=${visit.id}`}
                        className="text-xs font-semibold text-primary-ink"
                      >
                        Этапы объекта →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="bulletin">
          <Card>
            <CardContent className="p-4 text-sm">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] font-bold uppercase text-muted-foreground">Мероприятие</dt>
                  <dd>{event.title}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase text-muted-foreground">Дата</dt>
                  <dd>{formatIsoDate(event.businessDate)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase text-muted-foreground">Локация</dt>
                  <dd>{event.location === "" ? "—" : event.location}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase text-muted-foreground">Охраняемое лицо</dt>
                  <dd>{event.protectedPersonName === "" ? "—" : event.protectedPersonName}</dd>
                </div>
              </dl>
              <Link
                href={`/security-ops/events/${event.id}/`}
                className="mt-3 inline-block text-xs font-semibold text-primary-ink"
              >
                Открыть бюллетень в карточке ОМ →
              </Link>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="transport">
          <Card>
            <CardContent className="p-4 text-sm">
              {(row?.summary.transport ?? []).length === 0 ? (
                <p className="text-muted-foreground">Транспорт в сводке не указан.</p>
              ) : (
                <ul className="divide-y">
                  {(row?.summary.transport ?? []).map((line, index) => (
                    <li key={index} className="py-1.5">
                      {Object.values(line as unknown as Record<string, unknown>)
                        .filter((v) => typeof v === "string" && v !== "")
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
