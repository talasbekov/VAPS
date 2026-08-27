"use client";

// Реестр транспорта ГОН. Отбор считает СЕРВЕР (Plane №215): парк — сотни
// строк, и отбор по классу брони на клиенте гонял бы их все ради десяти.
// Поэтому параметры входят в ключ запроса, а не фильтруют уже полученное.
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  VEHICLE_ARMOR_CLASSES_PATH,
  vehiclesQuery,
} from "@/entities/vehicle";
import type {
  ListArmorClassesResponse,
  ListVehiclesResponse,
  VehicleFilters,
} from "@/entities/vehicle";

export function useVehicles(
  filters: VehicleFilters,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ListVehiclesResponse, OpsApiFailure>({
    queryKey: ["ops-vehicles", filters],
    queryFn: () => opsApiClient.get<ListVehiclesResponse>(vehiclesQuery(filters)),
    enabled: options.enabled ?? true,
  });
}

export function useVehicleArmorClasses(options: { enabled?: boolean } = {}) {
  return useQuery<ListArmorClassesResponse, OpsApiFailure>({
    queryKey: ["ops-vehicle-armor-classes"],
    queryFn: () =>
      opsApiClient.get<ListArmorClassesResponse>(VEHICLE_ARMOR_CLASSES_PATH),
    enabled: options.enabled ?? true,
  });
}
