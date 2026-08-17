// Публичный API виджета status-calendar.
//
// Календарь тянет четыре пакета FullCalendar. Он живёт на ВКЛАДКЕ, которую
// открывают не всегда, — статический импорт клал эти пакеты в бандл каждой
// страницы, где виджет упомянут. next/dynamic грузит их при первом показе.
"use client";

import dynamic from "next/dynamic";

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
