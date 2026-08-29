"use client";

// Панель занятости за выбранный день (Plane №270, Ш-4).
//
// Три группы эталона поимённо — «на дежурстве», «задействованы в ОМ»,
// «отсутствуют» — и «в строю» ЧИСЛОМ: поимённо это весь состав, а панель
// отвечает на вопрос «кто чем занят», а не «кто есть».
//
// Счётчик группы приходит от сервера и НЕ равен длине списка: список подрезан
// потолком, и считать по нему значило бы занизить число на большом
// подразделении. Подрезка названа вслух строкой «и ещё N».
import { LoadFailure } from "@/components/load-failure";
import {
  STATUS_CALENDAR_GROUPS,
  type StatusCalendarGroup,
} from "@/entities/status-calendar";
import { useStatusCalendarDay } from "@/hooks/use-status-calendar";

const MONTH_IN_CASE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** «29 августа 2026» — дата, которую человек читает, а не ISO-строка. */
function humanDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTH_IN_CASE[Number(month) - 1]} ${year}`;
}

interface Props {
  /** Выбранный день; `null` — день ещё не выбран. */
  date: string | null;
  divisionId?: string | null;
}

export function StatusDayPanel({ date, divisionId = null }: Props) {
  const { data, isLoading, isError, refetch, isFetching } = useStatusCalendarDay(
    { date, divisionId }
  );

  return (
    <aside
      aria-label="Занятость за выбранный день"
      // Панель скроллится ВНУТРИ себя, а не тянет страницу: в день большого
      // мероприятия в группе «задействованы в ОМ» стоит два десятка человек и
      // больше, и без своей высоты панель уводила бы сетку за экран — то есть
      // прятала бы то, по чему день и выбирают.
      className="space-y-4 self-start rounded-lg border border-border p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {date ? humanDate(date) : "День не выбран"}
        </h3>
        <p className="text-xs text-muted-foreground">
          {date
            ? "Кто чем занят в этот день"
            : "Выберите день в сетке — панель покажет, кто чем занят"}
        </p>
      </div>

      {isError ? (
        <LoadFailure
          what="занятость за день"
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      ) : isLoading && date ? (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded-md bg-muted/60"
            />
          ))}
        </div>
      ) : data ? (
        <div className="space-y-4">
          {STATUS_CALENDAR_GROUPS.map((group) => (
            <Group
              key={group.key}
              label={group.label}
              hex={group.hex}
              group={data.groups[group.key]}
            />
          ))}
          <p className="border-t border-border pt-3 text-sm text-foreground">
            В строю:{" "}
            <span className="font-semibold">{data.inService}</span> из{" "}
            {data.total}
          </p>
        </div>
      ) : null}
    </aside>
  );
}

function Group({
  label,
  hex,
  group,
}: {
  label: string;
  hex: string;
  group: StatusCalendarGroup;
}) {
  return (
    <section className="space-y-1">
      <h4 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: hex }}
        />
        {label}
        <span className="text-muted-foreground">· {group.count}</span>
      </h4>
      {group.count === 0 ? (
        <p className="text-xs text-muted-foreground">Никого</p>
      ) : (
        <ul className="space-y-1">
          {group.employees.map((person) => (
            <li key={person.id} className="text-xs text-muted-foreground">
              <span className="text-foreground">{person.name}</span>
              {person.division ? ` · ${person.division.name}` : ""}
              {" · "}
              {person.status.name}
            </li>
          ))}
          {group.hasMore ? (
            <li className="text-xs italic text-muted-foreground">
              и ещё {group.count - group.employees.length} — список подрезан
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
