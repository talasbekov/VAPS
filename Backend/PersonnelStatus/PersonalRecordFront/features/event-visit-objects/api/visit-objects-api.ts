"use client";

// Объекты посещения мероприятия: добавление и снятие. Ответ обеих операций —
// ЦЕЛОЕ мероприятие в форме контракта: реестру достаточно положить его на
// место, а не собирать список объектов из ответа по кускам.
import { opsApiClient } from "@/lib/ops-api";
import {
  visitObjectDetailPath,
  visitObjectsPath,
  type SecurityEvent,
} from "@/entities/security-event";

export function addVisitObject(variables: {
  eventId: string;
  objectId: string;
}): Promise<SecurityEvent> {
  return opsApiClient.post<SecurityEvent>(visitObjectsPath(variables.eventId), {
    objectId: variables.objectId,
  });
}

export function removeVisitObject(variables: {
  eventId: string;
  visitObjectId: string;
}): Promise<SecurityEvent> {
  return opsApiClient.del<SecurityEvent>(
    visitObjectDetailPath(variables.eventId, variables.visitObjectId)
  );
}
