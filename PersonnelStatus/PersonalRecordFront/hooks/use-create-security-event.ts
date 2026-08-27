"use client";

// Создание ОМ + список объектов, к которым его можно привязать.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  BINDABLE_OBJECTS_PATH,
  SECURITY_EVENTS_PATH,
  eventDetailsPath,
  type CreateSecurityEventRequest,
  type ListBindableObjectsResponse,
  type SecurityEvent,
} from "@/entities/security-event";
import { invalidateSecurityEvents } from "@/lib/ops-invalidate";

export function useBindableObjects() {
  return useQuery<ListBindableObjectsResponse, OpsApiFailure>({
    queryKey: ["ops-security-events", "bindable-objects"],
    queryFn: () =>
      opsApiClient.get<ListBindableObjectsResponse>(BINDABLE_OBJECTS_PATH),
  });
}

export function useCreateSecurityEvent(options?: {
  onFormError?: (details: Record<string, unknown>) => void;
}) {
  const queryClient = useQueryClient();
  return useOpsMutation<SecurityEvent, CreateSecurityEventRequest>({
    mutationFn: (body) =>
      opsApiClient.post<SecurityEvent>(SECURITY_EVENTS_PATH, body),
    onSuccess: (data) => {
      queryClient.setQueryData(["ops-security-events", "detail", data.id], data);
      invalidateSecurityEvents(queryClient);
    },
    onFormError: options?.onFormError,
  });
}

/** Правка сведений бюллетеня (Plane №192).
 *
 * Ручка ЧАСТИЧНАЯ: сервер понимает «ключа нет» как «не трогай поле», а пустую
 * строку — как «очисти». Поэтому окно правки шлёт ВСЕ поля формы, включая
 * пустые: человек, стерший локацию, ждёт, что она сотрётся, а не что правку
 * молча пропустят.
 */
export function useUpdateBulletinDetails(
  eventId: string,
  options?: { onFormError?: (details: Record<string, unknown>) => void }
) {
  const queryClient = useQueryClient();
  return useOpsMutation<SecurityEvent, UpdateBulletinDetailsRequest>({
    mutationFn: (body) =>
      opsApiClient.patch<SecurityEvent>(eventDetailsPath(eventId), body),
    onSuccess: (data) => {
      queryClient.setQueryData(["ops-security-events", "detail", data.id], data);
      invalidateSecurityEvents(queryClient);
    },
    onFormError: options?.onFormError,
  });
}

export interface UpdateBulletinDetailsRequest extends Record<string, unknown> {
  title: string;
  businessDate: string;
  businessDateEnd: string;
  eventTime: string;
  protectedPersonId: string;
  location: string;
}
