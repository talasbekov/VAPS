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
import { Loader2, Search } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/shared/hooks/use-toast";
import { usePersonnelRoster } from "@/hooks/use-security-event-stages";
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
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [canEditPlacement, setCanEditPlacement] = useState(true);

  // Черновик живёт вместе с открытием окна: закрыли и открыли снова —
  // начинаем с чистого листа, а не с прошлого выбора.
  useEffect(() => {
    if (open) {
      setSearch("");
      setPicked(null);
      setCanEditPlacement(true);
    }
  }, [open]);

  const roster = usePersonnelRoster();
  // Уже назначенные не предлагаются: сервер отобьёт повтор ошибкой поля, а
  // строка в списке обещала бы действие, которое гарантированно не пройдёт.
  const assigned = useMemo(
    () => new Set(visit.deputies.map((deputy) => deputy.employeeId)),
    [visit.deputies]
  );
  const people = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (roster.data?.results ?? []).filter(
      (person) =>
        query === "" ||
        person.name.toLowerCase().includes(query) ||
        person.unit.toLowerCase().includes(query)
    );
  }, [roster.data, search]);

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
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-8"
              placeholder="Поиск по ФИО или подразделению"
              aria-label="Поиск сотрудника"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-md border">
            {roster.isPending && (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                Загрузка кадрового списка…
              </p>
            )}
            {roster.isError && (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                Кадровый список сейчас недоступен.
              </p>
            )}
            {roster.data && people.length === 0 && (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                По запросу никого не нашлось.
              </p>
            )}
            <ul>
              {people.map((person) => {
                const already = assigned.has(person.id);
                return (
                  <li key={person.id} className="border-b last:border-0">
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => setPicked(person.id)}
                      className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
                        picked === person.id ? "bg-muted" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{person.name}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {person.rankLabel}
                          {person.unit === "" ? "" : ` · ${person.unit}`}
                        </span>
                      </span>
                      {/* Причина недоступности названа словом: серая строка
                          без объяснения читается как сбой списка. */}
                      {already && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          уже назначен
                        </span>
                      )}
                      {!already && picked === person.id && (
                        <span className="shrink-0 text-[11px] font-semibold text-primary-ink">
                          выбран
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

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
