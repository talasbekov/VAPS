"use client";

// Календарь статусов: месячная сетка и панель занятости выбранного дня
// (с Ш-5 рядом встанет матрица «сотрудник × день»). Plane №270.
//
// Выбранный день живёт ЗДЕСЬ, а не внутри сетки: его читает и сетка (подсветка
// выбора), и панель — два состояния одного выбора разошлись бы на первом же
// клике.
import { useState } from "react";
import { StatusDayPanel } from "./StatusDayPanel";
import { StatusMonthGrid, isoDate } from "./StatusMonthGrid";

export function StatusCalendarBoard() {
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    isoDate(new Date())
  );

  return (
    // Панель шириной в колонку рядом с сеткой на широком экране и под ней на
    // узком: на телефоне колонка в 320px оставила бы сетке 40 пикселей.
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <StatusMonthGrid
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />
      <StatusDayPanel date={selectedDate} />
    </div>
  );
}
