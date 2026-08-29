"use client";

// Вид «Матрица» календаря статусов (Plane №270, Ш-5): строка на сотрудника,
// колонка на день, буква в ячейке.
//
// Буква, а не только цвет: матрица — это календарный хитмап, и цвет в нём
// обязан дублироваться символом и подписью (иначе ячейку нельзя прочитать ни
// в чёрно-белой печати, ни при дальтонизме). Легенда под таблицей называет
// каждую встреченную букву словами из СПРАВОЧНИКА, а не из таблицы в
// компоненте.
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadFailure } from "@/components/load-failure";
import { STATUS_LETTERS, letterForStatus } from "@/entities/status-calendar";
import { useStatusCalendarMonth } from "@/hooks/use-status-calendar";
import { isoMonth } from "./StatusMonthGrid";

const MONTH_NAMES = [
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

interface Props {
  divisionId?: string | null;
}

export function StatusMatrix({ divisionId = null }: Props) {
  const [month, setMonth] = useState(() => isoMonth(new Date()));
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch, isFetching } =
    useStatusCalendarMonth({ month, divisionId, page });

  const names = useMemo(() => {
    const map = new Map<string, string>();
    (data?.catalog ?? []).forEach((row) => map.set(row.code, row.name));
    return map;
  }, [data?.catalog]);

  /** Только те коды, что есть НА ЭКРАНЕ: легенда объясняет видимое. */
  const seen = useMemo(() => {
    const codes = new Set<string>();
    (data?.results ?? []).forEach((row) =>
      row.days.forEach((code) => codes.add(code))
    );
    return [...codes].sort();
  }, [data?.results]);

  const shiftMonth = (step: number) => {
    const cursor = new Date(`${month}-01T00:00:00`);
    cursor.setMonth(cursor.getMonth() + step);
    setMonth(isoMonth(cursor));
    setPage(1);
  };

  const [year, monthIndex] = month.split("-");
  const title = `${MONTH_NAMES[Number(monthIndex) - 1]} ${year}`;
  const pageCount = data ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1;

  if (isError) {
    return (
      <LoadFailure
        what="матрицу статусов"
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Предыдущий месяц"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[10rem] text-center text-base font-semibold">
            {title}
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Следующий месяц"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {/* Сказано вслух, что показана СТРАНИЦА: молчаливая обрезка
                читалась бы как «в подразделении столько людей». */}
            <span>
              Показаны {data.results.length} из {data.count} · страница{" "}
              {data.page} из {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page <= 1 || isFetching}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page >= pageCount || isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              Вперёд
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-md bg-muted/60" aria-hidden />
      ) : (
        // Скроллится САМА таблица, а не страница: 31 колонка не помещается по
        // ширине, а горизонтальный скролл страницы уводит и меню, и шапку.
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">
              Статусы сотрудников по дням, {title}
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-[14rem] bg-background p-2 text-left font-medium"
                >
                  Сотрудник
                </th>
                {(data?.days ?? []).map((date) => (
                  <th
                    key={date}
                    scope="col"
                    className="w-7 p-1 text-center font-medium text-muted-foreground"
                  >
                    {Number(date.slice(8, 10))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.results ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-normal"
                  >
                    <span className="text-foreground">{row.name}</span>
                    {row.division ? (
                      <span className="block text-[10px] text-muted-foreground">
                        {row.division.name}
                      </span>
                    ) : null}
                  </th>
                  {row.days.map((code, index) => {
                    const date = data?.days[index] ?? "";
                    const label = names.get(code) ?? code;
                    return (
                      <td
                        key={date}
                        // Буква факта читается, «·» отступает: в строю — это
                        // фон, а не сообщение, и одинаковый вес у них означал
                        // бы, что глазу их надо различать самому.
                        className={[
                          "px-1 py-0.5 text-center",
                          code === "IN_SERVICE"
                            ? "text-muted-foreground/60"
                            : "font-medium text-foreground",
                        ].join(" ")}
                        title={`${row.name} · ${Number(date.slice(8, 10))} ${MONTH_NAMES[
                          Number(monthIndex) - 1
                        ].toLowerCase()} · ${label}`}
                      >
                        {letterForStatus(code, label)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {seen.map((code) => (
          <li key={code}>
            <span className="font-semibold text-foreground">
              {letterForStatus(code, names.get(code) ?? code)}
            </span>{" "}
            — {names.get(code) ?? code}
          </li>
        ))}
        {seen.length === 0 ? <li>За этот месяц статусов нет.</li> : null}
        <li className="italic">
          «{STATUS_LETTERS.IN_SERVICE}» — в строю: не событие, а норма.
        </li>
      </ul>
    </div>
  );
}
