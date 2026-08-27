"use client";

// Выделение машины реестра ГОН на мероприятие и снятие её (Plane №215).
// Ответ обеих операций — ЦЕЛОЕ мероприятие в форме контракта: карточке
// достаточно положить его на место, а не собирать список машин по кускам.
import { opsApiClient } from "@/lib/ops-api";
import {
  eventVehicleDetailPath,
  eventVehiclesPath,
  type SecurityEvent,
} from "@/entities/security-event";

export function allocateVehicle(variables: {
  eventId: string;
  vehicleId: string;
  callsign: string;
  purpose: string;
}): Promise<SecurityEvent> {
  return opsApiClient.post<SecurityEvent>(eventVehiclesPath(variables.eventId), {
    vehicleId: variables.vehicleId,
    callsign: variables.callsign,
    purpose: variables.purpose,
  });
}

export function releaseVehicle(variables: {
  eventId: string;
  allocationId: string;
}): Promise<SecurityEvent> {
  return opsApiClient.del<SecurityEvent>(
    eventVehicleDetailPath(variables.eventId, variables.allocationId)
  );
}
