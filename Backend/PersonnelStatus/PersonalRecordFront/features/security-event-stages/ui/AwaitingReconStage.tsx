"use client";

// Стадия «Бюллетень» глазами карточки после 24.08.2026: своего шага у неё
// больше нет, сведения заполняются в панели над этапами, а здесь — вход в
// рекогносцировку, первый шаг цепочки.
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

export function AwaitingReconStage({
  event,
  bulletinDirty,
}: {
  event: SecurityEvent;
  /** В панели бюллетеня есть несохранённые правки. Сам переход их больше не
   * убивает (панель правится на любой стадии, кроме закрытой), но сервер их
   * НЕ ВИДИТ: рекогносцировка откроется без описания и задач, которые человек
   * считает набранными. Предупредить дешевле, чем разбирать потерю. */
  bulletinDirty: boolean;
}) {
  const complete = useCompleteBulletin(event.id);
  const ready =
    event.briefDescription.trim() !== "" && event.initialTasks.trim() !== "";
  // Гейт сервера держит ОБЪЕКТ, а не текст: считать признак надо так же,
  // иначе экран обещал бы отказ, которого не будет (или наоборот).
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
            <p className="text-sm text-muted-foreground">
              Осмотр объекта и расчёт постов открываются после бюллетеня:
              краткое описание и первичные задачи направлениям — единственное,
              что старший наряда получает до выезда. Заполняются они в блоке{" "}
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
