"use client";

// Общий диалог «мягкого» 409-конфликта раздела ОМ: конфликт можно
// подтвердить, указав причину (10–500 символов после trim) — причина уходит
// в аудит бэкенда. Пер-фичевые оверрайд-диалоги не заводить: диалог один.
// Стек OLD: shadcn Dialog (Radix) — focus-trap, Escape и возврат фокуса
// обеспечивает Radix.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OpsConflictError } from "@/lib/ops-errors";

export const REASON_MIN = 10;
export const REASON_MAX = 500;

export interface ConflictDialogProps {
  conflict: OpsConflictError | null;
  /** «Подтвердить»: причина уже провалидирована (10–500 после trim). */
  onOverride: (reason: string) => void;
  /** «Отмена»/Escape/клик мимо: повтора не будет, conflict сбрасывает владелец. */
  onCancel: () => void;
}

export function ConflictDialog({
  conflict,
  onOverride,
  onCancel,
}: ConflictDialogProps) {
  if (conflict === null) return null;
  // размонтирование = закрытие: state причины не переживает смену конфликта
  return (
    <OpenConflictDialog
      conflict={conflict}
      onOverride={onOverride}
      onCancel={onCancel}
    />
  );
}

function OpenConflictDialog({
  conflict,
  onOverride,
  onCancel,
}: ConflictDialogProps & { conflict: OpsConflictError }) {
  const [reason, setReason] = useState("");

  const trimmed = reason.trim();
  const reasonValid =
    trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Конфликт: {conflict.message}</DialogTitle>
          <DialogDescription>
            Это мягкий конфликт — продолжить можно, указав причину. Причина
            попадёт в аудит.
          </DialogDescription>
        </DialogHeader>
        <ConflictList details={conflict.details} />
        <div className="space-y-2">
          <Label htmlFor="ops-conflict-reason">
            Причина ({REASON_MIN}–{REASON_MAX} символов)
          </Label>
          <Textarea
            id="ops-conflict-reason"
            value={reason}
            placeholder="Например: наряд сокращён по приказу №…"
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="text-xs text-muted-foreground text-right">
            {reason.length} / {REASON_MAX}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={!reasonValid}
            onClick={() => onOverride(trimmed)}
          >
            Подтвердить оверрайд
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** details.conflicts[] конверта — unknown-типа: рендер строго defensive. */
function ConflictList({ details }: { details: Record<string, unknown> }) {
  const conflicts = Array.isArray(details.conflicts) ? details.conflicts : [];
  if (conflicts.length === 0) return null;
  return (
    <ul className="list-disc pl-5 text-sm text-muted-foreground">
      {conflicts.map((item, index) => (
        <li key={index}>{conflictLabel(item)}</li>
      ))}
    </ul>
  );
}

function conflictLabel(item: unknown): string {
  if (typeof item === "object" && item !== null) {
    const record = item as Record<string, unknown>;
    const parts = [record.conflict_code, record.employee_id].filter(
      (value): value is string => typeof value === "string"
    );
    if (parts.length > 0) return parts.join(" · ");
  }
  return JSON.stringify(item);
}
