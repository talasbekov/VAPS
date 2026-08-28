"use client";

// Заявки, адресованные департаменту актора (Plane №272, Ш-3).
//
// Обратный разрез цепочки «Сбор сил на ОМ»: штаб смотрит «кому я раздал»,
// департамент — «что просят у МЕНЯ». Разрезы разные не по оформлению, а по
// вопросу, и потому у департамента свой запрос, а не отфильтрованный реестр
// мероприятий: реестр отдаёт ОМ целиком (сведение людей и счёт по управлениям
// на каждое), и таблица из пяти колонок платила бы за это на каждой строке.
//
// Область сужает СЕРВЕР: чужие строки не приезжают вовсе. Считать «мой ли это
// департамент» на клиенте значило бы завести вторую правду об авторизации —
// она разошлась бы с сервером при первой же правке дерева подразделений.
import { useQuery } from "@tanstack/react-query";

import {
  securityEventDepartmentRequestsPath,
  type DepartmentRequestRow,
} from "@/entities/security-event";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

export const DEPARTMENT_REQUESTS_KEY = ["ops-department-requests"] as const;

export function useDepartmentRequests(options: { enabled?: boolean } = {}) {
  return useQuery<{ results: DepartmentRequestRow[] }, OpsApiFailure>({
    queryKey: DEPARTMENT_REQUESTS_KEY,
    queryFn: () =>
      opsApiClient.get<{ results: DepartmentRequestRow[] }>(
        securityEventDepartmentRequestsPath()
      ),
    enabled: options.enabled ?? true,
  });
}
