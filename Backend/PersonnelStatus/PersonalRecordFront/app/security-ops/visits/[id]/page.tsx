"use client";

// Страница визита иностранного ОЛ (`[ГВО-01]`, `[ГВО-04]`, `[ГВО-07]`,
// `[ГВО-09]`, Plane №436, Ш-20 плана P2).
//
// Отдельная карточка визита: открывается из вкладки «Визиты иностранных ОЛ»
// реестра и из карточки ОМ. У внутреннего мероприятия визита нет — страница
// говорит это словами, а не отказом: адрес ведёт к ОМ, у которого «нечего
// показывать», и это ответ.
//
// Шапка — «тип визита · статус · прогресс обязательных · PDF / Утвердить /
// Редактировать бюллетень»; «Утвердить» недоступна, пока обязательные не
// заполнены (список — в подсказке), и открыта штабу (`gvo.manage`).
//
// ВКЛАДОК БОЛЬШЕ НЕТ (Plane №951). Каркас `[ГВО-02]` держал четыре вкладки —
// «Сводные данные ГВО / Объекты посещения / Бюллетень / Транспорт», — и
// заказчик спросил, зачем они. Ответ: три из четырёх повторяли то, что уже
// стоит в сводке: разделы «Объекты посещения» и «Выделяемый транспорт» — её
// собственные блоки, а «Бюллетень» показывал четыре поля шапки и ссылку на
// карточку ОМ. Правка бюллетеня переехала кнопкой в шапку, объекты
// добавляются из сводки, машины реестра в ней уже были. Вместе с вкладками
// сняты `forceMount` и метка несохранённого на ярлыке (№693): форма теперь
// единственное содержимое страницы и с экрана не уходит.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { useSecurityEvent } from "@/hooks/use-security-events";
import { useApproveVisit, useGvoSummary } from "@/hooks/use-gvo-summaries";
import { useRenderEventDocument } from "@/hooks/use-ops-reports";
import { saveBinaryFile } from "@/features/ops-reports/report-shared";
import { EditBulletinDialog } from "@/features/create-security-event";
import { GvoSummaryPanel } from "@/widgets/gvo-summary";
import { SECURITY_EVENT_KIND_LABEL } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import type { GvoSummaryRow } from "@/entities/gvo-summary";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";
import { RightGate } from "@/shared/ui/right-gate";

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
  // Правка бюллетеня — по слову сервера (`canEditBulletin`, Plane №951):
  // ведущий ОМ либо его создатель; старый сервер поля не несёт — по праву.
  const canEditBulletin =
    (event.canEditBulletin ?? hasPermission("event.manage")) &&
    event.stage !== "CLOSED";
  const [bulletinOpen, setBulletinOpen] = useState(false);
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
  // 🔴 СВОДКА ЕЩЁ НЕ ПРИШЛА — УТВЕРЖДАТЬ НЕЧЕГО (Plane №522, п. 2). Расчёт
  // читает `row`, и пока запрос идёт (или отказал), `missing` пуст просто
  // потому, что данных нет: кнопка выглядела рабочей, человек жал и получал
  // голый 422 вместо погашенной кнопки с причиной. Отказ назван отдельно от
  // загрузки: «подождите» после 500 — совет, который не может помочь.
  const approveBlocker =
    summary.isPending
      ? "Сводка ещё загружается"
      : summary.isError
        ? "Сводка не загрузилась — обновите страницу"
        : status === "APPROVED"
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
            {canEditBulletin && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBulletinOpen(true)}
              >
                Редактировать бюллетень
              </Button>
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
            {/* 🔴 ПРИЧИНА — ВИДИМОЙ СТРОКОЙ, А НЕ `title` (правило №801,
                найдено ревью №825). На ВЫКЛЮЧЕННОЙ кнопке браузер подавляет
                указательные события вместе с подсказкой: `title` показывался
                бы ровно тогда, когда показаться не может. У двух ветвей причина
                видна и без него (перечень незаполненных печатается абзацем
                ниже, «утверждён» — чипом статуса), а у ДВУХ НОВЫХ — «сводка
                ещё загружается» и «сводка не загрузилась» — не видно ничего:
                человек получал вечно мёртвую кнопку без единого слова. То
                есть предмет пункта 2 карточки был выполнен наполовину. */}
            <RightGate reason={approveBlocker}>
              {(describedBy) => (
                <Button
                  type="button"
                  size="sm"
                  disabled={approveBlocker !== null || approve.isPending}
                  aria-describedby={describedBy}
                  aria-busy={approve.isPending}
                  onClick={() => approve.mutate({ omCode: event.code })}
                >
                  {approve.isPending ? "Утверждаем…" : "Утвердить"}
                </Button>
              )}
            </RightGate>
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

      <GvoSummaryPanel event={event} variant="page" />

      <EditBulletinDialog
        event={event}
        open={bulletinOpen}
        onClose={() => setBulletinOpen(false)}
      />
    </>
  );
}
