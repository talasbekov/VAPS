"use client";

// Машины реестра ГОН, выделенные на мероприятие, — один список для панели и
// формы правки (Plane №951).
//
// Заказчик: «Машины тоже должны подтягиваться со справочника транспортов».
// Выделение из реестра было (Plane №215), но жило только в режиме просмотра;
// в форме правки человек видел один свободный текст и набирал машину руками.
// Список вынесен сюда, чтобы в двух местах он не разошёлся.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { releaseVehicle } from "@/features/event-vehicles";
import { invalidateSecurityEvents } from "@/lib/ops-invalidate";
import { useToast } from "@/shared/hooks/use-toast";
import type { SecurityEvent } from "@/entities/security-event";

export function RegistryVehicles({
  event,
  canEdit,
}: {
  event: SecurityEvent;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const release = useMutation({
    mutationFn: releaseVehicle,
    onSuccess: () => {
      invalidateSecurityEvents(queryClient);
      toast({ title: "Машина снята с мероприятия" });
    },
    onError: () =>
      toast({
        title: "Не удалось снять машину",
        description: "Сервис временно недоступен. Попробуйте ещё раз.",
        variant: "destructive",
      }),
  });
  if (event.vehicles.length === 0) return null;
  return (
    <div className="space-y-2" data-slot="registry-vehicles">
      {event.vehicles.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center gap-[11px] rounded-[9px] border border-[hsl(210_40%_94%)] px-3 py-[9px]"
        >
          {row.callsign === "" ? null : (
            <span className="rounded-[7px] bg-[hsl(222.2_47.4%_11.2%)] px-[10px] py-[3px] text-[11px] font-extrabold text-white">
              {row.callsign}
            </span>
          )}
          <span className="text-[12.5px] font-semibold">{row.label}</span>
          {row.armorClass ? (
            <span className="rounded-full bg-blue-100 px-[9px] py-0.5 text-[10.5px] font-bold text-blue-800">
              {row.armorClass}
            </span>
          ) : null}
          <span className="text-[11.5px] text-muted-foreground">{row.purpose}</span>
          {/* Источник назван СЛОВАМИ: две строки подряд из разных источников
              иначе неотличимы, и человек не поймёт, почему одну можно править
              текстом, а другую нет. */}
          <span className="text-[11px] text-muted-foreground">из реестра ГОН</span>
          {canEdit && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-[26px] text-[11.5px]"
              disabled={release.isPending}
              onClick={() => release.mutate({ eventId: event.id, allocationId: row.id })}
            >
              Снять
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
