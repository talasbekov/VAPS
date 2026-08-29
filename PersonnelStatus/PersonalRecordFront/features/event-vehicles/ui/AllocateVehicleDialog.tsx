"use client";

// Окно «Выделить машину» из раздела «Выделяемый транспорт» сводки ГВО
// (Plane №215).
//
// Машина выбирается ИЗ РЕЕСТРА, а не набирается строкой: у строки нет ни
// ГРНЗ, ни класса брони, и документ «Список броней» из неё не собрать. Уже
// выделенные машины в списке гасятся — сервер отбил бы их повтором, и честнее
// не давать нажать, чем показать отказ после нажатия.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/shared/hooks/use-toast";
import { useVehicles } from "@/hooks/use-vehicles";
import type { SecurityEvent } from "@/entities/security-event";
import { invalidateSecurityEvents } from "@/lib/ops-invalidate";
import { allocateVehicle } from "../api/event-vehicles-api";

export function AllocateVehicleDialog({
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
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [callsign, setCallsign] = useState("");
  const [purpose, setPurpose] = useState("");

  // Черновик живёт вместе с открытием окна: закрыли и открыли — начинаем с
  // чистого листа, а не с прошлого выбора.
  useEffect(() => {
    if (open) {
      setSearch("");
      setPicked(null);
      setCallsign("");
      setPurpose("");
    }
  }, [open]);

  // Отбор считает сервер — тот же путь, что у экрана реестра.
  const fleet = useVehicles({ search }, { enabled: open });

  const allocated = useMemo(
    () =>
      new Set(
        event.vehicles
          .map((row) => row.vehicleId)
          .filter((id): id is string => id !== null)
      ),
    [event.vehicles]
  );

  const mutation = useMutation({
    mutationFn: (vehicleId: string) =>
      allocateVehicle({
        eventId: event.id,
        vehicleId,
        callsign: callsign.trim(),
        purpose: purpose.trim(),
      }),
    onSuccess: () => {
      invalidateSecurityEvents(queryClient);
      toast({ title: "Машина выделена на мероприятие" });
      onClose();
    },
    onError: () =>
      toast({
        title: "Не удалось выделить машину",
        description: "Сервис временно недоступен. Попробуйте ещё раз.",
        variant: "destructive",
      }),
  });

  const rows = fleet.data?.results ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Выделить машину на мероприятие</DialogTitle>
          <DialogDescription>
            {event.code} · {event.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              className="pl-9"
              placeholder="Марка или государственный номер…"
              aria-label="Поиск по реестру транспорта"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-56 space-y-1 overflow-y-auto">
            {fleet.isLoading ? (
              <p className="text-muted-foreground px-1 py-3 text-sm">
                Загрузка реестра…
              </p>
            ) : fleet.isError ? (
              <p className="text-destructive-ink px-1 py-3 text-sm">
                Не удалось загрузить реестр транспорта.
              </p>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground px-1 py-3 text-sm">
                По этому запросу машин нет.
              </p>
            ) : (
              rows.map((vehicle) => {
                const taken = allocated.has(vehicle.id);
                return (
                  <button
                    key={vehicle.id}
                    type="button"
                    disabled={taken}
                    aria-pressed={picked === vehicle.id}
                    onClick={() => setPicked(vehicle.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-[9px] border px-3 py-2 text-left text-[12.5px] ${
                      picked === vehicle.id ? "border-primary bg-primary/5" : ""
                    } ${taken ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50"}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {vehicle.brand}
                      </span>
                      <span className="text-muted-foreground block text-[11.5px] tabular-nums">
                        {vehicle.plate}
                        {vehicle.armorClass === "" ? "" : ` · ${vehicle.armorClass}`}
                        {vehicle.deployment === "" ? "" : ` · ${vehicle.deployment}`}
                      </span>
                    </span>
                    {taken ? (
                      // Причина словами: погашенная строка без объяснения
                      // читается как поломка списка.
                      <span className="text-muted-foreground shrink-0 text-[11px]">
                        уже выделена
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="vehicle-callsign">Позывной в кортеже</Label>
              <Input
                id="vehicle-callsign"
                placeholder="S1"
                value={callsign}
                onChange={(e) => setCallsign(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vehicle-purpose">Назначение</Label>
              <Input
                id="vehicle-purpose"
                placeholder="кортеж, сопровождение, резерв"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={picked === null || mutation.isPending}
            onClick={() => picked !== null && mutation.mutate(picked)}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Выделить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
