"use client";

// Календарь статусов: два вида взамен прежнего «Календаря статусов»
// (Plane №270) — месячная сетка с панелью занятости и матрица
// «сотрудник × день».
//
// Выбранный день живёт ЗДЕСЬ, а не внутри сетки: его читает и сетка
// (подсветка выбора), и панель — два состояния одного выбора разошлись бы на
// первом же клике.
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusDayPanel } from "./StatusDayPanel";
import { StatusMatrix } from "./StatusMatrix";
import { StatusMonthGrid, isoDate } from "./StatusMonthGrid";

export function StatusCalendarBoard() {
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    isoDate(new Date())
  );

  return (
    <Tabs defaultValue="month" className="space-y-4">
      <TabsList>
        <TabsTrigger value="month">Месяц</TabsTrigger>
        <TabsTrigger value="matrix">Матрица</TabsTrigger>
      </TabsList>

      <TabsContent value="month">
        {/* Панель шириной в колонку рядом с сеткой на широком экране и под ней
            на узком: на телефоне колонка в 320px оставила бы сетке 40 пикселей. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <StatusMonthGrid
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          <StatusDayPanel date={selectedDate} />
        </div>
      </TabsContent>

      <TabsContent value="matrix">
        <StatusMatrix />
      </TabsContent>
    </Tabs>
  );
}
