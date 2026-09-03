"use client";

// Назначения сотрудника в ОМ — своей ручкой, а не реестром (Plane №403,
// `[ОЗН-09]`). Реестр `/security-events/` открыт только держателю
// `event.view`, и рядовому сотруднику профиль отвечал «реестр недоступен —
// назначения не показаны». Здесь человек читает СВОИ строки по кадровой
// привязке; начальник — подчинённого (`?employee=<id>`) по области
// `status.manage`.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  SECURITY_EVENTS_PATH,
  securityEventAcknowledgePath,
} from "@/entities/security-event";
import type { SecurityEvent, SecurityEventStage } from "@/entities/security-event";

export const MY_ASSIGNMENTS_PATH = "/api/ops/security-events/my-assignments/";

/** Строка расстановки с мероприятием и постом в одной плоскости. */
export interface MyAssignmentRow {
  assignmentId: string;
  eventId: string;
  eventCode: string;
  eventTitle: string;
  eventStage: SecurityEventStage;
  businessDate: string;
  businessDateEnd: string | null;
  objectName: string;
  visitObjectId: string | null;
  visitObjectName: string | null;
  postId: string;
  /** Пост могли снять с расчёта после назначения — строка остаётся. */
  postFound: boolean;
  sector: string;
  post: string;
  task: string;
  requirements: string;
  uniform: string;
  weapon: string;
  roleCode: string | null;
  sectionCode: string | null;
  acknowledgedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
}

export interface MyAssignmentsResponse {
  results: MyAssignmentRow[];
  employeeId: string | null;
  /** Учётка без кадровой записи — не ошибка, а причина словами сервера. */
  unlinkedReason: string | null;
}

export const MY_ASSIGNMENTS_QUERY_KEY = ["ops-my-assignments"] as const;

export function useMyAssignments(employeeId?: string) {
  const path =
    employeeId === undefined
      ? MY_ASSIGNMENTS_PATH
      : `${MY_ASSIGNMENTS_PATH}?employee=${encodeURIComponent(employeeId)}`;
  return useQuery<MyAssignmentsResponse, OpsApiFailure>({
    queryKey: [...MY_ASSIGNMENTS_QUERY_KEY, employeeId ?? "me"],
    queryFn: () => opsApiClient.get<MyAssignmentsResponse>(path),
  });
}

// ── Ответ на назначение (Plane №405, `[ПРФ-04]`) ─────────────────────────
//
// Обе ручки живут на мероприятии (`acknowledge/<id>/`, `decline/<id>/`), а
// не на «моих назначениях»: подтверждение читает и этап «Ознакомление» в
// карточке ОМ. После ответа перечитываются и свои строки, и карточка ОМ.

export function useAcknowledgeMyAssignment() {
  const queryClient = useQueryClient();
  return useOpsMutation<SecurityEvent, { eventId: string; assignmentId: string }>({
    mutationFn: ({ eventId, assignmentId }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventAcknowledgePath(eventId, assignmentId)
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_ASSIGNMENTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
  });
}

export function securityEventDeclinePath(eventId: string, assignmentId: string) {
  return `${SECURITY_EVENTS_PATH}${eventId}/decline/${assignmentId}/`;
}

export function useDeclineMyAssignment() {
  const queryClient = useQueryClient();
  return useOpsMutation<
    SecurityEvent,
    { eventId: string; assignmentId: string; reason: string }
  >({
    mutationFn: ({ eventId, assignmentId, reason }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventDeclinePath(eventId, assignmentId),
        { reason }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_ASSIGNMENTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
  });
}
