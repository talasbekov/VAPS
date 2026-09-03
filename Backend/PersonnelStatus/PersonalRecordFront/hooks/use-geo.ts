"use client";

// Справочник «страна → город» (Plane №417). Страны — один запрос надолго;
// города — по выбранной стране, запрос уходит только когда страна названа.
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { COUNTRIES_PATH, countryCitiesPath } from "@/entities/geo";
import type { ListCitiesResponse, ListCountriesResponse } from "@/entities/geo";

export function useCountries() {
  return useQuery<ListCountriesResponse, OpsApiFailure>({
    queryKey: ["ops-countries"],
    queryFn: () => opsApiClient.get<ListCountriesResponse>(COUNTRIES_PATH),
    staleTime: 10 * 60_000,
  });
}

export function useCities(countryId: string | null) {
  return useQuery<ListCitiesResponse, OpsApiFailure>({
    queryKey: ["ops-cities", countryId],
    queryFn: () =>
      opsApiClient.get<ListCitiesResponse>(countryCitiesPath(countryId as string)),
    enabled: countryId !== null && countryId !== "",
    staleTime: 10 * 60_000,
  });
}
