"use client";

/**
 * Баннер «Запрос на ОМ-…: выделено X из Y» на «Статусах сотрудников»
 * (Plane №394, `[СБС-30]`).
 *
 * Отдельной страницы у запроса нет — так в эталоне: начальник управления
 * приходит из уведомления («Выделите N сотрудников на ОМ-… (дата)»), и
 * экран, где он отмечает людей, обязан сказать, ЗАЧЕМ он здесь и сколько
 * ещё нужно. Без баннера уведомление привело бы на обычную таблицу, и
 * человек искал бы глазами, что от него хотят.
 *
 * Адрес запроса — `?forcesRequest=<allocationId>`: его кладёт ссылка
 * уведомления (`notifications-api.ts`). Без параметра баннера нет — экран
 * статусов живёт своей жизнью и не должен показывать чужие заявки.
 *
 * ЧТО ПОКАЗЫВАЕТ. Только СВОЮ строку управления: цифру раскладки
 * департамента и сколько уже проставлено «Участие в ОМ» (считает сервер по
 * статусам — `_with_directorate_progress`). Чекбоксы и создание статуса из
 * запроса — соседний шаг `[СБС-31]` (Plane №395); здесь баннер называет
 * задачу, отмечать людей пока приходится обычным диалогом статуса.
 */
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Megaphone } from "lucide-react";

import { useDirectorateForcesRequest } from "@/hooks/use-forces-request-banner";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";

export function ForcesRequestBanner() {
  const searchParams = useSearchParams();
  const allocationId = searchParams.get("forcesRequest");
  const request = useDirectorateForcesRequest(allocationId);

  if (allocationId === null) return null;
  if (request.isPending) {
    return (
      <div className="bg-muted h-14 w-full animate-pulse rounded-lg" aria-hidden />
    );
  }
  if (request.isError || request.data === undefined) {
    // Заявка чужая или снята — сказать словами, а не молча спрятать баннер:
    // человек пришёл по ссылке и вправе узнать, почему на ней ничего нет.
    return (
      <p role="status" className="text-muted-foreground rounded-lg border px-4 py-3 text-sm">
        Запрос на сбор сил по ссылке не найден — возможно, он снят или адресован
        другому управлению.
      </p>
    );
  }

  const data = request.data;
  return (
    <section
      role="status"
      aria-label={`Запрос на ${data.code}`}
      data-slot="forces-request-banner"
      className="border-primary/40 bg-primary/5 space-y-2 rounded-lg border px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Megaphone className="text-primary-ink h-4 w-4" aria-hidden="true" />
        <span className="font-semibold">
          Запрос на {data.code} ({formatIsoDate(data.businessDate)})
        </span>
        <span className="text-muted-foreground text-sm">
          {data.title} · от «{data.departmentName}»
          {data.dueAt ? ` · срок ${formatIsoDateTime(data.dueAt)}` : ""}
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {data.directorates.map((row) => {
          const done = row.need > 0 && row.assigned >= row.need;
          return (
            <li key={row.divisionId} className="flex items-center gap-2">
              <span>{row.name}:</span>
              {/* `text-green-700` — тот же класс, что у `StatCard tone="success"`:
                  «своих» токенов вроде `text-success-ink` в системе нет, и
                  выдуманный класс молча отрисовался бы как ничто. */}
              <b className={`tabular-nums ${done ? "text-green-700" : ""}`}>
                выделено {row.assigned} из {row.need}
              </b>
              {!done && row.need > 0 && (
                <span className="text-muted-foreground">· ещё {row.need - row.assigned}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-xs">
        Отметьте сотрудников статусом «Участие в ОМ» на это мероприятие —
        выделенные появятся в заявке департамента сами.{" "}
        <Link
          href={`/security-ops/events/${data.eventId}/`}
          className="text-primary-ink font-medium hover:underline"
        >
          Карточка мероприятия →
        </Link>
      </p>
    </section>
  );
}
