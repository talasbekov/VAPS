"use client";

// Этап 3 «Потребность»: строки расчёта сил. Отдельного «сохранить черновик»
// нет — одна операция сохраняет строки И утверждает потребность (без
// промежуточного «сохранено, но не утверждено»), агрегирует запросы по
// группам и открывает «Запрос сил».
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApproveDemand } from "@/hooks/use-security-event-stages";
import type { SecurityEvent, StaffingDemandRow } from "@/entities/security-event";
import { FieldErrors, StageError } from "./StageErrors";

let localSeq = 0;
function nextLocalId(): string {
  localSeq += 1;
  return `demand-local-${localSeq}`;
}

/** Стартовые строки: по строке на пост расчёта рекогносцировки. */
function seedRows(event: SecurityEvent): StaffingDemandRow[] {
  if (event.demandRows.length > 0) return event.demandRows;
  return event.reconSectorPosts.map((post) => ({
    id: nextLocalId(),
    sector: post.sector,
    task: post.task !== "" ? post.task : post.post,
    shift: "",
    need: post.need,
    group: "",
    requirements: post.requirements,
    comment: "",
  }));
}

export function DemandStage({ event }: { event: SecurityEvent }) {
  const [rows, setRows] = useState<StaffingDemandRow[]>(() => seedRows(event));
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const approve = useApproveDemand(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  function patchRow(id: string, patch: Partial<StaffingDemandRow>): void {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  const totalNeed = rows.reduce((sum, row) => sum + row.need, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Потребность в силах</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Строк нет — добавьте потребность вручную.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-2 gap-2 border-b pb-2 last:border-0 md:grid-cols-[1fr_1.3fr_90px_70px_1fr_1fr_auto]"
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
                  placeholder="Задача"
                  aria-label="Задача"
                  value={row.task}
                  onChange={(e) => patchRow(row.id, { task: e.target.value })}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="Смена"
                  aria-label="Смена"
                  value={row.shift}
                  onChange={(e) => patchRow(row.id, { shift: e.target.value })}
                />
                <Input
                  className="h-8 text-xs"
                  type="number"
                  min={1}
                  aria-label="Численность"
                  value={row.need}
                  onChange={(e) =>
                    patchRow(row.id, { need: Number(e.target.value) || 0 })
                  }
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="Группа (исполнитель)"
                  aria-label="Группа"
                  value={row.group}
                  onChange={(e) => patchRow(row.id, { group: e.target.value })}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="Требования"
                  aria-label="Требования к группе"
                  value={row.requirements}
                  onChange={(e) =>
                    patchRow(row.id, { requirements: e.target.value })
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Удалить строку"
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

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((prev) => [
                ...prev,
                {
                  id: nextLocalId(),
                  sector: "",
                  task: "",
                  shift: "",
                  need: 1,
                  group: "",
                  requirements: "",
                  comment: "",
                },
              ])
            }
          >
            + Строка
          </Button>
          <span className="text-sm text-muted-foreground">
            Итого потребность:{" "}
            <span className="font-semibold tabular-nums">{totalNeed}</span>
          </span>
        </div>

        <FieldErrors errors={fieldErrors} />
        <StageError error={approve.error} />

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={approve.isPending}
            onClick={() => {
              setFieldErrors(null);
              approve.mutate({ rows });
            }}
          >
            {approve.isPending
              ? "Утверждение…"
              : "Сохранить и утвердить потребность → Запрос сил"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
