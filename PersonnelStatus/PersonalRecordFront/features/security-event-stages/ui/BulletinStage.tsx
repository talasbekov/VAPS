"use client";

// Этап 1 «Бюллетень»: описание и первичные задачи направлениям. Пустой
// бюллетень не завершается — следующему этапу не с чем работать.
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
