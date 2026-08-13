"use client";

// Календарная сетка смен: FullCalendar (реюз пакета и стилей OLD —
// widgets/status-calendar), два источника событий без объединения по
// сотруднику — дежурства и расстановки ОМ, каждое событие ведёт в свой
// источник.
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg } from "@fullcalendar/core";
import { DUTY_STATE_LABEL } from "@/entities/duty-shift";
import type { DutyShift } from "@/entities/duty-shift";
import { STAGE_LABEL } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import "@/widgets/status-calendar/ui/calendar.css";

const DUTY_COLOR: Record<DutyShift["stateCode"], { bg: string; text: string }> = {
  PLANNED: { bg: "#dbeafe", text: "#1e40af" },
  ACKNOWLEDGED: { bg: "#f3e8ff", text: "#6b21a8" },
  ACTIVE: { bg: "#dcfce7", text: "#166534" },
  COMPLETED: { bg: "#f3f4f6", text: "#6b7280" },
  CANCELLED: { bg: "#fee2e2", text: "#991b1b" },
};

interface ShiftCalendarProps {
  shifts: DutyShift[];
  events: SecurityEvent[];
}

export function ShiftCalendar({ shifts, events }: ShiftCalendarProps) {
  const router = useRouter();

  const calendarEvents = useMemo(() => {
    const dutyEvents = shifts.map((shift) => {
      const color = DUTY_COLOR[shift.stateCode];
      return {
        id: `duty-${shift.id}`,
        title: `${shift.employeeName} · ${shift.target.safeLabel}`,
        start: shift.businessDate,
        allDay: true,
        backgroundColor: color.bg,
        borderColor: color.text,
        textColor: color.text,
        extendedProps: {
          // Ссылки нет: карточку смены удалили вместе с «Планом дежурств»
          // (13.08.2026). Пустой href оставляет смену видимой в календаре и
          // не ведёт в 404 — клик просто ничего не делает.
          hint: `Дежурство · ${DUTY_STATE_LABEL[shift.stateCode]}`,
        },
      };
    });
    const securityEvents = events.map((event) => ({
      id: `event-${event.id}`,
      title: `ОМ ${event.code} · ${event.title}`,
      start: event.businessDate,
      allDay: true,
      backgroundColor: "#ede9fe",
      borderColor: "#5b21b6",
      textColor: "#5b21b6",
      extendedProps: {
        href: `/security-ops/events/${event.id}`,
        hint: `ОМ · ${STAGE_LABEL[event.stage]} · назначено ${event.placementAssignments.length}`,
      },
    }));
    return [...dutyEvents, ...securityEvents];
  }, [shifts, events]);

  function onEventClick(arg: EventClickArg): void {
    const href = arg.event.extendedProps.href as string | undefined;
    if (href) router.push(href);
  }

  return (
    <FullCalendar
      plugins={[dayGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      locale="ru"
      firstDay={1}
      height="auto"
      headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
      buttonText={{ today: "Сегодня" }}
      events={calendarEvents}
      eventClick={onEventClick}
      eventDidMount={(info) => {
        const hint = info.event.extendedProps.hint as string | undefined;
        if (hint) info.el.title = `${info.event.title} — ${hint}`;
      }}
      dayMaxEventRows={4}
    />
  );
}
