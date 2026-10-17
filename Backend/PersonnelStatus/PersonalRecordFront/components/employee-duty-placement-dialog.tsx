"use client";

import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadFailure } from "@/components/load-failure";
import { useEmployeeDutyAssignments } from "@/hooks/use-duty-assignments";
import { formatIsoDate, localIsoDate } from "@/shared/lib/date";

function shiftTime(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

/** Mounted only when a permitted reader opens one employee's assignments. */
export function EmployeeDutyPlacementDialog({ employeeId, employeeName, onClose }: {
  employeeId: number;
  employeeName: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(localIsoDate);
  const dateId = useId();
  const roster = useEmployeeDutyAssignments(employeeId, date);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Назначения в наряд</DialogTitle>
          <DialogDescription>{employeeName}. Назначения и смены на выбранную дату.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={dateId}>Дата наряда</Label>
          <Input id={dateId} type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-44" />
        </div>
        {roster.permissionsLoading ? (
          <p role="status">Проверяем доступ…</p>
        ) : !roster.allowed ? (
          <p role="alert">Просмотр назначений недоступен.</p>
        ) : !date ? (
          <p>Выберите дату наряда.</p>
        ) : roster.isError ? (
          <LoadFailure what="назначения в наряд" onRetry={() => void roster.refetch()} isRetrying={roster.isFetching} />
        ) : roster.isFetching || !roster.data ? (
          <p role="status">Загружаем назначения…</p>
        ) : roster.assignments.length === 0 ? (
          <div className="space-y-2 text-sm">
            <p>На выбранную дату активных назначений нет.</p>
            <p className="text-muted-foreground">Если сотрудник направлен в наряд, назначение могло ещё не быть оформлено. Уточните распределение у дежурного департамента.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {roster.assignments.map((assignment) => (
              <li key={assignment.dispatch_assignment_id ? `dispatch:${assignment.dispatch_assignment_id}` : `status:${assignment.status_id}`} className="space-y-2 rounded-md border p-3 text-sm">
                <p className="font-semibold">{assignment.placement.object_name || "Объект не указан"}</p>
                {assignment.placement.kind === "POST" ? (
                  <div>
                    <p>{assignment.placement.post_name || "Пост не указан"}</p>
                    {assignment.placement.sector_name && <p className="text-muted-foreground">{assignment.placement.sector_name}</p>}
                  </div>
                ) : <p>{assignment.placement.group_name || "Группа не указана"}</p>}
                {assignment.start_at && assignment.end_at ? (
                  <p>{shiftTime(assignment.start_at, assignment.time_zone)} — {shiftTime(assignment.end_at, assignment.time_zone)}{assignment.time_zone && <span className="text-muted-foreground"> ({assignment.time_zone})</span>}</p>
                ) : (
                  <p>{formatIsoDate(assignment.start_date)} — {formatIsoDate(assignment.end_date)}. Время смены не указано.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
