"use client";

// Журнал оценивания (§19.27): отвечает «что произошло», а не «какое значение
// выставили» — old/new score, комментарии и оценщик доступны только отдельной
// audit privacy permission, этих полей нет в ответе вовсе. Отказы видны
// наравне с успехами.
import { useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { ScrollText } from "lucide-react";
import { useRatingAudit } from "@/hooks/use-ops-ratings";
import { RatingsNav } from "@/features/ops-ratings/ratings-nav";
import type { RatingAuditEntry } from "@/entities/operational-rating";

const EVENT_LABEL: Record<RatingAuditEntry["eventCode"], string> = {
  EVALUATION_SUBMITTED: "Оценка отправлена",
  EVALUATION_SCORE_CHANGED_FROM_INITIAL:
    "Значение изменено относительно начального",
  EVALUATION_LOW_SCORE_WITHOUT_COMMENT: "Попытка снижения без комментария",
  EVALUATION_CORRECTED: "Оценка исправлена",
  EVALUATION_CORRECTION_REJECTED: "Исправление отклонено",
  EVALUATION_ACCESS_DENIED: "Запрещённая попытка",
  // §19.29: заказ и ВЫДАЧА файла — разные факты.
  RATING_EXPORT_REQUESTED: "Выгрузка заказана",
  RATING_EXPORT_DOWNLOADED: "Файл выгрузки выдан",
  RATING_EXPORT_REJECTED: "Выгрузка отклонена",
};

function dateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

export default function RatingAuditPage() {
  const [page, setPage] = useState(1);
  const query = useRatingAudit(page);
  const data = query.data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ScrollText className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Журнал оценивания</h1>
            <p className="text-muted-foreground">
              Действия с записями оценивания: отправки, исправления, отклонённые
              попытки. Значений оценок, комментариев и оценщиков в журнале нет.
            </p>
          </div>
        </div>

        <RatingsNav />

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка журнала…</p>
        )}
        {query.error !== null && (
          <p className="text-sm text-destructive">{query.error.message}</p>
        )}

        {data !== undefined && (
          <>
            <section className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Журнал действий оценивания</caption>
                <thead>
                  <tr>
                    {[
                      "Время",
                      "Событие",
                      "Исход",
                      "Кто действовал",
                      "Мероприятие",
                      "Ссылки",
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
                  {data.results.map((entry) => (
                    <tr key={entry.id} className="border-t align-top">
                      <td className="p-3 text-xs tabular-nums">
                        {dateTime(entry.occurredAt)}
                      </td>
                      <td className="p-3 text-sm">
                        {EVENT_LABEL[entry.eventCode]}
                      </td>
                      <td className="p-3 text-xs">
                        {entry.outcome === "SUCCESS" ? "Выполнено" : "Отклонено"}
                        {entry.reasonCode !== null && (
                          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                            {entry.reasonCode}
                          </span>
                        )}
                      </td>
                      {/* Кто действовал — НЕ «кто оценил»: связь оценки с
                          оценщиком остаётся закрытой. */}
                      <td className="p-3 text-xs">{entry.actorUserId ?? "—"}</td>
                      <td className="p-3 text-xs">
                        {entry.securityEventId ?? "—"}
                      </td>
                      <td className="p-3 text-[11px] font-mono text-muted-foreground">
                        {[
                          entry.evaluationId,
                          entry.correctionId,
                          entry.assignmentId,
                          entry.requestId === null
                            ? null
                            : `req:${entry.requestId}`,
                          entry.revision === null
                            ? null
                            : `rev:${entry.revision}`,
                        ]
                          .filter((value): value is string => value !== null)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.results.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  Событий пока нет.
                </p>
              )}
            </section>

            <div className="flex items-center gap-3 text-sm">
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 disabled:opacity-50"
                disabled={data.page <= 1}
                onClick={() => setPage(data.page - 1)}
              >
                Назад
              </button>
              <span className="text-xs text-muted-foreground">
                Страница {data.page} из {data.pageCount} · событий {data.total}
              </span>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 disabled:opacity-50"
                disabled={data.page >= data.pageCount}
                onClick={() => setPage(data.page + 1)}
              >
                Вперёд
              </button>
            </div>

            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Что не показывается</h2>
              <ul className="flex flex-col gap-2">
                {data.unavailableViews.map((view) => (
                  <li key={view.code} className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {view.label}.{" "}
                    </span>
                    {view.reason}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
