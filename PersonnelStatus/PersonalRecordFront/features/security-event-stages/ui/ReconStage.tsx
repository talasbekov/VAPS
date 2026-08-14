"use client";

// Этап 2 «Рекогносцировка»: чек-лист объекта и event-specific расчёт постов.
// Импорт из привязанной версии паспорта ДОБАВЛЯЕТ строки (ручные не
// затираются), повторный импорт дубли не плодит. «Требует изменений» в
// чек-листе обязывает к комментарию.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  useCompleteRecon,
  useImportReconPosts,
  useUpdateRecon,
} from "@/hooks/use-security-event-stages";
import type {
  ReconChecklistItem,
  ReconSectorPost,
  SecurityEvent,
} from "@/entities/security-event";
import { FieldErrors, StageError } from "./StageErrors";

let localSeq = 0;
function nextLocalId(): string {
  localSeq += 1;
  return `recon-local-${localSeq}`;
}

export function ReconStage({ event }: { event: SecurityEvent }) {
  const [checklist, setChecklist] = useState<ReconChecklistItem[]>(
    event.reconChecklist
  );
  const [rows, setRows] = useState<ReconSectorPost[]>(event.reconSectorPosts);
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );

  const update = useUpdateRecon(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });
  // Импорт добавляет строки на СЕРВЕРЕ, поэтому его ответ переносится в форму
  // явно: карточка ОМ больше не пересобирается на каждом обновлении данных, и
  // без этого импортированные посты не появились бы. Несохранённые ручные
  // строки при этом остаются — их сервер ещё не видел.
  const importPosts = useImportReconPosts(event.id, {
    onEvent: (fresh) =>
      setRows((prev) => [
        ...fresh.reconSectorPosts,
        ...prev.filter((row) => row.id.startsWith("recon-local-")),
      ]),
  });
  const complete = useCompleteRecon(event.id);

  const dirty =
    JSON.stringify({ checklist, rows }) !==
    JSON.stringify({
      checklist: event.reconChecklist,
      rows: event.reconSectorPosts,
    });

  function patchItem(id: string, patch: Partial<ReconChecklistItem>): void {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function patchRow(id: string, patch: Partial<ReconSectorPost>): void {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function addRow(): void {
    setRows((prev) => [
      ...prev,
      {
        id: nextLocalId(),
        sector: "",
        post: "",
        task: "",
        need: 1,
        requirements: "",
        result: null,
        comment: "",
        sourceSectorId: null,
        sourcePostId: null,
        minRating: null,
      },
    ]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Рекогносцировка</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Чек-лист объекта</h3>
          <div className="flex flex-col gap-2">
            {checklist.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 items-center gap-2 border-b pb-2 last:border-0 md:grid-cols-[auto_1fr_170px_1fr]"
              >
                <Checkbox
                  aria-label={`Выполнено: ${item.label}`}
                  checked={item.done}
                  onCheckedChange={(checked) =>
                    patchItem(item.id, { done: checked === true })
                  }
                />
                <span className="text-sm">{item.label}</span>
                <select
                  aria-label={`Результат: ${item.label}`}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={item.result ?? ""}
                  onChange={(e) =>
                    patchItem(item.id, {
                      result:
                        e.target.value === ""
                          ? null
                          : (e.target.value as "MATCHES" | "NEEDS_CHANGES"),
                    })
                  }
                >
                  <option value="">— не проверено —</option>
                  <option value="MATCHES">Соответствует</option>
                  <option value="NEEDS_CHANGES">Требует изменений</option>
                </select>
                <Input
                  className="h-8 text-xs"
                  placeholder="Комментарий"
                  aria-label={`Комментарий: ${item.label}`}
                  value={item.comment}
                  onChange={(e) => patchItem(item.id, { comment: e.target.value })}
                />
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Посты и секторы</h3>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={importPosts.isPending || event.passportBinding === null}
                title={
                  event.passportBinding === null
                    ? "Мероприятие не привязано к версии паспорта."
                    : undefined
                }
                onClick={() => importPosts.mutate({})}
              >
                {importPosts.isPending ? "Импорт…" : "Импорт из паспорта"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                + Пост
              </Button>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Постов пока нет — импортируйте из паспорта или добавьте вручную.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-2 gap-2 border-b pb-2 last:border-0 md:grid-cols-[1fr_1fr_1.4fr_70px_1.2fr_90px_auto]"
                >
                  <Input
                    className="h-8 text-xs"
                    placeholder="Сектор"
                    aria-label="Сектор"
                    value={row.sector}
                    onChange={(e) => patchRow(row.id, { sector: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Пост"
                    aria-label="Пост"
                    value={row.post}
                    onChange={(e) => patchRow(row.id, { post: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Задача"
                    aria-label="Задача"
                    value={row.task}
                    onChange={(e) => patchRow(row.id, { task: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    min={1}
                    aria-label="Потребность"
                    value={row.need}
                    onChange={(e) =>
                      patchRow(row.id, { need: Number(e.target.value) || 0 })
                    }
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Требования"
                    aria-label="Требования"
                    value={row.requirements}
                    onChange={(e) =>
                      patchRow(row.id, { requirements: e.target.value })
                    }
                  />
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    placeholder="Мин. рейтинг"
                    aria-label="Минимальный рейтинг"
                    value={row.minRating ?? ""}
                    onChange={(e) =>
                      patchRow(row.id, {
                        minRating:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Удалить пост"
                    onClick={() =>
                      setRows((prev) => prev.filter((r) => r.id !== row.id))
                    }
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <FieldErrors errors={fieldErrors} />
        <StageError error={update.error} />
        <StageError error={importPosts.error} />
        <StageError error={complete.error} />

        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || update.isPending}
            onClick={() => {
              setFieldErrors(null);
              update.mutate({ checklist, sectorPosts: rows });
            }}
          >
            {update.isPending ? "Сохранение…" : "Сохранить рекогносцировку"}
          </Button>
          <Button
            type="button"
            disabled={complete.isPending || dirty}
            title={dirty ? "Сначала сохраните изменения." : undefined}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending ? "Завершение…" : "Завершить этап → Потребность"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
