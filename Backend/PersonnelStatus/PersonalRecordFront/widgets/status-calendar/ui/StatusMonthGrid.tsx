"use client";

// Вид «Месяц» календаря статусов (Plane №270, Ш-3): сетка месяца с точками
// занятости по дням.
//
// Точки берутся из СВОДКИ ручки, а не считаются из страницы состава: страница
// ограничена потолком 100, и счёт по ней показал бы «трое в отпуске» там, где
// их тридцать.
//
// Цвет — не единственный носитель смысла: рядом с каждой точкой стоит ЧИСЛО,
// у ячейки есть подпись для чтения с экрана, а под сеткой — легенда.
import { useMemo } from "react";
import { LoadFailure } from "@/components/load-failure";
import { STATUS_CALENDAR_GROUPS } from "@/entities/status-calendar";
import type { StatusCalendarDaySummary } from "@/entities/status-calendar";
import { useStatusCalendarMonth } from "@/hooks/use-status-calendar";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

/** ISO-дата локального дня: `toISOString()` увёл бы день на часовом поясе. */
export function isoDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** `ГГГГ-ММ` месяца даты. */
export function isoMonth(value: Date): string {
  return isoDate(value).slice(0, 7);
}

/** Сколько пустых клеток перед первым числом: неделя начинается с понедельника. */
function leadingBlanks(monthValue: string): number {
  const first = new Date(`${monthValue}-01T00:00:00`);
  return (first.getDay() + 6) % 7;
}

interface Props {
  month: string;
  search?: string;
  /** Подразделение; не задано — вся область пользователя. */
  divisionId?: string | null;
  /** Выбранный день — им живёт панель занятости (Ш-4). */
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

export function StatusMonthGrid({
  month,
  search = "",
  divisionId = null,
  selectedDate,
  onSelectDate,
}: Props) {
  const { data, isLoading, isError, refetch, isFetching } =
    useStatusCalendarMonth({ month, divisionId, search });

  const today = isoDate(new Date());
  const summaryByDate = useMemo(() => {
    const map = new Map<string, StatusCalendarDaySummary>();
    (data?.summary ?? []).forEach((row) => map.set(row.date, row));
    return map;
  }, [data?.summary]);

  const [year, monthIndex] = month.split("-");
  const title = `${MONTH_NAMES[Number(monthIndex) - 1]} ${year}`;

  if (isError) {
    return (
      <LoadFailure
        what="календарь статусов"
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        <div className="text-sm text-muted-foreground">
          {/* Число названо СВОИМИ словами: шапка экрана считает занятые
              штатные единицы директората (436 на стенде), а сводка календаря —
              сотрудников области права `status.view` (440). Оба числа честны, но
              отвечают на разные вопросы, и подпись «Всего сотрудников» здесь
              обещала бы, что они обязаны совпасть. */}
          {data ? `Сводка по ${data.count} сотрудникам области` : " "}
          {isFetching ? " · обновляется…" : ""}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Занятость, ${title}`}>
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="pb-1 text-center text-xs font-medium text-muted-foreground"
          >
            {weekday}
          </div>
        ))}

        {isLoading
          ? Array.from({ length: 35 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="h-24 animate-pulse rounded-md bg-muted/60"
              />
            ))
          : (
              <>
                {Array.from({ length: leadingBlanks(month) }).map((_, index) => (
                  <div key={`blank-${index}`} aria-hidden className="h-24" />
                ))}
                {(data?.days ?? []).map((date) => {
                  const summary = summaryByDate.get(date);
                  const dayNumber = Number(date.slice(8, 10));
                  const isToday = date === today;
                  const isSelected = date === selectedDate;
                  const parts = STATUS_CALENDAR_GROUPS.map((group) => ({
                    ...group,
                    value: summary
                      ? group.key === "on_duty"
                        ? summary.onDuty
                        : group.key === "on_event"
                        ? summary.onEvent
                        : summary.absent
                      : 0,
                  })).filter((part) => part.value > 0);

                  const label = parts.length
                    ? parts
                        .map((part) => `${part.label.toLowerCase()} ${part.value}`)
                        .join(", ")
                    : "занятости нет";

                  return (
                    <button
                      type="button"
                      key={date}
                      onClick={() => onSelectDate(date)}
                      aria-pressed={isSelected}
                      aria-label={`${dayNumber} ${MONTH_NAMES[
                        Number(monthIndex) - 1
                      ].toLowerCase()}: ${label}`}
                      className={[
                        "flex h-24 min-w-0 flex-col items-start gap-1 rounded-md border p-1 text-left transition-colors sm:p-2",
                        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSelected ? "border-primary ring-2 ring-primary" : "border-border",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "text-sm",
                          isToday ? "font-bold text-primary" : "text-foreground",
                        ].join(" ")}
                      >
                        {dayNumber}
                      </span>
                      <span className="flex flex-col gap-0.5">
                        {parts.map((part) => (
                          <span
                            key={part.key}
                            className="flex items-center gap-1 text-xs text-muted-foreground"
                          >
                            <span
                              aria-hidden
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: part.hex }}
                            />
                            {part.value}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
      </div>

      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {STATUS_CALENDAR_GROUPS.map((group) => (
          <li key={group.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: group.hex }}
            />
            {group.label}
          </li>
        ))}
        <li>«В строю» точкой не отмечается — это норма, а не событие.</li>
      </ul>
    </div>
  );
}
