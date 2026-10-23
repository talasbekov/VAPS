"use client";

// Server roster combines legacy status placements with valid dispatcher shifts.
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useObjectDutyForces } from "@/hooks/use-duty-assignments";
import { dutyIntervalLabel } from "@/features/employee-status-update/model/duty-intervals";

export const NO_DUTY_FORCES_TEXT = "На объекте нет заступивших сотрудников";

function shiftTime(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(value));
}

/** Сегодня в местной зоне: toISOString() отдал бы UTC и в минусовых зонах
 * показывал бы состав вчерашнего дня. */
function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

interface DutyForcesSectionProps {
  objectId: string;
  initialDate?: string;
}

export function DutyForcesSection({ objectId, initialDate }: DutyForcesSectionProps) {
  const [date, setDate] = useState(() => initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) && !Number.isNaN(Date.parse(initialDate)) ? initialDate : today());
  const roster = useObjectDutyForces(objectId, date);
  const { departments } = roster;

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Дежурные силы</h2>
            <p className="text-xs text-muted-foreground">
              Назначения на выбранную дату, включая смены дежурного департамента.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="duty-forces-date" className="text-xs">
              Дата
            </Label>
            <Input
              id="duty-forces-date"
              type="date"
              className="h-8 w-40 text-xs"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>

        {roster.permissionsLoading ? (
          <p role="status" className="text-xs text-muted-foreground">Проверка доступа…</p>
        ) : !roster.allowed ? (
          <p className="text-xs text-muted-foreground">Для просмотра состава нужен доступ к статусам сотрудников.</p>
        ) : !date ? (
          <p className="text-xs text-muted-foreground">Укажите дату состава.</p>
        ) : roster.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>Не удалось загрузить дежурные силы.</p>
            <Button type="button" variant="outline" size="sm" disabled={roster.isFetching} onClick={() => void roster.refetch()}>
              Повторить загрузку состава
            </Button>
          </div>
        ) : roster.isLoading ? (
          <p role="status" className="text-xs text-muted-foreground">Загрузка дежурных сил…</p>
        ) : departments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{NO_DUTY_FORCES_TEXT}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {departments.map((department) => (
              <li key={department.departmentName}>
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {department.departmentName}
                </div>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {department.placements.map((placement) => (
                    <li
                      key={placement.key}
                      className="rounded-md border p-2.5"
                    >
                      <div className="text-xs font-semibold">
                        {placement.label}
                      </div>
                      <ul className="mt-1 flex flex-col gap-1">
                        {placement.assignments.map((assignment) => (
                          <li
                            key={assignment.employeeKey}
                            className="text-xs text-muted-foreground"
                          >
                            <span className="font-medium text-foreground">
                              {assignment.employeeName}
                            </span>
                            {assignment.rankName !== ""
                              ? ` · ${assignment.rankName}`
                              : ""}
                            {assignment.positionName !== ""
                              ? ` · ${assignment.positionName}`
                              : ""}
                            {assignment.intervals !== undefined ? (
                              assignment.intervals.length > 0 ? <ul className="mt-1 space-y-1" aria-label="Выходы, время Астаны">{assignment.intervals.map((interval, index) =>
                                <li key={`${interval.start_at}:${interval.end_at}:${index}`}>{dutyIntervalLabel(interval)} · время Астаны</li>)}</ul>
                                : <span> · Выходов на выбранную дату нет</span>
                            ) : assignment.shiftStart && assignment.shiftEnd
                              ? ` · ${shiftTime(assignment.shiftStart, assignment.timeZone)} — ${shiftTime(assignment.shiftEnd, assignment.timeZone)}`
                              : ` · с ${assignment.startDate} по ${assignment.endDate}. Время выходов не указано; круглосуточное нахождение не подтверждено.`}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
