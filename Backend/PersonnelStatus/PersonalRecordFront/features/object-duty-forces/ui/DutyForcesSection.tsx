"use client";

// «Дежурные силы» — кто заступил на этот объект. Источник ровно один: статусы
// «На дежурстве», оформленные в модалке «Статусы сотрудника». Собственного
// списка заступивших у карточки нет намеренно — второй список расходился бы
// со статусами молча, и объект показывал бы людей, ушедших в отпуск.
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useObjectDutyForces } from "@/hooks/use-duty-assignments";

export const NO_DUTY_FORCES_TEXT = "На объекте нет заступивших сотрудников";

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
}

export function DutyForcesSection({ objectId }: DutyForcesSectionProps) {
  const [date, setDate] = useState(today);
  const departments = useObjectDutyForces(objectId, date);

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Дежурные силы</h2>
            <p className="text-xs text-muted-foreground">
              Состав на выбранную дату по статусам «На дежурстве».
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

        {departments.length === 0 ? (
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
                            {" · с "}
                            {assignment.startDate} по {assignment.endDate}
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
