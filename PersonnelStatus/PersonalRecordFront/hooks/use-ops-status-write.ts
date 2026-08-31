"use client";

// Простановка статуса расхода (модель раздела ОМ) — Plane №274, Ш-4.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { StatusParticipation } from "@/entities/daily-grid";

export interface CreateOpsStatusRequest extends Record<string, unknown> {
  employee_id: number;
  status_type_code: string;
  date_start: string;
  date_end: string;
  participations?: StatusParticipation[];
}

/**
 * Пишет в МОДЕЛЬ РАСХОДА (`/api/operations/statuses/`), а не в кадровые
 * статусы: расход и сводки департамента считаются по ней, и статус,
 * записанный в кадровую модель, до ответственного бы не доехал (Plane №274).
 *
 * Одиночная ручка, а не массовая: только она принимает участие в мероприятиях
 * — массовый путь строит строки сам и про участие не знает.
 */
export function useCreateOpsStatus() {
  const client = useQueryClient();
  return useMutation<unknown, Error, CreateOpsStatusRequest>({
    mutationFn: (body) => opsApiClient.post("/api/operations/statuses/", body),
    onSuccess: () => {
      // Доска расхода держит СВОИ ключи (список людей, статусы дня, сводка
      // подразделений) — освежаем всю их семью одним префиксом, иначе строка
      // остаётся со старым статусом до перезагрузки страницы.
      void client.invalidateQueries({ queryKey: ["daily-expense-board"] });
      void client.invalidateQueries({ queryKey: ["strength-report"] });
      // 🔴 И СПИСКИ СТАТУСОВ РАЗДЕЛА (Plane №368, Ш-3 задачи №365). Их читают
      // портальные экраны: колонка «По разделу ОМ» в таблице статусов
      // (`["ops-statuses", "on", <дата>]`) и карточка статусов сотрудника
      // (`["ops-statuses", "employee", <id>]`). Пока ключ не сбрасывался,
      // человек, поставивший привлечение из портального окна, не видел его
      // НИГДЕ до перезагрузки страницы — то есть Ш-2 заводил статус, а
      // показать его было нечему. Префикс общий, поэтому оба ключа гасятся
      // одной строкой.
      void client.invalidateQueries({ queryKey: ["ops-statuses"] });
    },
  });
}
