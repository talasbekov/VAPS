// MSW-handlers справочника «страна → город» (Plane №417). Домен живой по
// умолчанию вместе с остальными справочниками (`dictionaries`); мок — для
// демо без бэка. Набор повторяет сид миграции 0078 в сокращении.
import { http, HttpResponse } from "msw";
import { COUNTRIES_PATH } from "@/entities/geo";
import type { City, Country } from "@/entities/geo";

export const COUNTRIES: Country[] = [
  { id: "1", code: "KZ", name: "Казахстан" },
  { id: "2", code: "RU", name: "Россия" },
  { id: "3", code: "TR", name: "Турция" },
];

export const CITIES: City[] = [
  { id: "1", countryId: "1", name: "Астана" },
  { id: "2", countryId: "1", name: "Алматы" },
  { id: "3", countryId: "1", name: "Шымкент" },
  { id: "4", countryId: "2", name: "Москва" },
  { id: "5", countryId: "3", name: "Анкара" },
  { id: "6", countryId: "3", name: "Стамбул" },
];

export const geoHandlers = [
  http.get(`*${COUNTRIES_PATH}`, () => HttpResponse.json({ results: COUNTRIES })),
  http.get(`*${COUNTRIES_PATH}:id/cities/`, ({ params }) => {
    const id = String(params.id);
    if (!COUNTRIES.some((c) => c.id === id)) {
      return HttpResponse.json(
        { error_code: "ENTITY_NOT_FOUND", message: "Страна не найдена." },
        { status: 404 }
      );
    }
    return HttpResponse.json({
      results: CITIES.filter((c) => c.countryId === id),
    });
  }),
];
