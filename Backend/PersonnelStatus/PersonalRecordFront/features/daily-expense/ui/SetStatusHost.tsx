"use client";

// Общий хост окна «Проставить статус» с экранов свода (Plane №1223 → №1233):
// ОДИН владелец на экран — кому ставим и как освежить расход после сохранения.
//
// Окно — ТО ЖЕ, что «Изменить статус» в модуле «Статусы сотрудников»
// (`EditStatusDialog`, решение заказчика 12.09.2026, `[РАСХ-РШ-11]`): период,
// комментарий, наряд/участие в ОМ, те же правила. До №1233 здесь стояло
// урезанное окно борда (`SetStatusDialog`: одна дата, только код) — заказчик
// назвал его «неполной окошкой». Кадровый статус попадает в расход зеркалом
// на сервере (№1209), поэтому после сохранения освежаются те же ключи, что у
// `useCreateOpsStatus`: сам диалог инвалидирует только кадровые списки.
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EditStatusDialog } from "@/features/employee-status-update/ui/EditStatusDialog";

export interface StatusPerson {
  id: string;
  name: string;
}

export function useSetStatusHost(businessDate: string): { pick: (person: StatusPerson) => void; dialog: ReactNode } {
  const [person, setPerson] = useState<StatusPerson | null>(null);
  const client = useQueryClient();
  const refresh = () => {
    for (const key of ["daily-expense-board", "strength-report", "ops-statuses", "service-summary", "ops-daily", "traffic-light"]) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  };
  const initialStartDate = /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? new Date(`${businessDate}T00:00:00`) : undefined;
  const dialog =
    person === null ? null : (
      <EditStatusDialog
        open
        onOpenChange={(next) => {
          if (!next) setPerson(null);
        }}
        employeeId={person.id}
        employeeName={person.name}
        initialStartDate={initialStartDate}
        onSuccess={() => {
          refresh();
          setPerson(null);
        }}
      />
    );
  return { pick: setPerson, dialog };
}
