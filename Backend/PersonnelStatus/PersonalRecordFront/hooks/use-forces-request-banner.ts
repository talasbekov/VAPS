"use client";

// Запрос сил глазами УПРАВЛЕНИЯ (Plane №394, `[СБС-30]`): строка своего
// управления в заявке департамента — для баннера на «Статусах сотрудников».
//
// Путь и тип живут здесь, а не в `entities/security-event/model/types.ts`:
// у контракта один читатель — баннер, — и растить общий файл типов ради него
// не нужно. Переедет туда, когда появится второй читатель.
import { useQuery } from "@tanstack/react-query";

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
