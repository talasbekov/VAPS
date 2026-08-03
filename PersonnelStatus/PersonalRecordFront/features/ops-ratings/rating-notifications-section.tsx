"use client";

// Уведомления раздела оценивания (§19.28). Текст берётся из фиксированного
// словаря ПО КОДУ: подставлять в формулировки нечего, потому что подстановок
// нет вовсе. Deep link ведёт на маршрут, который перепроверяет права.
import Link from "next/link";
import { useRatingNotifications } from "@/hooks/use-ops-ratings";
import type { RatingNotificationCode } from "@/entities/operational-rating";

const NOTIFICATION_TEXT: Record<RatingNotificationCode, string> = {
  EVALUATION_AVAILABLE: "Вам доступно итоговое оценивание мероприятия",
  EVALUATION_SUBMITTED: "Оценивание успешно отправлено",
  EVALUATION_CORRECTED: "Оценка была исправлена уполномоченным пользователем",
};

function dateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

export function RatingNotificationsSection() {
  const query = useRatingNotifications();
  const data = query.data;
  if (data === undefined) return null;

  return (
    <section
      className="mb-4 rounded-xl border bg-card p-4"
      aria-label="Уведомления оценивания"
    >
      <h2 className="mb-2 text-sm font-semibold">Уведомления</h2>
      {data.results.length === 0 ? (
        <p className="text-xs text-muted-foreground">Уведомлений нет.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.results.map((item) => (
            <li key={item.id} className="text-xs">
              <Link className="underline" href={item.deepLink}>
                {NOTIFICATION_TEXT[item.code]}
              </Link>
              <span className="ml-2 text-muted-foreground">
                {dateTime(item.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {data.unavailableViews.map((view) => (
          <li key={view.code} className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{view.label}. </span>
            {view.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
