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

/** Список запросов, адресованных управлениям актора (Plane №487).
 *
 * 🔴 Имя пути РАЗВЕДЕНО с `forces/requests/…`: `forces/requests/directorate/`
 * попадает в маршрут ОДНОЙ заявки (`allocation_id = "directorate"`) и
 * отвечает 403 чужим правом департамента. Поймано прогоном пробы. */
export const DIRECTORATE_FORCES_REQUESTS_KEY = ["ops-directorate-forces-requests"] as const;

export function directorateForcesRequestsPath(): string {
  return "/api/ops/security-events/forces/directorate-requests/";
}

/**
 * Что просят У МОЕГО управления — без ссылки из уведомления (Plane №487).
 *
 * Заказчик: «с модуля не ставятся статус Участие на ОМ». Ручной статус
 * запрещён (№427), а единственный путь к чекбоксам лежал через параметр
 * адреса `?forcesRequest=…`, который кладёт только уведомление. Открывший
 * раздел из меню не мог поставить статус ничем.
 */
export function useDirectorateForcesRequests(options: { enabled?: boolean } = {}) {
  return useQuery<{ results: DirectorateForcesRequest[] }, OpsApiFailure>({
    queryKey: DIRECTORATE_FORCES_REQUESTS_KEY,
    queryFn: () =>
      opsApiClient.get<{ results: DirectorateForcesRequest[] }>(
        directorateForcesRequestsPath()
      ),
    enabled: options.enabled ?? true,
    // Нет права `status.manage` — 403; повторять его нечего, а баннера у
    // такого человека и быть не должно.
    retry: false,
  });
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
export interface SelectForRequestRefusal {
  employeeId: string;
  name: string;
  code: string;
  message: string;
  /**
   * Обходится ли отказ обоснованием (Plane №545).
   *
   * Признак приходит С САМОГО ОТКАЗА, а не выводится из кода на клиенте:
   * жёсткий конфликт не обходится никогда, и предложить обход по нему значило
   * бы дать кнопку, после которой сервер откажет второй раз тем же текстом.
   */
  overridable: boolean;
}

export interface SelectForRequestReport {
  selected: string[];
  refused: SelectForRequestRefusal[];
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
  return useMutation<
    SelectForRequestReport,
    OpsApiFailure,
    { employeeIds: string[]; override?: boolean; override_reason?: string }
  >({
    mutationFn: (body) =>
      opsApiClient.post<SelectForRequestReport>(directorateSelectPath(allocationId as string), body),
    onSuccess: () => {
      // Баннер и таблица статусов читают разные ручки — обновить обе: иначе
      // «выделено 1 из 2» в баннере спорило бы со статусом в строке ниже.
      void client.invalidateQueries({ queryKey: ["ops-directorate-forces-request", allocationId] });
      // Список тоже: он несёт «выделено X из Y» по каждому запросу, и без
      // сброса чипы выбора спорили бы с цифрой в самом баннере (Plane №487).
      void client.invalidateQueries({ queryKey: DIRECTORATE_FORCES_REQUESTS_KEY });
      void client.invalidateQueries({ queryKey: ["staff-units-by-directorate"] });
      void client.invalidateQueries({ queryKey: ["staff-units-page"] });
    },
  });
}
