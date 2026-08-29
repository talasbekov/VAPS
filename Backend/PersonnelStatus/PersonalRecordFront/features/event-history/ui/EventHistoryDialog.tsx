"use client";

/**
 * История охранных мероприятий — общее окно для двух карточек (задача
 * заказчика Plane №38).
 *
 * ОДНО окно на «Охраняемые лица» и «Объекты и паспорта», потому что вопрос у
 * них один и тот же: «в каких закрытых ОМ это участвовало и с чем именно оно
 * там было связано». Отличается ровно вложенный список: у лица — объекты,
 * которые он ЛИЧНО посетил, у объекта — лица, посещавшие ИМЕННО его. Две копии
 * окна разъехались бы на первой же правке подписи.
 *
 * ТОЛЬКО ЗАКРЫТЫЕ мероприятия — правило сервера, и оно названо на экране:
 * «история» без этой оговорки читалась бы как «все ОМ», и отсутствие
 * действующего мероприятия выглядело бы потерей.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatIsoDate } from "@/shared/lib/date";

export interface EventHistoryEntry {
  eventId: string;
  code: string;
  title: string;
  businessDate: string;
  businessDateEnd: string | null;
  closedAt: string | null;
  chiefName: string;
  /** Что связывает мероприятие с карточкой: объекты лица либо лица объекта. */
  related: { key: string; label: string; note: string }[];
}

export interface EventHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  /** Чья история: имя лица или объекта — оно стоит в заголовке окна. */
  subject: string;
  /** Подпись вложенного списка: «Объекты, которые посетил» / «Посещавшие». */
  relatedLabel: string;
  /** Что писать, когда вложенных строк нет. */
  relatedEmpty: string;
  rows: EventHistoryEntry[];
  isLoading: boolean;
  isError: boolean;
}

export function EventHistoryDialog({
  open,
  onClose,
  subject,
  relatedLabel,
  relatedEmpty,
  rows,
  isLoading,
  isError,
}: EventHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>История мероприятий</DialogTitle>
          <DialogDescription>
            {subject} · только ЗАКРЫТЫЕ мероприятия: действующие живут в реестре
            ОМ и ещё меняются
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Загрузка истории…
          </p>
        )}
        {isError && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            История сейчас недоступна — повторите позже.
          </p>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Закрытых мероприятий пока нет.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.eventId} className="rounded-md border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">
                  {row.code} · {row.title}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatIsoDate(row.businessDate)}
                  {row.businessDateEnd === null
                    ? ""
                    : ` — ${formatIsoDate(row.businessDateEnd)}`}
                </span>
              </div>
              {row.chiefName !== "" && (
                <p className="text-xs text-muted-foreground">
                  Старший: {row.chiefName}
                </p>
              )}
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {relatedLabel}
              </p>
              {row.related.length === 0 ? (
                <p className="text-xs text-muted-foreground">{relatedEmpty}</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {row.related.map((item) => (
                    <li key={item.key} className="text-sm">
                      {item.label}
                      {item.note !== "" && (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {item.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
