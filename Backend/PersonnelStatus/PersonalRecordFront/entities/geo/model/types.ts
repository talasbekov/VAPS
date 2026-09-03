// Справочник «страна → город» (Plane №417, `[МД-09]`). Читается с живого
// бэка `/api/ops/countries/`; правка — Django Admin, как у остальных
// справочников раздела. Город запрашивается по стране: список городов всех
// стран разом нужен никому, а форме ОМ (Ш-3) — каскад.
export interface Country {
  id: string;
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
}

export interface City {
  id: string;
  countryId: string;
  name: string;
}

export const COUNTRIES_PATH = "/api/ops/countries/";

export function countryCitiesPath(countryId: string): string {
  return `${COUNTRIES_PATH}${countryId}/cities/`;
}

export interface ListCountriesResponse {
  results: Country[];
}

export interface ListCitiesResponse {
  results: City[];
}
