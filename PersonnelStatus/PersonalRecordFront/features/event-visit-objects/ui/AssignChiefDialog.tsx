"use client";

// Окно «Назначить старшего объекта» из строки объекта посещения (Plane «Реестр
// ОМ-35.7»). Требование заказчика дословно: «рядом должна быть кнопка
// назначение старшего объекта. При нажатии открывается выпадающий список с
// пагинацией сотрудников с возможностью поиска».
//
// Список сотрудников — общий `PersonnelPicker` (поиск и страницы НА СЕРВЕРЕ,
// «Реестр ОМ-35.3»): второй свой список кандидатов означал бы второй способ
// искать людей, расходящийся с первым.
//
// Замена старшего идёт этим же окном и одним вызовом: у объекта старший ОДИН,
// и требование «сначала снимите» разбило бы обычную замену на две операции, в
// промежутке между которыми объект стоит без ответственного.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/shared/hooks/use-toast";
import { PersonnelPicker } from "@/features/personnel-picker";
import type { SecurityEvent, VisitObject } from "@/entities/security-event";
import { assignVisitObjectChief } from "../api/visit-objects-api";

export function AssignChiefDialog({
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

  // Черновик живёт вместе с открытием окна: закрыли и открыли снова —
  // начинаем с чистого листа, а не с прошлого выбора.
  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  const save = useMutation({
    mutationFn: assignVisitObjectChief,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
      toast({
        title:
          visit.chiefEmployeeId === null
            ? "Старший объекта назначен"
            : "Старший объекта заменён",
      });
      onClose();
    },
    // Отказ ОБЪЯСНЯЕТСЯ: сервер отбивает закрытое мероприятие и неизвестного
    // сотрудника, и человеку нужна причина, а не «не получилось».
    onError: (error: unknown) => {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      toast({
        title: "Старший не назначен",
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
          <DialogTitle>Старший объекта</DialogTitle>
          <DialogDescription>
            {visit.objectName} · {event.code}. Старший объекта отвечает за его
            расстановку и доклад.
            {visit.chiefEmployeeId !== null && (
              <>
                {" "}
                {/* Прежнего называем ИМЕНЕМ: «заменить» без имени того, кого
                    заменяют, — решение вслепую. */}
                Сейчас назначен {visit.chiefName} — выбор заменит его.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <PersonnelPicker
          value={picked}
          onPick={setPicked}
          disabledIds={
            visit.chiefEmployeeId === null
              ? undefined
              : new Set([visit.chiefEmployeeId])
          }
          disabledNote="уже старший"
          resetKey={open}
        />

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
              })
            }
          >
            {save.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {visit.chiefEmployeeId === null ? "Назначить" : "Заменить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
