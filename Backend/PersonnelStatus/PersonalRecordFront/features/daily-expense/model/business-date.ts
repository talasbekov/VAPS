"use client";

// Единая деловая дата «Ежедневного расхода» (Plane №988). Без выбора
// пользователя — «завтра» СЕРВЕРА (`GET /tomorrow-block/` без параметра),
// а не браузера: экран планирует расход на завтра, и «завтра», посчитанное
// часами машины, в минусовых зонах указало бы не на тот день (та же причина,
// что у `useStrengthReport`). Выбор пользователя (адрес `?businessDate=`)
// имеет приоритет над умолчанием, но подставляется только если прошёл
// формат — чужая/битая ссылка не должна отправлять запросы битой датой.
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function useBusinessDate(selected: string | undefined) {
  const defaultQuery = useQuery({
    queryKey: ["daily-expense-board", "default-business-date"],
    queryFn: () => apiClient.getTomorrowBlockState({}),
    staleTime: 5 * 60_000,
  });

  const isOverridden = selected !== undefined && ISO_DATE.test(selected);
  const businessDate = isOverridden ? (selected as string) : defaultQuery.data?.business_date ?? null;

  // Блокировка показывается ТОЛЬКО для неизменённого умолчания: выбранную
  // руками дату гейт блокировки вообще не смотрит (гейт стоит только на
  // будущем и только на маршрутах записи), а её состояние сервер тут не
  // возвращает — второй запрос ради чужой даты был бы лишним обращением
  // ради предупреждения, которое эта дата не просила.
  const defaultBlocked = !isOverridden && (defaultQuery.data?.blocked ?? false);
  const defaultLaggards = defaultQuery.data?.laggards ?? [];

  return {
    businessDate,
    isResolving: businessDate === null,
    isOverridden,
    defaultDate: defaultQuery.data?.business_date ?? null,
    defaultBlocked,
    defaultLaggards,
  };
}
