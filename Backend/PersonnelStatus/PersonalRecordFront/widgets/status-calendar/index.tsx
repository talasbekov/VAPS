// Публичный API виджета status-calendar.
//
// Календарь тянет четыре пакета FullCalendar. Он живёт на ВКЛАДКЕ, которую
// открывают не всегда, — статический импорт клал эти пакеты в бандл каждой
// страницы, где виджет упомянут. next/dynamic грузит их при первом показе.
"use client";

import dynamic from "next/dynamic";

/**
 * Новый календарь (Plane №270): месячная сетка на ручках раздела ОМ.
 * Своих тяжёлых пакетов не тянет, но остаётся динамическим по той же
 * причине — вкладку открывают не всегда.
 */
export const StatusCalendarBoard = dynamic(
  () => import("./ui/StatusCalendarBoard").then((m) => m.StatusCalendarBoard),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] items-center justify-center text-sm text-muted-foreground">
        Загрузка календаря…
      </div>
    ),
  }
);

/** Прежний вид на FullCalendar — снимается в Ш-6 после переезда обоих видов. */
export const StatusCalendar = dynamic(
  () => import("./ui/StatusCalendar").then((m) => m.StatusCalendar),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] items-center justify-center text-sm text-muted-foreground">
        Загрузка календаря…
      </div>
    ),
  }
);
