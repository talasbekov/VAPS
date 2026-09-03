"use client";

// Локация ОМ структурой (Plane №418, `[МД-02]`): страна → город → адрес.
// Каскад: смена страны сбрасывает город (родитель задаёт список), города
// грузятся по выбранной стране. Нативные <select>, как у остальных полей
// эталона; combobox с поиском — Ш-3 (№419).
import type { ReactNode } from "react";
import { useCities, useCountries } from "@/hooks/use-geo";

export function LocationFields({
  countryId,
  cityId,
  onCountry,
  onCity,
  addressField,
  labelClassName,
  selectClassName,
}: {
  countryId: string;
  cityId: string;
  onCountry: (next: string) => void;
  onCity: (next: string) => void;
  addressField: ReactNode;
  labelClassName: string;
  selectClassName: string;
}) {
  const countries = useCountries();
  const cities = useCities(countryId === "" ? null : countryId);
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor="event-country" className={labelClassName}>
          Страна
        </label>
        <select
          id="event-country"
          className={selectClassName}
          value={countryId}
          onChange={(e) => onCountry(e.target.value)}
          disabled={countries.isPending}
        >
          <option value="">— не указана —</option>
          {(countries.data?.results ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {countries.isError && (
          <p className="text-xs text-destructive-ink" role="alert">
            Справочник стран недоступен — адрес можно указать текстом.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="event-city" className={labelClassName}>
          Город
        </label>
        <select
          id="event-city"
          className={selectClassName}
          value={cityId}
          onChange={(e) => onCity(e.target.value)}
          disabled={countryId === "" || cities.isPending}
        >
          <option value="">
            {countryId === "" ? "— сначала страна —" : "— не указан —"}
          </option>
          {(cities.data?.results ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {addressField}
    </>
  );
}
