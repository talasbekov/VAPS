// Публичный API виджета status-calendar.
//
// Виджет открывают на вкладке, которую смотрят не всегда, поэтому вид грузится
// динамически: статический импорт клал бы его в бандл каждой страницы, где
// виджет упомянут.
//
// Прежний вид на FullCalendar (`StatusCalendar`) снят в Ш-6 задачи Plane №270
// после переезда обоих видов эталона. Он раскладывал по дням ТЕКУЩИЕ статусы
// кадрового словаря, то есть отвечал не на тот вопрос: истории у его ручки не
// было вовсе, а участия в ОМ нет в кадровых кодах. Сами пакеты FullCalendar
// остаются в зависимостях — на них стоит `widgets/shift-calendar`.
"use client";

import dynamic from "next/dynamic";

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
