import type { ReactNode } from "react";
import type { ProfileNextShift } from "../model/profile-next-shift";

const SOURCE_LABEL: Record<ProfileNextShift["source"], string> = {
  STATUS: "Постовое назначение", DISPATCH: "Расстановка", LOG: "Журнал дежурств",
  PLAN: "План дежурств", OM: "Охранное мероприятие",
};

const dateLabel = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso)
  ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "Дата не указана";
const momentLabel = (iso: string | null, timeZone: string) => iso && Number.isFinite(Date.parse(iso))
  ? new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
  : "Не указано";

/** Personal acknowledgement records intent; it never supplies attendance. */
export function NextShiftCard({
  shift, loading = false, incomplete = false, notes = [], retrying = false,
  onRetry, instructionLink, acknowledgement, timeZone = "Asia/Almaty",
}: {
  shift: ProfileNextShift | null;
  loading?: boolean;
  incomplete?: boolean;
  notes?: readonly string[];
  retrying?: boolean;
  onRetry?: () => void;
  /** The caller supplies an EventLink only after checking module access. */
  instructionLink?: ReactNode;
  acknowledgement?: { canSubmit: boolean; pending: boolean; busy: boolean; succeeded: boolean; errorMessage: string | null; onSubmit: () => void };
  timeZone?: string;
}) {
  return (
    <section data-slot="my-next-shift" aria-labelledby="my-next-shift-title" aria-busy={loading || retrying || acknowledgement?.pending}
      className="rounded-xl border border-primary/30 bg-card p-4 shadow-sm sm:p-5 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-next-shift-title" className="text-base font-semibold">Моя ближайшая смена</h2>
        <span className="text-xs text-muted-foreground">Время Астаны</span>
      </div>
      {shift === null ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {loading ? "Загружаем личные назначения…" : incomplete
            ? "Ближайшую смену определить не удалось: не все источники доступны."
            : "Ближайших назначений нет."}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{SOURCE_LABEL[shift.source]}{shift.source === "OM" ? ` · ${shift.title}` : ""}</p>
              <h3 className="mt-1 text-base font-semibold">{shift.objectLabel ?? "Объект не указан"}</h3>
              <p className="text-sm">{shift.postLabel ?? "Пост не указан в источнике"}</p>
            </div>
            <span className={shift.execution === "STARTED"
              ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900  "
              : "rounded-full bg-muted px-2.5 py-1 text-xs font-semibold"}>
              {shift.execution === "STARTED" ? "Сейчас на смене" : shift.execution === "PREPARING" ? "Назначение готовится" : "Назначен"}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Даты назначения: {dateLabel(shift.dateStart)}{shift.dateEnd !== shift.dateStart ? ` — ${dateLabel(shift.dateEnd)}` : ""}
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Начало по плану</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{momentLabel(shift.plannedStart, timeZone)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Окончание по плану</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{momentLabel(shift.plannedEnd, timeZone)}</dd></div>
          </dl>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div><dt className="font-medium">Ознакомление</dt><dd className="mt-0.5 text-muted-foreground">{shift.acknowledgedAt
              ? `Подтверждено · ${momentLabel(shift.acknowledgedAt, timeZone)}` : "Не подтверждено"}</dd></div>
            <div><dt className="font-medium">Заступление</dt><dd className="mt-0.5 text-muted-foreground">{shift.execution === "STARTED"
              ? `Отмечено · ${momentLabel(shift.actualStart, timeZone)}` : "Не отмечено"}</dd></div>
            <div><dt className="font-medium">Старший</dt><dd className="mt-0.5 text-muted-foreground">{shift.senior ?? "Не указан в источнике"}</dd></div>
            <div><dt className="font-medium">Инструкция</dt><dd className="mt-0.5 text-muted-foreground">{shift.instruction ?? "Не передана в источнике"}{instructionLink && <span className="mt-1 block">{instructionLink}</span>}</dd></div>
          </dl>
          {shift.execution === "DECLINED" && <p className="mt-3 text-xs">Сообщён отказ от заступления{shift.declineReason ? `: ${shift.declineReason}` : "."}</p>}
          {shift.execution !== "STARTED" && <p className="mt-3 text-xs text-muted-foreground">Назначение и ознакомление не подтверждают фактическое заступление.</p>}
          {shift.source !== "OM" && shift.canAcknowledge && acknowledgement && <button type="button"
            onClick={acknowledgement.onSubmit} disabled={!acknowledgement.canSubmit || acknowledgement.busy}
            className="mt-3 min-h-10 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {acknowledgement.pending ? "Подтверждаем ознакомление…" : "Ознакомлен, заступлю"}
          </button>}
          {acknowledgement?.errorMessage && <p role="alert" className="mt-3 text-sm">{acknowledgement.errorMessage}</p>}
          {acknowledgement?.succeeded && <p role="status" className="mt-3 text-xs">Ознакомление сохранено. Заступление отмечается отдельно.</p>}
          {incomplete && <p role="status" className="mt-3 text-xs text-muted-foreground">Показаны доступные данные; ближайшую смену по всем источникам подтвердить не удалось.</p>}
        </>
      )}
      {notes.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
      {onRetry && <button type="button" onClick={onRetry} disabled={retrying}
        className="mt-3 min-h-9 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60">
        {retrying ? "Обновляем…" : "Обновить ближайшую смену"}
      </button>}
    </section>
  );
}
