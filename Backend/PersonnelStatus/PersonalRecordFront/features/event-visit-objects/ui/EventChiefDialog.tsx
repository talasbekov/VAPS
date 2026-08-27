"use client";

// Окно «Старший наряда» из строки реестра (Plane №190). Постановка заказчика
// дословно: «даже если обьект не выбран то должна быть возможность добавлять
// старшего наряда».
//
// ПОЧЕМУ ОТДЕЛЬНОЕ ОКНО, А НЕ `AssignChiefDialog` С ФЛАГОМ. Оно соседнее и
// похоже до строчки, и соблазн слить их в одно с признаком «объектное или
// нет» велик. Слитое окно пришлось бы читать вместе с флагом на каждой
// строке: у старшего объекта есть объект и снятие отдельной кнопкой, у
// старшего наряда объекта нет вовсе, а снятие идёт тем же вызовом с пустым
// полем. Общее у них — только `PersonnelPicker`, и он и так общий.
//
// Список сотрудников — тот же `PersonnelPicker` (поиск и страницы НА
// СЕРВЕРЕ): второй свой список кандидатов означал бы второй способ искать
// людей, расходящийся с первым.
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
import type { SecurityEvent } from "@/entities/security-event";
import { setEventChief } from "../api/visit-objects-api";
import { invalidateSecurityEvents } from "@/lib/ops-invalidate";

export function EventChiefDialog({
  event,
  open,
  onClose,
}: {
  event: SecurityEvent;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const assigned = event.chiefEmployeeId !== null;

  // Черновик живёт вместе с открытием окна: закрыли и открыли снова —
  // начинаем с чистого листа, а не с прошлого выбора.
  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  // Подпись поля зависит от типа мероприятия — так же, как в окне создания:
  // у визита иностранного ОЛ наряд ведёт старший ГВО, и называть его
  // «старшим наряда» значило бы звать человека не его должностью.
  const foreign = event.kind === "FOREIGN";
  const label = foreign ? "Старший ГВО" : "Старший наряда";

  const save = useMutation({
    mutationFn: setEventChief,
    onSuccess: (_data, variables) => {
      invalidateSecurityEvents(queryClient);
      toast({
        title:
          variables.employeeId === ""
            ? `${label} снят`
            : assigned
              ? `${label} заменён`
              : `${label} назначен`,
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
        title: `${label} не изменён`,
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
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {event.code} · {event.title}. Отвечает за наряд мероприятия —
            это не старший объекта посещения, тот назначается в раскрытии
            строки на каждом объекте свой.
            {assigned && (
              <>
                {" "}
                {/* Прежнего называем ИМЕНЕМ: «заменить» без имени того, кого
                    заменяют, — решение вслепую. */}
                Сейчас назначен {event.chiefName} — выбор заменит его.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <PersonnelPicker
          value={picked}
          onPick={setPicked}
          disabledIds={
            event.chiefEmployeeId === null
              ? undefined
              : new Set([event.chiefEmployeeId])
          }
          disabledNote={`уже ${label.toLowerCase()}`}
          resetKey={open}
        />

        <DialogFooter>
          {/* Снятие живёт ЗДЕСЬ, а не крестиком в строке реестра: строка
              узкая, кнопок в ней уже три, а снятие старшего — редкое
              действие, которому место рядом с заменой. */}
          {assigned && (
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => save.mutate({ eventId: event.id, employeeId: "" })}
            >
              Снять
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={picked === null || save.isPending}
            title={picked === null ? "Выберите сотрудника." : undefined}
            onClick={() =>
              picked !== null &&
              save.mutate({ eventId: event.id, employeeId: picked })
            }
          >
            {save.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {assigned ? "Заменить" : "Назначить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
