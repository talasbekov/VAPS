"use client";

// Запрос сил глазами УПРАВЛЕНИЯ (Plane №394, `[СБС-30]`): строка своего
// управления в заявке департамента — для баннера на «Статусах сотрудников».
//
// Путь и тип живут здесь, а не в `entities/security-event/model/types.ts`:
// у контракта один читатель — баннер, — и растить общий файл типов ради него
// не нужно. Переедет туда, когда появится второй читатель.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

export interface DirectorateForcesRequest {
  eventId: string;
  code: string;
  title: string;
  businessDate: string;
  allocationId: string;
  departmentName: string;
  status: string;
  dueAt: string | null;
  directorates: {
    divisionId: string;
    name: string;
    need: number;
    assigned: number;
    notifiedAt: string | null;
  }[];
}

export function directorateForcesRequestPath(allocationId: string): string {
  return `/api/ops/security-events/forces/requests/${encodeURIComponent(allocationId)}/directorate/`;
}

export function useDirectorateForcesRequest(allocationId: string | null) {
  return useQuery<DirectorateForcesRequest, OpsApiFailure>({
    queryKey: ["ops-directorate-forces-request", allocationId],
    queryFn: () =>
      opsApiClient.get<DirectorateForcesRequest>(
        directorateForcesRequestPath(allocationId as string)
      ),
    enabled: allocationId !== null,
    // Чужая или снятая заявка — 404, и повторять его нечего.
    retry: false,
  });
}

/** Отчёт выделения по запросу (Plane №395): кого выделили, кому отказано —
 *  поимённо, с причиной сервера. */
export interface SelectForRequestReport {
  selected: string[];
  refused: { employeeId: string; name: string; code: string; message: string }[];
  request: DirectorateForcesRequest;
}

export function directorateSelectPath(allocationId: string): string {
  return `${directorateForcesRequestPath(allocationId)}select/`;
}

/**
 * Выделить отмеченных сотрудников по запросу (Plane №395, `[СБС-31]`).
 * Мероприятие и даты человек не выбирает — их даёт заявка; статус
 * «Участие в ОМ» ставит сервер тем же путём, что и штабное выделение.
 */
export function useSelectForRequest(allocationId: string | null) {
  const client = useQueryClient();
  return useMutation<SelectForRequestReport, OpsApiFailure, { employeeIds: string[] }>({
    mutationFn: (body) =>
      opsApiClient.post<SelectForRequestReport>(directorateSelectPath(allocationId as string), body),
    onSuccess: () => {
      // Баннер и таблица статусов читают разные ручки — обновить обе: иначе
      // «выделено 1 из 2» в баннере спорило бы со статусом в строке ниже.
      void client.invalidateQueries({ queryKey: ["ops-directorate-forces-request", allocationId] });
      void client.invalidateQueries({ queryKey: ["staff-units-by-directorate"] });
      void client.invalidateQueries({ queryKey: ["staff-units-page"] });
    },
  });
}
