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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompleteBulletin } from "@/hooks/use-security-event-stages";
import type { SecurityEvent } from "@/entities/security-event";
import { StageError } from "./StageErrors";
import { RightGate } from "@/shared/ui/right-gate";

export function AwaitingReconStage({ event }: { event: SecurityEvent }) {
  const complete = useCompleteBulletin(event.id);
  const blocked = event.canEditBulletin === true ? null :
    "Открыть рекогносцировку мероприятия может редактор бюллетеня.";
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
            Объект выбран. Следующий шаг — открыть рекогносцировку.
            После этого старший наряда указывает зоны, посты и потребность в людях.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Объект ещё не выбран. Ответственный за мероприятие добавляет его
              кнопкой «Добавить объекты» в блоке «Объекты ОМ» выше.
              Если отдельная площадка не нужна, рекогносцировка ведётся по мероприятию целиком.
            </p>
          </>
        )}
        <StageError error={complete.error} />
        <div className="flex justify-end">
          <RightGate reason={blocked}>{(describedBy) => <Button
            type="button"
            disabled={blocked !== null || complete.isPending}
            aria-describedby={describedBy}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending ? "Открытие…" : "Открыть рекогносцировку"}
          </Button>}</RightGate>
        </div>
      </CardContent>
    </Card>
  );
}
