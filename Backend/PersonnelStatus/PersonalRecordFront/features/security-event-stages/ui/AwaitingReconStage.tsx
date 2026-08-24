"use client";

// Стадия «Бюллетень» глазами карточки после 24.08.2026: своего шага у неё
// больше нет, сведения заполняются в панели над этапами, а здесь — вход в
// рекогносцировку, первый шаг цепочки.
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

export function AwaitingReconStage({
  event,
  bulletinDirty,
}: {
  event: SecurityEvent;
  /** В панели бюллетеня есть несохранённые правки. Переход их УБИВАЕТ:
   * завершённый бюллетень сервер больше не правит, а панель после смены
   * стадии перерисовывается сохранённым текстом. */
  bulletinDirty: boolean;
}) {
  const complete = useCompleteBulletin(event.id);
  const ready =
    event.briefDescription.trim() !== "" && event.initialTasks.trim() !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Рекогносцировка ещё не начата</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Осмотр объекта и расчёт постов открываются после бюллетеня: краткое
          описание и первичные задачи направлениям нужны старшему наряда до
          выезда. Заполняются они в блоке{" "}
          <span className="font-semibold text-foreground">
            «Бюллетень мероприятия»
          </span>{" "}
          над этапами.
        </p>
        <p className="text-xs text-muted-foreground">
          {ready
            ? "Бюллетень заполнен — можно открывать рекогносцировку."
            : "Пока в бюллетене заполнено не всё: сервер не откроет рекогносцировку."}
        </p>
        {/* Условие — по объектам ПОСЕЩЕНИЯ, а не по `objectId` мероприятия:
            у ОМ без объекта проведения объекты посещения обычно уже заведены,
            и подсказка «объект не выбран» противоречила бы их списку выше. */}
        {event.objectId === null && (event.visitObjects ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">
            Объект посещения у мероприятия не выбран — его добавляют кнопкой «+»
            в{" "}
            <Link
              href="/security-ops/events"
              className="font-semibold text-primary-ink"
            >
              реестре ОМ
            </Link>
            . Рекогносцировка без объекта ведётся по мероприятию целиком.
          </p>
        )}
        {bulletinDirty && (
          <p className="text-xs text-amber-700">
            В бюллетене есть несохранённые правки — сохраните их, иначе переход
            их потеряет.
          </p>
        )}
        {/* Признак `ready` кнопку НЕ блокирует: правило держит сервер
            (`BULLETIN_INCOMPLETE`), и второй гард рядом маскировал бы его
            отказ вместе с его объяснением. Несохранённый черновик — другое
            дело: его сервер не увидит вовсе, и терять его молча нельзя. */}
        <StageError error={complete.error} />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={complete.isPending || bulletinDirty}
            title={
              bulletinDirty ? "Сначала сохраните бюллетень." : undefined
            }
            onClick={() => complete.mutate({})}
          >
            {complete.isPending ? "Открытие…" : "Открыть рекогносцировку"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
