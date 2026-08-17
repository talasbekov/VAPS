"use client";

import { useMemo, useState, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { EventClickArg, EventHoveringArg } from "@fullcalendar/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Calendar, User, MapPin, Clock } from "lucide-react";
import { useStaffUnitsByDirectorate } from "@/hooks/use-staff-units-by-directorate";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_PAINT,
  UNKNOWN_STATUS_PAINT,
} from "@/lib/status";
import type { EmployeeStatusType } from "@/lib/status";
import { motion, AnimatePresence } from "framer-motion";
import { LoadFailure } from "@/components/load-failure";
import "./calendar.css";

// Цвета и подписи статусов — из ОБЩЕЙ палитры, а не из своей hex-таблицы:
// в ней «Отпуск» был синим (в бейджах таблицы — жёлтым), а текст события
// набирался насыщенным 500-м оттенком поверх светлой заливки (≈2.6:1).
// Здесь текст берёт тёмный тон палитры, рамка — насыщенный.
// «В строю» в календаре не рисуется: это не событие, а норма.
const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; border: string; bgColor: string }
> = Object.fromEntries(
  (Object.keys(EMPLOYEE_STATUS_PAINT) as EmployeeStatusType[])
    .filter((code) => code !== "in_service")
    .map((code) => [
      code,
      {
        label: EMPLOYEE_STATUS_LABELS[code],
        color: EMPLOYEE_STATUS_PAINT[code].hex.text,
        border: EMPLOYEE_STATUS_PAINT[code].hex.accent,
        bgColor: EMPLOYEE_STATUS_PAINT[code].hex.bg,
      },
    ])
);

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  extendedProps: {
    employeeId: number;
    employeeName: string;
    position: string;
    division: string;
    statusType: string;
    statusLabel: string;
    state: string;
  };
}

interface TooltipData {
  event: CalendarEvent;
  x: number;
  y: number;
}

