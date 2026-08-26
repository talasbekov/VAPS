"use client";

// Создание ОМ + список объектов, к которым его можно привязать.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  BINDABLE_OBJECTS_PATH,
  SECURITY_EVENTS_PATH,
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
