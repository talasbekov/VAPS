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

import { Button } from "@/components/ui/button";
import {
  useDirectorateForcesRequest,
  useSelectForRequest,
} from "@/hooks/use-forces-request-banner";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";

export function ForcesRequestBanner({
  selectedEmployees = [],
  onSelected,
}: {
  /** Кого начальник отметил чекбоксами в таблице ниже (Plane №395,
   *  `[СБС-31]`): выделение идёт ИЗ ЗАПРОСА — мероприятие и даты он не
   *  выбирает, статус ставит сервер. */
  selectedEmployees?: string[];
  /** После выделения — таблице пора перечитать статусы и снять отметки. */
  onSelected?: () => void;
}) {
  const searchParams = useSearchParams();
  const allocationId = searchParams.get("forcesRequest");
  const request = useDirectorateForcesRequest(allocationId);
  const select = useSelectForRequest(allocationId);
  // 🔴 СТРОКА ТАБЛИЦЫ СТАТУСОВ АДРЕСУЕТ СОТРУДНИКА СОСТАВНЫМ КЛЮЧОМ
  // `${staffUnitId}-${employeeId}` (см. `status-table.tsx`, `employeeIdOf`),
  // а вакансии — `${unitId}-vacant…`. Серверу нужен ГОЛЫЙ employeeId: первая
  // редакция слала ключ как есть, и сервер честно отвечал «5132-18 —
  // Сотрудник не вашего управления» (поймано живой пробой).
  const employeeIds = selectedEmployees
    .map((key) => key.split("-")[1])
    .filter((id): id is string => id !== undefined && !id.startsWith("vacant") && /^\d+$/.test(id));

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
      {/* ЧЕКБОКСЫ → «УЧАСТИЕ В ОМ» (`[СБС-31]`, Plane №395). Кнопка живёт в
          баннере, а не в диалоге статуса: человек не выбирает мероприятие и
          дат не вводит — всё это даёт запрос. Отказы сервер называет
          поимённо (пересечение статусов, чужое управление), и они видны
          здесь же, а не в тосте, который уедет. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={employeeIds.length === 0 || select.isPending}
          onClick={() =>
            select.mutate({ employeeIds }, { onSuccess: () => onSelected?.() })
          }
        >
          {select.isPending
            ? "Выделяю…"
            : employeeIds.length === 0
              ? "Отметьте сотрудников в таблице — и выделите на ОМ"
              : `Выделить на ${data.code}: ${employeeIds.length}`}
        </Button>
        <span className="text-muted-foreground text-xs">
          Статус «Участие в ОМ» с датами мероприятия проставится сам; объект
          назначит штаб.{" "}
          <Link
            href={`/security-ops/events/${data.eventId}/`}
            className="text-primary-ink font-medium hover:underline"
          >
            Карточка мероприятия →
          </Link>
        </span>
      </div>
      {select.data !== undefined && (
        <p role="status" className="text-sm" data-slot="select-report">
          Выделено: <b className="tabular-nums">{select.data.selected.length}</b>
          {select.data.refused.length > 0 && (
            <>
              {" "}· не выделены:{" "}
              {select.data.refused.map((row) => `${row.name} — ${row.message}`).join("; ")}
            </>
          )}
        </p>
      )}
      {select.isError && (
        <p role="alert" className="text-destructive-ink text-sm">
          {select.error?.message ?? "Выделить не удалось"}
        </p>
      )}
    </section>
  );
}
