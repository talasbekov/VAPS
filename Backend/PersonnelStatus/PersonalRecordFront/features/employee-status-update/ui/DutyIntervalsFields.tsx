"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, messageOf } from "@/shared/lib/form";
import { MAX_DUTY_INTERVALS, type DutyIntervalDraft } from "../model/duty-intervals";

interface Props {
  value: DutyIntervalDraft[] | undefined;
  onChange(value: DutyIntervalDraft[] | undefined): void;
  errors?: unknown;
}

/** Personnel status exits share one placement; the dispatcher keeps its own clock fields. */
export function DutyIntervalsFields({ value, onChange, errors }: Props) {
  const heading = useId();
  const rowErrors = errors as { [index: number]: { start?: unknown; end?: unknown } | undefined } | undefined;
  const rootError = messageOf(errors);
  const update = (index: number, field: "start" | "end", next: string) =>
    onChange((value ?? []).map((row, position) => position === index ? { ...row, [field]: next } : row));

  return <section aria-labelledby={heading} className="min-w-0 space-y-3 rounded-lg border p-3">
    <h4 id={heading} className="text-sm font-semibold">Выходы на дежурство</h4>
    <p className="text-xs text-muted-foreground">Время Астаны. Укажите точные дату и время каждого выхода на выбранный пост или в группу. Для ночного выхода выберите следующую дату окончания.</p>
    {value === undefined ? <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950  ">
      Время выходов не указано. Период статуса не означает круглосуточное нахождение на посту; часы дежурства неизвестны.
    </p> : value.length === 0 ? <p role="note" className="rounded-md border bg-muted/50 p-3 text-sm">
      Выходов нет. После сохранения сотрудник не будет показан на посту, пока не будет добавлен выход.
    </p> : null}
    {(value ?? []).map((row, index) => <fieldset key={index} className="min-w-0 space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Выход {index + 1}</legend>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field name={`dutyIntervals.${index}.start`} label="Начало выхода" required error={rowErrors?.[index]?.start} className="min-w-0">
          {field => <Input {...field} type="datetime-local" step="0.001" value={row.start} onChange={event => update(index, "start", event.target.value)} className="w-full min-w-0" />}
        </Field>
        <Field name={`dutyIntervals.${index}.end`} label="Окончание выхода" required error={rowErrors?.[index]?.end} className="min-w-0">
          {field => <Input {...field} type="datetime-local" step="0.001" value={row.end} onChange={event => update(index, "end", event.target.value)} className="w-full min-w-0" />}
        </Field>
      </div>
      <Button type="button" variant="ghost" size="sm" aria-label={`Удалить выход ${index + 1}`} onClick={() => onChange(value?.filter((_, position) => position !== index) ?? [])}>Удалить выход</Button>
    </fieldset>)}
    <div id="dutyIntervals" tabIndex={-1} className="space-y-2 outline-none">
      {rootError && <p role="alert" className="text-sm text-destructive-ink">{rootError}</p>}
      <Button type="button" variant="outline" size="sm" disabled={(value?.length ?? 0) >= MAX_DUTY_INTERVALS}
        onClick={() => onChange([...(value ?? []), { start: "", end: "" }])}>Добавить выход</Button>
    </div>
    {value !== undefined && <p className="text-xs text-muted-foreground">Изменение периода статуса не переносит выходы на другие даты. Уточните даты каждого выхода отдельно.</p>}
  </section>;
}
