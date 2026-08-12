"use client";

// Экран отказа по правам для страниц раздела ОМ.
//
// Один владелец на весь раздел, а не копия в каждой странице: до этого гвард
// жил врукопашную в пяти страницах (events, objects, duties, command-center,
// calendar), а на остальных шестнадцати его не было вовсе — бэк отвечал 403,
// а пользователь видел пустой экран без объяснения. Смоук-обход 12.08.2026
// намерил 22 страницы с 403 при загрузке против 6 закрытых гвардом.
//
// Права раздела — плоские коды с бэка (`useOpsPermissions`), НЕ resource/action
// хоста из lib/auth.tsx: две системы прав сосуществуют, и путать их нельзя.
//
// Гвард ставится ПОСЛЕ хуков страницы (правило хуков React), поэтому запросы
// всё равно уходят и получают свои 403 — это ожидаемо и совпадает с поведением
// пяти ранее закрытых страниц. Чинится здесь ровно то, что видит человек.
import type { ReactElement } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";

interface OpsAccessDeniedProps {
  /**
   * Родительный падеж того, что закрыто: «реестра ОМ», «журнала аудита».
   * Подставляется в «Недостаточно прав для просмотра {what}.» — формулировка
   * дословно та же, что была в пяти страницах до выноса, и по ней же обход
   * опознаёт закрытый экран (e2e/smoke-buttons.spec.ts, `gated`).
   */
  what: string;
}

export function OpsAccessDenied({ what }: OpsAccessDeniedProps): ReactElement {
  return (
    <DashboardLayout>
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Недостаточно прав для просмотра {what}.
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
