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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  securityEventDepartmentRequestPath,
  securityEventDepartmentRequestsPath,
  securityEventForcesDirectorateSplitPath,
  securityEventForcesNotifyPath,
  securityEventForcesSubmitPath,
  type DepartmentRequestDetail,
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

/** Одна заявка целиком: управления с квотами и выделенные люди (Ш-4).
 *
 * Своя ручка, а не карточка мероприятия: карточка отдаёт раскладку по ВСЕМ
 * департаментам, и ответственному за свой приезжали бы чужие строки — вопрос
 * не в том, покажет ли их экран, а в том, что они уже в браузере. */
export function useDepartmentRequest(
  allocationId: string | null,
  options: { enabled?: boolean } = {}
) {
  return useQuery<DepartmentRequestDetail, OpsApiFailure>({
    queryKey: ["ops-department-request", allocationId],
    queryFn: () =>
      opsApiClient.get<DepartmentRequestDetail>(
        securityEventDepartmentRequestPath(allocationId as string)
      ),
    enabled: (options.enabled ?? true) && allocationId !== null,
  });
}

/** Раскладка квоты департамента по управлениям (Plane №272, Ш-1). */
export function useSplitDirectorateQuotas(eventId: string, allocationId: string) {
  const client = useQueryClient();
  return useMutation<
    unknown,
    OpsApiFailure,
    { rows: { divisionId: string; need: number }[] }
  >({
    mutationFn: (body) =>
      opsApiClient.post(
        securityEventForcesDirectorateSplitPath(eventId, allocationId),
        body
      ),
    onSuccess: () => {
      // Обе выдачи описывают одно и то же: список заявок несёт итог, карточка
      // — строки. Обновить одну и забыть вторую значит показать человеку два
      // разных ответа на один вопрос на соседних экранах.
      void client.invalidateQueries({ queryKey: DEPARTMENT_REQUESTS_KEY });
      void client.invalidateQueries({ queryKey: ["ops-department-request", allocationId] });
    },
  });
}

/**
 * Оповестить управления департамента о заявке (Plane №389, `[СБС-01]`/
 * `[СБС-22]`).
 *
 * 🔴 РУЧКА УЖЕ БЫЛА, ПРОВОДА НЕ БЫЛО. `POST …/forces/allocation/<id>/notify/`
 * существует с плана №74 (Ш-4) и гейтится ТОЛЬКО `forces.allocate` со
 * скопом департамента строки — `event.view` ему не нужен вовсе (аудит
 * Plane №384 прочитал код неверно: решил, что оповещение обязано идти со
 * страницы мероприятия, а сервер туда `event.view` не требовал никогда).
 * Кнопки на этой карточке не было — вызывать ручку без `event.view` было
 * неоткуда. `useNotifyDirectorates` в `hooks/use-security-event-stages.ts`
 * не годится: он инвалидирует кэш ПОЛНОГО мероприятия, которого у этой
 * персоны нет и не будет, и молчит про `ops-department-request`.
 */
export function useNotifyDepartmentDirectorates(eventId: string, allocationId: string) {
  const client = useQueryClient();
  return useMutation<unknown, OpsApiFailure, Record<string, never>>({
    mutationFn: () => opsApiClient.post(securityEventForcesNotifyPath(eventId, allocationId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: DEPARTMENT_REQUESTS_KEY });
      void client.invalidateQueries({ queryKey: ["ops-department-request", allocationId] });
    },
  });
}

/**
 * Отправить собранный список штабу (Plane №389, `[СБС-23]`).
 *
 * Тот же довод, что у оповещения: ручка `.../submit/` существует с плана
 * №74, гейтится `forces.allocate` со скопом департамента, `event.view` не
 * требует. Подтверждение — на самом экране (диалог `AlertDialog`), а не
 * здесь: хук не знает, полон список или нет, это знает карточка.
 */
export function useSubmitDepartmentAllocation(eventId: string, allocationId: string) {
  const client = useQueryClient();
  return useMutation<unknown, OpsApiFailure, Record<string, never>>({
    mutationFn: () => opsApiClient.post(securityEventForcesSubmitPath(eventId, allocationId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: DEPARTMENT_REQUESTS_KEY });
      void client.invalidateQueries({ queryKey: ["ops-department-request", allocationId] });
    },
  });
}
