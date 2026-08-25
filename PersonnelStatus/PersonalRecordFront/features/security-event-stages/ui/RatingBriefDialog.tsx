"use client";

// Модалка «Краткая информация о рейтинге» с экрана «Расстановка» прототипа
// (Plane №65, шаг «Р-5»): открывается по бейджу рейтинга у человека.
//
// Только просмотр. Оценку на расстановке не ставят и не правят — это делают
// на закрытии мероприятия, и подпись говорит это вслух, а не прячет кнопку.
//
// Чего у бэка нет и что поэтому не нарисовано: «оснований» отдельной строкой
// нет — реестр оценок даёт направление и метод, они и стоят в этом месте.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useEvaluationRegistry,
  useRatingEmployeeDetail,
} from "@/hooks/use-ops-ratings";
import { formatIsoDate } from "@/shared/lib/date";

const DIRECTION_LABEL: Record<string, string> = {
  SELF: "самооценка",
  MANAGER: "оценка руководителя",
  PEER: "оценка коллеги",
  SUBORDINATE: "оценка подчинённого",
};

/** Сколько последних оценок показывает прототип. */
const RECENT_LIMIT = 3;

export function RatingBriefDialog({
  employeeId,
  employeeName,
  unit,
  rating,
  onClose,
}: {
  /** null — модалка закрыта; открывает её выбор человека, а не флаг рядом. */
  employeeId: string | null;
  employeeName: string;
  unit: string;
  /** Агрегат, УЖЕ показанный бейджем: модалка обязана назвать то же число.
   * Спрашивать его вторым запросом значило бы завести второй источник,
   * который однажды разойдётся с бейджем на глазах у читателя. */
  rating: number | null;
  onClose: () => void;
}) {
  const detail = useRatingEmployeeDetail(employeeId);
  // Реестр спрашивается ПО СОТРУДНИКУ и только при открытой модалке: список
  // оценок службы целиком расстановке не нужен, а право на реестр есть не у
  // каждого — запрос без нужды приносил бы 403 на каждом рендере.
  const registry = useEvaluationRegistry({
    from: null,
    to: null,
    event: null,
    unit: null,
    employee: employeeId,
    direction: null,
    method: null,
    correctedOnly: false,
    search: "",
    page: 1,
  });
  const summary = detail.data?.summary ?? null;
  const recent = (registry.data?.results ?? []).slice(0, RECENT_LIMIT);

  return (
    <Dialog open={employeeId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Краткая информация о рейтинге</DialogTitle>
          <DialogDescription>
            Только для просмотра · изменение недоступно на этапе «Расстановка»
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{employeeName}</p>
            <p className="text-xs text-muted-foreground">
              {unit === "" ? "подразделение не указано" : unit}
            </p>
          </div>
          <span className="inline-flex shrink-0 rounded-xl bg-secondary px-3 py-1 text-lg font-extrabold tabular-nums text-secondary-foreground">
            {rating ?? summary?.aggregateRating ?? "—"}
          </span>
        </div>

        {detail.isError ? (
          <p className="text-xs text-muted-foreground">
            Подробности рейтинга по этому сотруднику недоступны.
          </p>
        ) : (
          <dl className="text-xs">
            <Fact k="Оценок в периоде" v={summary?.evaluationsCount ?? "—"} />
            <Fact
              k="Период"
              v={
                summary?.periodStartsAt == null || summary?.periodEndsAt == null
                  ? "—"
                  : `${formatIsoDate(summary.periodStartsAt)} — ${formatIsoDate(summary.periodEndsAt)}`
              }
            />
            <Fact k="Методика" v={summary?.calculationPolicyVersion ?? "—"} />
            <Fact
              k="Посчитан"
              v={summary == null ? "—" : formatIsoDate(summary.calculatedAt)}
            />
            <Fact k="Состояние данных" v={dataStateLabel(summary?.dataState)} />
          </dl>
        )}

        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Последние {RECENT_LIMIT} оценки
        </p>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {registry.isPending
              ? "Загрузка оценок…"
              : registry.isError
                ? "Реестр оценок недоступен."
                : "Оценок пока нет."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((row) => (
              <li
                key={row.rowId}
                className="flex items-center gap-2 border-b py-2 last:border-b-0"
              >
                <span className="inline-flex shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-extrabold tabular-nums text-secondary-foreground">
                  {row.aggregateRating ?? "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">
                    {DIRECTION_LABEL[row.evaluationDirection] ??
                      row.evaluationDirection}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {row.eventTitle} · {row.objectLabel}
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                  {formatIsoDate(row.evaluatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function dataStateLabel(state: string | undefined): string {
  switch (state) {
    case "READY":
      return "рассчитан";
    case "INSUFFICIENT_DATA":
      return "данных недостаточно";
    case undefined:
      return "—";
    default:
      return state;
  }
}

function Fact({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex gap-2 border-b py-1.5 last:border-b-0">
      <dt className="w-[150px] shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 flex-1 font-medium">{v}</dd>
    </div>
  );
}
