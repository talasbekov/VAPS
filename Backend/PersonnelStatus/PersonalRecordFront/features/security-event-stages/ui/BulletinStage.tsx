"use client";

// Этап 1 «Бюллетень»: описание и первичные задачи направлениям. Пустой
// бюллетень не завершается — следующему этапу не с чем работать.
//
// Сверено с экраном прототипа Smart Josparlau «Информационный бюллетень».
// Оттуда добавлена только готовность этапа: до этого о том, что завершение
// упрётся в пустое поле, узнавали по отказу сервера ПОСЛЕ нажатия.
//
// СОЗНАТЕЛЬНО не перенесено:
// * «Сведения об ОМ» (11 фактов) — шапка карточки ОМ показывает их же: дату,
//   объект, ответственного и версию паспорта. Второй такой блок был бы
//   дублем, который начнёт расходиться с первым;
// * «Редактировать ОМ» — правки названия, даты и объекта бэк не принимает:
//   PATCH этапа принимает только описание и задачи;
// * «Документы к подготовке» — в прототипе эта таблица набрана литералом
//   (две строки прямо в разметке). Модели документов с ответственными и
//   сроками нет ни у бэка, ни в контракте, и выдумывать её на экране нельзя.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useCompleteBulletin,
  useUpdateBulletin,
} from "@/hooks/use-security-event-stages";
import type { SecurityEvent } from "@/entities/security-event";
import { FieldErrors, StageError } from "./StageErrors";

export function BulletinStage({ event }: { event: SecurityEvent }) {
  const [briefDescription, setBriefDescription] = useState(event.briefDescription);
  const [initialTasks, setInitialTasks] = useState(event.initialTasks);
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );

  const update = useUpdateBulletin(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });
  const complete = useCompleteBulletin(event.id);

  const dirty =
    briefDescription !== event.briefDescription ||
    initialTasks !== event.initialTasks;

  // Готовность считается по СОХРАНЁННОМУ бюллетеню, а не по полям формы:
  // сервер смотрит на своё состояние, и набранный, но не сохранённый текст
  // этап не откроет.
  const savedBrief = event.briefDescription.trim() !== "";
  const savedTasks = event.initialTasks.trim() !== "";
  const ready = savedBrief && savedTasks;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Бюллетень</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="bulletin-brief">Краткое описание *</Label>
          <Textarea
            id="bulletin-brief"
            value={briefDescription}
            onChange={(e) => setBriefDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bulletin-tasks">Первичные задачи направлениям *</Label>
          <Textarea
            id="bulletin-tasks"
            value={initialTasks}
            onChange={(e) => setInitialTasks(e.target.value)}
          />
        </div>
        {/* Кнопка завершения НЕ блокируется по этим признакам: правило
            «описание и задачи заполнены» держит сервер, и второй гард рядом
            маскировал бы его отказ. Здесь только видимое состояние. */}
        <div className="rounded-md border px-3 py-2 text-xs">
          <p className="mb-1 font-semibold">
            Готовность этапа:{" "}
            <span className={ready ? "text-green-700" : "text-amber-700"}>
              {ready ? "можно завершать" : "заполнено не всё"}
            </span>
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              Краткое описание — {savedBrief ? "сохранено" : "не заполнено"}
            </li>
            <li>
              Первичные задачи — {savedTasks ? "сохранены" : "не заполнены"}
            </li>
          </ul>
          {dirty && (
            <p className="mt-1 text-amber-700">
              Есть несохранённые правки — сервер их пока не видит.
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Что дальше: после завершения бюллетеня открывается рекогносцировка —
          осмотр объекта и расчёт постов старшим наряда.
        </p>

        <FieldErrors errors={fieldErrors} />
        <StageError error={update.error} />
        <StageError error={complete.error} />
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || update.isPending}
            onClick={() => {
              setFieldErrors(null);
              update.mutate({ briefDescription, initialTasks });
            }}
          >
            {update.isPending ? "Сохранение…" : "Сохранить бюллетень"}
          </Button>
          <Button
            type="button"
            disabled={complete.isPending || dirty}
            title={dirty ? "Сначала сохраните изменения." : undefined}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending
              ? "Завершение…"
              : "Завершить этап → Рекогносцировка"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
