"use client";

// Правка «Объектов посещения» сводки ГВО («Реестр ОМ-35.1»).
//
// Окно строится ПО СПИСКУ объектов мероприятия, а не по свободному тексту: до
// этой задачи раздел правился текстовым полем «Объекты по дням», и введённое
// там имя объекта никак не связывалось со строкой мероприятия — второй список
// расходился с первым молча, и объект из сводки не получал ни постов, ни
// готовности расстановки. Теперь список один, и здесь правится ровно то, что
// таблице действительно принадлежит: день посещения и примечание.
//
// Добавление и снятие объекта в это окно НЕ вынесены: у объекта своя
// расстановка и свои замещающие, и заводится он там, где заводится маршрут
// мероприятия («Добавить объекты» в реестре ОМ). Окно правки не то место, где
// снимают объект с постами.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/shared/hooks/use-toast";
import { updateVisitObject } from "@/features/event-visit-objects";
import type { SecurityEvent, VisitObject } from "@/entities/security-event";

export interface GvoVisitsDialogProps {
  event: SecurityEvent;
  onClose: () => void;
}

interface Draft {
  visitDay: string;
  note: string;
}

/** Строка формы — своя на каждый объект. `visitDay: ""` — «в день
 * мероприятия»: пустое поле здесь ОТВЕТ, а не незаполненность. */
function draftOf(visit: VisitObject): Draft {
  return { visitDay: visit.visitDay ?? "", note: visit.note };
}

export function GvoVisitsDialog({ event, onClose }: GvoVisitsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const visits = useMemo(
    () => [...event.visitObjects].sort((a, b) => a.position - b.position),
    [event.visitObjects]
  );

  // Черновик по id строки: правка идёт построчно, и общий объект формы на все
  // строки заставлял бы пересобирать его на каждое нажатие клавиши.
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(visits.map((visit) => [visit.id, draftOf(visit)]))
  );

  const save = useMutation({
    mutationFn: updateVisitObject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
  });

  const [failed, setFailed] = useState<string | null>(null);

  // Отправляются только ИЗМЕНЁННЫЕ строки: PATCH по каждому объекту сводки
  // писал бы в журнал и в базу правки, которых человек не делал.
  const changed = visits.filter((visit) => {
    const draft = drafts[visit.id] ?? draftOf(visit);
    const was = draftOf(visit);
    return draft.visitDay !== was.visitDay || draft.note.trim() !== was.note;
  });

  async function submit(): Promise<void> {
    setFailed(null);
    try {
      for (const visit of changed) {
        const draft = drafts[visit.id] ?? draftOf(visit);
        await save.mutateAsync({
          eventId: event.id,
          visitObjectId: visit.id,
          visitDay: draft.visitDay,
          note: draft.note.trim(),
        });
      }
      toast({ description: "Объекты посещения обновлены" });
      onClose();
    } catch (error: unknown) {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      // Причина отказа показывается ДОСЛОВНО: сервер отбивает закрытое
      // мероприятие и битую дату, и человеку нужна причина, а не «не вышло».
      setFailed(
        message === ""
          ? "Сервис временно недоступен. Попробуйте ещё раз."
          : message
      );
    }
  }

  /** «Вернуть исходные» — СРАЗУ, как в окне разделов сводки: там кнопка
   * снимает правку на сервере и закрывает окно, и делать её здесь всего лишь
   * очисткой полей значило бы дать одному слову два разных смысла. */
  async function resetAll(): Promise<void> {
    setFailed(null);
    const dirty = visits.filter(
      (visit) => visit.visitDay !== null || visit.note !== ""
    );
    try {
      for (const visit of dirty) {
        await save.mutateAsync({
          eventId: event.id,
          visitObjectId: visit.id,
          visitDay: "",
          note: "",
        });
      }
      toast({ description: "Дни и примечания объектов сняты" });
      onClose();
    } catch {
      setFailed("Не удалось снять правки. Попробуйте ещё раз.");
    }
  }

  function patchDraft(id: string, next: Partial<Draft>): void {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { visitDay: "", note: "" }), ...next },
    }));
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Объекты посещения</DialogTitle>
          <DialogDescription>
            {event.code} · {event.title}. Список объектов ведётся в реестре ОМ —
            здесь правятся день посещения и примечание. Пустой день означает
            «в дату мероприятия».
          </DialogDescription>
        </DialogHeader>

        {visits.length === 0 ? (
          <p className="rounded-[10px] border border-dashed px-3 py-4 text-[12.5px] text-muted-foreground">
            У мероприятия нет объектов посещения. Добавьте объект в реестре ОМ —
            он появится и здесь, и в расстановке.
          </p>
        ) : (
          <div className="flex flex-col gap-[13px]">
            {visits.map((visit) => (
              <div
                key={visit.id}
                className="rounded-[10px] border p-3 space-y-[9px]"
              >
                <p className="text-[12.5px] font-semibold">{visit.objectName}</p>
                <div className="grid gap-[9px] sm:grid-cols-[minmax(150px,180px)_1fr]">
                  <div className="space-y-1">
                    <label
                      className="block text-[11.5px] font-bold text-[hsl(215.4_16.3%_36.9%)]"
                      htmlFor={`visit-day-${visit.id}`}
                    >
                      День посещения
                    </label>
                    <Input
                      id={`visit-day-${visit.id}`}
                      type="date"
                      className="h-[38px] text-[13px]"
                      // Подпись читается вслух вместе с объектом: пять полей
                      // «День посещения» подряд иначе неразличимы на слух.
                      aria-label={`День посещения — ${visit.objectName}`}
                      value={drafts[visit.id]?.visitDay ?? ""}
                      onChange={(e) =>
                        patchDraft(visit.id, { visitDay: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      className="block text-[11.5px] font-bold text-[hsl(215.4_16.3%_36.9%)]"
                      htmlFor={`visit-note-${visit.id}`}
                    >
                      Примечание
                    </label>
                    <Input
                      id={`visit-note-${visit.id}`}
                      className="h-[38px] text-[13px]"
                      placeholder="основной объект · «ночь» — Офис"
                      aria-label={`Примечание — ${visit.objectName}`}
                      value={drafts[visit.id]?.note ?? ""}
                      onChange={(e) =>
                        patchDraft(visit.id, { note: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {failed !== null && (
          <p className="text-sm text-destructive-ink" role="alert">
            {failed}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-[15px]">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={save.isPending || visits.length === 0}
            onClick={() => void resetAll()}
          >
            Вернуть исходные
          </Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={save.isPending || changed.length === 0}
              onClick={() => void submit()}
            >
              {save.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
