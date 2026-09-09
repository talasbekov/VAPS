"use client";

// Стадия «Бюллетень» глазами карточки после 24.08.2026: своего шага у неё
// больше нет, сведения стоят в панели над этапами, а здесь — вход в
// рекогносцировку, первый шаг цепочки. Текста бюллетеня («описание»,
// «задачи») с 07.09.2026 нет вовсе (Plane №943).
//
// С 25.08.2026 (Plane «Реестр ОМ-5») ОМ С ОБЪЕКТОМ на этой стадии вообще не
// заводится — он стартует сразу рекогносцировкой. Панель остаётся ради двух
// состояний: ОМ без объекта (осматривать нечего) и ОМ, заведённые до правила.
// У последних объект есть, и бюллетеня от них сервер уже не требует — врать
// про «нужно заполнить» нельзя.
//
// Форму рекогносцировки здесь НЕ показываем: PATCH рекогносцировки на стадии
// «Бюллетень» сервер отклоняет, и форма, которая гарантированно получит
// отказ, — обещание, а не действие.
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompleteBulletin } from "@/hooks/use-security-event-stages";
import type { SecurityEvent } from "@/entities/security-event";
import { StageError } from "./StageErrors";

export function AwaitingReconStage({ event }: { event: SecurityEvent }) {
  const complete = useCompleteBulletin(event.id);
  // Текста бюллетеня переход не требует (Plane №943): описание и задачи
  // сняты со всего проекта, признака «заполнено не всё» больше нет.
  const hasObject =
    event.objectId !== null || (event.visitObjects ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Рекогносцировка ещё не начата</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasObject ? (
          <p className="text-sm text-muted-foreground">
            Объект посещения выбран — осматривать есть что, и рекогносцировку
            можно открыть сразу: бюллетеня сервер от такого мероприятия не
            требует. Заведённые с объектом ОМ начинаются с рекогносцировки и
            этого шага не видят вовсе.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Объект посещения у мероприятия не выбран — его добавляют кнопкой
              «+» в{" "}
              <Link
                href="/security-ops/events"
                className="font-semibold text-primary-ink"
              >
                реестре ОМ
              </Link>
              . Рекогносцировка без объекта ведётся по мероприятию целиком.
            </p>
          </>
        )}
        <StageError error={complete.error} />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={complete.isPending}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending ? "Открытие…" : "Открыть рекогносцировку"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
