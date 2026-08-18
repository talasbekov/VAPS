"use client";

import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Экран для страниц, которые целиком питает `staff-units/directorate/`
 * (/employees и /statuses): ручка закрыта ролевой проверкой ROLE_3/6/7, и без
 * неё на этих страницах не остаётся ничего — счётчики, фильтры, таблица,
 * карточки и календарь читают ОДИН этот запрос. Поэтому закрываем экран
 * целиком, а не блок: полупустая страница с нулями врала бы, что в
 * подразделении нет людей.
 *
 * Формулировка «Недостаточно прав» — общая с гвардами раздела ОМ
 * (app/security-ops/*), по ней же смоук-обход отличает закрытый экран от
 * молчаливой 4xx (e2e/smoke-buttons.spec.ts).
 */
export function DirectorateAccessNotice({
  reason,
}: {
  reason?: string | null;
}) {
  return (
    <Card>
      <CardContent className="p-9 text-center">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          Недостаточно прав для просмотра этого раздела.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Штатное расписание подразделения ведут начальник департамента,
          начальник управления или начальник отдела. Если раздел нужен вам по
          работе — обратитесь к администратору системы.
        </p>
        {reason ? (
          <p className="mt-3 text-xs text-muted-foreground">Ответ сервера: {reason}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
