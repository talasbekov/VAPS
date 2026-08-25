"use client";

// Окно «Назначить замещающего» из строки объекта посещения (Plane «Реестр
// ОМ-24»). Замещающий получает право править расстановку СВОЕГО объекта, не
// имея общего права вести мероприятие — то есть окно раздаёт ПРАВО, а не
// заполняет справочное поле. Отсюда две особенности:
//
// * назначение по одному, а не пачкой: право выдаётся человеку персонально, и
//   список галочек скрывал бы, кому именно и с какими полномочиями его дали;
// * флажок «может править расстановку» стоит РЯДОМ с выбором, а не в
//   настройках после: наблюдатель и правящий — это два разных решения, и
//   принимаются они в один момент.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/shared/hooks/use-toast";
import { PersonnelPicker } from "@/features/personnel-picker";
import type { SecurityEvent, VisitObject } from "@/entities/security-event";
import { addVisitObjectDeputy } from "../api/visit-objects-api";

export function AddDeputyDialog({
  event,
  visit,
  open,
  onClose,
}: {
  event: SecurityEvent;
  visit: VisitObject;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const [canEditPlacement, setCanEditPlacement] = useState(true);

  // Черновик живёт вместе с открытием окна: закрыли и открыли снова —
  // начинаем с чистого листа, а не с прошлого выбора.
  useEffect(() => {
    if (open) {
      setPicked(null);
      setCanEditPlacement(true);
    }
  }, [open]);

  // Уже назначенные не предлагаются: сервер отобьёт повтор ошибкой поля, а
  // строка в списке обещала бы действие, которое гарантированно не пройдёт.
  const assigned = useMemo(
    () => new Set(visit.deputies.map((deputy) => deputy.employeeId)),
    [visit.deputies]
  );
  const save = useMutation({
    mutationFn: addVisitObjectDeputy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
      toast({ title: "Замещающий назначен" });
      onClose();
    },
    // Отказ ОБЪЯСНЯЕТСЯ: сервер отбивает повтор и закрытое мероприятие, и
    // человеку нужна причина, а не «не получилось».
    onError: (error: unknown) => {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      toast({
        title: "Замещающий не назначен",
        description:
          message === ""
            ? "Сервис временно недоступен. Попробуйте ещё раз."
            : message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Замещающий на объекте</DialogTitle>
          <DialogDescription>
            {visit.objectName} · {event.code}. Замещающий ведёт расстановку
            этого объекта вместо старшего; каждое его действие попадает в
            журнал.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Поиск и страницы — на сервере (Plane «Реестр ОМ-35.3»): раньше
              окно грузило кадровый снимок целиком и фильтровало загруженное,
              то есть отвечало «никого не нашлось» про непрогруженных. */}
          <PersonnelPicker
            value={picked}
            onPick={setPicked}
            disabledIds={assigned}
            disabledNote="уже назначен"
            resetKey={open}
          />

          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="deputy-can-edit"
              checked={canEditPlacement}
              onCheckedChange={(checked) =>
                setCanEditPlacement(checked === true)
              }
            />
            <div className="space-y-0.5">
              <Label htmlFor="deputy-can-edit" className="text-xs font-semibold">
                Может править расстановку этого объекта
              </Label>
              {/* Последствие обоих состояний названо: галочка раздаёт право
                  действовать в обход общего, и её цена должна быть видна в
                  момент решения, а не выясняться потом. */}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {canEditPlacement
                  ? "Сможет назначать и снимать людей на постах объекта, не имея права вести мероприятие."
                  : "Останется назначенным наблюдателем: будет в списке объекта, но расстановку не тронет."}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={picked === null || save.isPending}
            title={picked === null ? "Выберите сотрудника." : undefined}
            onClick={() =>
              picked !== null &&
              save.mutate({
                eventId: event.id,
                visitObjectId: visit.id,
                employeeId: picked,
                canEditPlacement,
              })
            }
          >
            {save.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Назначить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
