"use client";

// Календарь смен: единая сетка по дежурствам и расстановкам ОМ. Право на
// маршрут не подменяет права владельцев источников — каждый источник
// запрашивается только при своём праве, скрытый источник назван вслух.
// Записи НЕ объединяются в карточку сотрудника — каждая от своего источника.
import { useMemo } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useDutyShiftsAll } from "@/hooks/use-duty-shifts";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { ShiftCalendar } from "@/widgets/shift-calendar";

export default function ShiftCalendarPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const canSeeDuties = hasPermission("duty.view");
  const canSeeEvents = hasPermission("event.view");

  const shiftsQuery = useDutyShiftsAll({ enabled: canSeeDuties });
  const eventsQuery = useSecurityEvents(
    {
      search: "",
      stage: "ALL",
      page: 1,
      pageSize: 100,
    },
    { enabled: canSeeEvents }
  );

  const isLoading =
    permissionsLoading ||
    (canSeeDuties && shiftsQuery.isLoading) ||
    (canSeeEvents && eventsQuery.isLoading);
  const isError =
    (canSeeDuties && shiftsQuery.isError) ||
    (canSeeEvents && eventsQuery.isError);

  const shifts = useMemo(
    () => (canSeeDuties ? (shiftsQuery.data?.results ?? []) : []),
    [canSeeDuties, shiftsQuery.data]
  );
  const events = useMemo(
    () => (canSeeEvents ? (eventsQuery.data?.results ?? []) : []),
    [canSeeEvents, eventsQuery.data]
  );

  if (!permissionsLoading && !canSeeDuties && !canSeeEvents) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="p-9 text-center text-sm text-muted-foreground">
            Нет прав на просмотр дежурств или ОМ — календарь пуст.
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Календарь смен</h1>
            <p className="text-muted-foreground">
              Дежурства и расстановки ОМ — по видимым записям
            </p>
          </div>
        </div>

        {(!canSeeDuties || !canSeeEvents) && (
          <p className="text-xs text-muted-foreground">
            {!canSeeDuties
              ? "Дежурства скрыты — нет права duty.view. Показаны только мероприятия."
              : "Мероприятия скрыты — нет права event.view. Показаны только дежурства."}
          </p>
        )}

        {isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка календаря…</p>
        )}
        {isError && (
          <p className="text-sm text-destructive">
            Не удалось загрузить календарь.
          </p>
        )}

        {!isLoading && !isError && (
          <>
            <Card>
              <CardContent className="p-4">
                <ShiftCalendar shifts={shifts} events={events} />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="mb-1 text-sm font-semibold">
                  Не реализовано в этом срезе
                </div>
                <p className="text-xs text-muted-foreground">
                  Объединение записей по сотруднику, «Мой календарь»,
                  представление по подразделению, кадровые статусы
                  (отпуск/больничный/командировка), конфликты и нагрузка —
                  требуют отдельных read model, которых в этом срезе нет.
                  Каждая запись показана как есть, от своего источника.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
