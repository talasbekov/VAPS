"use client";

// Объекты посещения мероприятия: добавление и снятие. Ответ обеих операций —
// ЦЕЛОЕ мероприятие в форме контракта: реестру достаточно положить его на
// место, а не собирать список объектов из ответа по кускам.
import { opsApiClient } from "@/lib/ops-api";
import {
  securityEventDeletePath,
  visitObjectDeputiesPath,
  visitObjectDeputyDetailPath,
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

/** День посещения и примечание объекта («Реестр ОМ-35.1»). Оба поля жили
 * свободным текстом патча сводки ГВО — там они были ВТОРЫМ списком объектов и
 * молча расходились с расстановкой. `visitDay: ""` снимает день: объект
 * возвращается в дату мероприятия, и это ответ, а не пробел. */
export function updateVisitObject(variables: {
  eventId: string;
  visitObjectId: string;
  visitDay: string;
  note: string;
}): Promise<SecurityEvent> {
  return opsApiClient.patch<SecurityEvent>(
    visitObjectDetailPath(variables.eventId, variables.visitObjectId),
    { visitDay: variables.visitDay, note: variables.note }
  );
}

// Замещающие на объекте посещения (Plane «Реестр ОМ-24»). Обе операции тоже
// отвечают ЦЕЛЫМ мероприятием: список замещающих приезжает внутри строки
// объекта, и реестру достаточно положить ответ на место.
export function addVisitObjectDeputy(variables: {
  eventId: string;
  visitObjectId: string;
  employeeId: string;
  canEditPlacement: boolean;
}): Promise<SecurityEvent> {
  return opsApiClient.post<SecurityEvent>(
    visitObjectDeputiesPath(variables.eventId, variables.visitObjectId),
    {
      employeeId: variables.employeeId,
      canEditPlacement: variables.canEditPlacement,
    }
  );
}

export function removeVisitObjectDeputy(variables: {
  eventId: string;
  visitObjectId: string;
  deputyId: string;
}): Promise<SecurityEvent> {
  return opsApiClient.del<SecurityEvent>(
    visitObjectDeputyDetailPath(
      variables.eventId,
      variables.visitObjectId,
      variables.deputyId
    )
  );
}

/** Удаление мероприятия целиком (Plane «Реестр ОМ-34»). Ответ 204 без тела:
 * удалённого ОМ больше нет, и отдавать его «в форме контракта» значило бы
 * возвращать призрак — реестр после успеха просто перезапрашивает список. */
export function deleteSecurityEvent(variables: {
  eventId: string;
}): Promise<void> {
  return opsApiClient.del<void>(securityEventDeletePath(variables.eventId));
}
