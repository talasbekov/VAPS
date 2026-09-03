"use client";

// Живое превью строки бюллетеня (Plane №419, `[БЛН-11]`): как заполненная
// форма ляжет в бланк — теми же колонками, что печатает документ
// (`documents_bulletin.bulletin_rows`: дата · время · ОЛ · мероприятие ·
// локация · старший). Человек проверяет ТО, что получится, а не поля.
import { formatBulletinPeriod } from "@/shared/lib/date";

export interface BulletinRowPreviewProps {
  businessDate: string;
  businessDateEnd: string;
  eventTime: string;
  /** «вылет» / «прилёт» / пусто — пометка к времени (`[БЛН-11]`). */
  timeMark: string;
  persons: string[];
  title: string;
  location: string;
  chief: string;
}

const EMPTY = "—";

export function composeBulletinRow(p: BulletinRowPreviewProps) {
  // Период — как в бюллетене (`[МД-10]`, Plane №438): без года, с днями
  // недели; превью обязано показывать то, что напечатает документ.
  const period = p.businessDate === "" ? EMPTY : formatBulletinPeriod(p.businessDate, p.businessDateEnd);
  const time =
    p.eventTime === "" ? EMPTY : p.timeMark === "" ? p.eventTime : `${p.eventTime} (${p.timeMark})`;
  return {
    period,
    time,
    persons: p.persons.length === 0 ? EMPTY : p.persons.join(", "),
    title: p.title.trim() === "" ? EMPTY : p.title.trim(),
    location: p.location === "" ? EMPTY : p.location,
    chief: p.chief === "" ? EMPTY : p.chief,
  };
}

export function BulletinRowPreview(props: BulletinRowPreviewProps) {
  const row = composeBulletinRow(props);
  const cells: [string, string][] = [
    ["Дата", row.period],
    ["Время", row.time],
    ["ОЛ", row.persons],
    ["Мероприятие", row.title],
    ["Локация", row.location],
    ["Старший", row.chief],
  ];
  return (
    <section
      aria-label="Строка бюллетеня"
      className="rounded-lg border bg-muted/40 px-3 py-2.5"
      data-testid="bulletin-row-preview"
    >
      <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.12em] text-muted-foreground">
        Так строка ляжет в бюллетень
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-3">
        {cells.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10.5px] text-muted-foreground">{label}</dt>
            <dd
              className={value === EMPTY ? "text-muted-foreground" : "font-medium"}
              data-testid={`preview-${label}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
