"use client";

// Общий хост окна «Проставить статус» (Plane №1223): ОДИН владелец на
// экран — кому ставим, мутация, полуинтервал дат — и тот же `SetStatusDialog`,
// что у борда расхода (`DailyExpenseBoard`). Экраны ответственного и
// дежурного не заводят по своей копии: две копии разошлись бы на первой же
// правке правила дат ([ДОП-20-04]: не копия таблицы — не копия и окна).
import { useState, type ReactNode } from "react";
import { useCreateOpsStatus } from "@/hooks/use-ops-status-write";
import { SetStatusDialog } from "./SetStatusDialog";

export interface StatusPerson {
  id: string;
  name: string;
}

/** Следующий календарный день в ISO — для полуинтервала бэка `[начало, конец)`. */
export function addOneDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function useSetStatusHost(businessDate: string): { pick: (person: StatusPerson) => void; dialog: ReactNode } {
  const [person, setPerson] = useState<StatusPerson | null>(null);
  const createStatus = useCreateOpsStatus();
  const dialog =
    person === null ? null : (
      <SetStatusDialog
        open
        onOpenChange={(next) => {
          if (!next) {
            setPerson(null);
            createStatus.reset();
          }
        }}
        employeeId={person.id}
        employeeName={person.name}
        businessDate={businessDate}
        isSaving={createStatus.isPending}
        failure={createStatus.error?.message ?? null}
        onSubmit={async ({ statusCode, participations }) => {
          await createStatus.mutateAsync({
            employee_id: Number(person.id),
            status_type_code: statusCode,
            date_start: businessDate,
            // Статус на ОДИН день закрывается СЛЕДУЮЩИМ днём: полуинтервал.
            date_end: addOneDay(businessDate),
            participations,
          });
          setPerson(null);
        }}
      />
    );
  return { pick: setPerson, dialog };
}
