"use client";

// Календарь статусов: месячная сетка и (с Ш-5) матрица «сотрудник × день».
// Plane №270.
//
// Выбранный день живёт ЗДЕСЬ, а не внутри сетки: его читает панель занятости
// (Ш-4), и два состояния одного выбора разошлись бы на первом же клике.
import { useState } from "react";
import { StatusMonthGrid, isoDate } from "./StatusMonthGrid";

export function StatusCalendarBoard() {
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    isoDate(new Date())
  );

  return (
    <StatusMonthGrid
      selectedDate={selectedDate}
      onSelectDate={setSelectedDate}
    />
  );
}