export function StatusCalendar() {
  const { data, isLoading, isError, isFetching, refetch } =
    useStaffUnitsByDirectorate();
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null
  );
  const calendarRef = useRef<FullCalendar>(null);

  // Преобразуем данные сотрудников в события календаря
  const events = useMemo<CalendarEvent[]>(() => {
    if (!data?.staff_units) return [];

    const calendarEvents: CalendarEvent[] = [];

    const processUnit = (unit: any, parentDivision: string = "") => {
      const divisionName = unit.division?.name || parentDivision;

      // Обрабатываем сотрудников
      if (unit.employees && Array.isArray(unit.employees)) {
        unit.employees.forEach((empData: any) => {
          const emp = empData.employee;
          if (!emp || !emp.current_status) return;

          const status = emp.current_status;
          if (!status.start_date) return;

          // Пропускаем статус "в строю"
          if (status.status_type === "in_service") return;

          const config = STATUS_CONFIG[status.status_type] ?? {
            label: status.status_type,
            color: UNKNOWN_STATUS_PAINT.hex.text,
            border: UNKNOWN_STATUS_PAINT.hex.accent,
            bgColor: UNKNOWN_STATUS_PAINT.hex.bg,
          };

          const fullName = `${emp.last_name || ""} ${emp.first_name || ""} ${
            emp.middle_name || ""
          }`.trim();
          const position = empData.position?.name || "—";

          // Добавляем 1 день к end_date для корректного отображения в календаре
          let endDate = status.end_date;
          if (endDate) {
            const end = new Date(endDate);
            end.setDate(end.getDate() + 1);
            endDate = end.toISOString().split("T")[0];
          } else {
            // Если нет end_date, показываем до конца месяца
            const start = new Date(status.start_date);
            const endOfMonth = new Date(
              start.getFullYear(),
              start.getMonth() + 1,
              0
            );
            endDate = endOfMonth.toISOString().split("T")[0];
          }

          calendarEvents.push({
            id: `${emp.id}-${status.status_type}-${status.start_date}`,
            title: fullName,
            start: status.start_date,
            end: endDate,
            backgroundColor: config.bgColor,
            borderColor: config.border,
            textColor: config.color,
            extendedProps: {
              employeeId: emp.id,
              employeeName: fullName,
              position: position,
              division: divisionName,
              statusType: status.status_type,
              statusLabel: config.label,
              state: status.state,
            },
          });
        });
      }

      // Рекурсивно обрабатываем дочерние подразделения
      if (unit.children && Array.isArray(unit.children)) {
        unit.children.forEach((child: any) => processUnit(child, divisionName));
      }
    };

    data.staff_units.forEach((unit) => processUnit(unit));

    return calendarEvents;
  }, [data]);

  const handleEventMouseEnter = (arg: EventHoveringArg) => {
    const rect = arg.el.getBoundingClientRect();
    setTooltip({
      event: arg.event as unknown as CalendarEvent,
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
  };

  const handleEventMouseLeave = () => {
    setTooltip(null);
  };

  const handleEventClick = (arg: EventClickArg) => {
    setSelectedEvent(arg.event as unknown as CalendarEvent);
  };

  const getStateLabel = (state: string) => {
    switch (state) {
      case "planned":
        return "Запланировано";
      case "active":
        return "Активно";
      case "completed":
        return "Завершено";
      case "cancelled":
        return "Отменено";
      default:
        return state;
    }
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case "planned":
        return "bg-blue-100 text-blue-800";
      case "active":
        return "bg-green-100 text-green-800";
      case "completed":
        return "bg-gray-100 text-gray-800";
      case "cancelled":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-[600px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Пустой месяц при отказе запроса читался как «в этом месяце никто не
  // отсутствует» — самое дорогое из возможных недоразумений на этом экране.
  if (isError) {
    return (
      <Card>
        <CardContent className="p-6">
          <LoadFailure
            what="календарь статусов"
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Календарь статусов
          <Badge variant="outline" className="ml-2">
            {events.length} событий
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Легенда */}
        <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b">
          {Object.entries(STATUS_CONFIG).map(([key, config]) => (
            <div
              key={key}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
              style={{ backgroundColor: config.bgColor, color: config.color }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: config.border }}
              />
              {config.label}
            </div>
          ))}
        </div>

        {/* Календарь */}
        <div className="status-calendar">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            locale="ru"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek",
            }}
            buttonText={{
              today: "Сегодня",
              month: "Месяц",
              week: "Неделя",
            }}
            events={events}
            eventMouseEnter={handleEventMouseEnter}
            eventMouseLeave={handleEventMouseLeave}
            eventClick={handleEventClick}
            height="auto"
            dayMaxEvents={3}
            moreLinkText={(num) => `+${num} ещё`}
            firstDay={1}
            fixedWeekCount={false}
            eventDisplay="block"
            displayEventTime={false}
          />
        </div>

        {/* Tooltip при наведении */}
        <AnimatePresence>
          {tooltip && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              transition={{ duration: 0.15 }}
              className="fixed z-50 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg pointer-events-none"
              style={{
                left: tooltip.x,
                top: tooltip.y,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div className="font-medium">
                {tooltip.event.extendedProps?.employeeName}
              </div>
              <div className="text-gray-300 text-xs">
                {tooltip.event.extendedProps?.statusLabel}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Карточка события — на базовом диалоге. Раньше это был оверлей из
            motion.div: без role="dialog", без aria-modal, без ловушки фокуса,
            без Escape и без возврата фокуса на место; закрывашка была
            безымянной иконкой. Всё это Radix даёт из коробки. */}
        <Dialog
          open={selectedEvent !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedEvent(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            {selectedEvent !== null && (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {selectedEvent.extendedProps?.employeeName}
                  </DialogTitle>
                  <DialogDescription>
                    {selectedEvent.extendedProps?.position}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      style={{
                        backgroundColor:
                          STATUS_CONFIG[selectedEvent.extendedProps?.statusType]
                            ?.bgColor,
                        color:
                          STATUS_CONFIG[selectedEvent.extendedProps?.statusType]
                            ?.color,
                      }}
                    >
                      {selectedEvent.extendedProps?.statusLabel}
                    </Badge>
                    <Badge
                      className={getStateColor(selectedEvent.extendedProps?.state)}
                    >
                      {getStateLabel(selectedEvent.extendedProps?.state)}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    {selectedEvent.extendedProps?.division}
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    {new Date(selectedEvent.start as string).toLocaleDateString(
                      "ru-RU"
                    )}
                    {selectedEvent.end && (
                      <>
                        {" — "}
                        {new Date(
                          new Date(selectedEvent.end as string).getTime() -
                            86400000
                        ).toLocaleDateString("ru-RU")}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
