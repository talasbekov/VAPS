// Публичный API виджета shift-calendar.
//
// Те же четыре пакета FullCalendar, что и у status-calendar: грузим их при
// первом показе календаря, а не в бандле страницы.
"use client";

import dynamic from "next/dynamic";

export const ShiftCalendar = dynamic(
  () => import("./ui/ShiftCalendar").then((m) => m.ShiftCalendar),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] items-center justify-center text-sm text-muted-foreground">
        Загрузка календаря…
      </div>
    ),
  }
);
