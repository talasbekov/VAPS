"use client";

// Локация ОМ структурой (Plane №418, `[МД-02]`): страна → город → адрес.
// Каскад: смена страны сбрасывает город (родитель задаёт список), города
// грузятся по выбранной стране. Нативные <select>, как у остальных полей
// эталона; combobox с поиском — Ш-3 (№419).
//
// 🔴 ВЫБРАННОЕ ЗНАЧЕНИЕ ПОКАЗЫВАЕТСЯ, ДАЖЕ ЕСЛИ ЕГО СКРЫЛИ ИЗ СПРАВОЧНИКА
// (Plane №617). Ручки отдают только активные строки, поэтому у мероприятия в
// скрытом городе `value` селекта не совпадал ни с одним `<option>` — браузер
// рисует такое поле ПУСТЫМ. Человек открывал правку бюллетеня и видел «— не
// указан —» там, где город есть; поверив глазам и тронув страну, он терял его
// по-настоящему (смена страны сбрасывает город). Скрытая строка дописывается
// отдельным `<option>` и НАЗВАНА скрытой: выбрать её заново нельзя нигде, но
// сохранённая она обязана быть видимой.
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
  currentCountryName = "",
  currentCityName = "",
}: {
  countryId: string;
  cityId: string;
  onCountry: (next: string) => void;
  onCity: (next: string) => void;
  addressField: ReactNode;
  labelClassName: string;
  selectClassName: string;
  /** Подписи УЖЕ СОХРАНЁННЫХ страны и города — на случай, если их скрыли из
   *  справочника и в списке вариантов их больше нет (Plane №617). У формы
   *  заведения нового ОМ их не бывает, поэтому по умолчанию пусто. */
  currentCountryName?: string;
  currentCityName?: string;
}) {
  const countries = useCountries();
  const cities = useCities(countryId === "" ? null : countryId);
  const countryRows = countries.data?.results ?? [];
  const cityRows = cities.data?.results ?? [];
  // Дописывается ТОЛЬКО когда справочник уже ответил: пока он грузится,
  // отсутствие строки означает «ещё не знаем», а не «скрыта», и подпись
  // «скрыта в справочнике» была бы враньём на полсекунды каждой загрузки.
  const hiddenCountry =
    countryId !== "" &&
    countries.isSuccess &&
    !countryRows.some((c) => c.id === countryId);
  const hiddenCity =
    cityId !== "" && cities.isSuccess && !cityRows.some((c) => c.id === cityId);
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
          {hiddenCountry && (
            <option value={countryId}>
              {currentCountryName || "Выбранная страна"} (скрыта в справочнике)
            </option>
          )}
          {countryRows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {/* 🔴 ТО ЖЕ, ЧТО У ЛИЦ (Plane №632): текст написан, когда география
            была необязательной. С `[БЛН-12]` страна и город обязательны, и при
            отказе справочника создать бюллетень нельзя вовсе — «указать адрес
            текстом» не спасает. В ПРАВКЕ бюллетеня отказ не запирает ничего:
            там координаты уже сохранены, и правка проходит (Plane №617). */}
        {countries.isError && (
          <p className="text-xs text-destructive-ink" role="alert">
            Справочник стран недоступен, а без страны и города бюллетень не
            завести.{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => void countries.refetch()}
              disabled={countries.isFetching}
            >
              {countries.isFetching ? "Повторяем…" : "Повторить"}
            </button>
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
          {hiddenCity && (
            <option value={cityId}>
              {currentCityName || "Выбранный город"} (скрыт в справочнике)
            </option>
          )}
          {cityRows.map((c) => (
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
