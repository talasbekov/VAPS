"use client";

// Окно «Добавить объекты» из строки бюллетеня реестра ОМ.
//
// Мультивыбор, а не «один объект за раз»: заказчик формулирует операцию во
// множественном числе («добавить обьекты»), и маршрут визита согласуют пачкой.
// Каждый объект уезжает на сервер СВОИМ запросом — эндпоинт добавляет по
// одному, и частичный успех здесь честнее общего отката: добавленные объекты
// остаются, а неудачные названы поимённо.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { opsApiClient } from "@/lib/ops-api";
import { useToast } from "@/shared/hooks/use-toast";
import {
  BINDABLE_OBJECTS_PATH,
  type BindableObject,
  type SecurityEvent,
} from "@/entities/security-event";
import { addVisitObject } from "../api/visit-objects-api";
import { invalidateSecurityEvents } from "@/lib/ops-invalidate";

export function AddVisitObjectsDialog({
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
  const [picked, setPicked] = useState<string[]>([]);

  // Черновик выбора живёт вместе с открытием окна: закрыли и открыли снова —
  // начинаем с чистого листа, а не с прошлых галочек.
  useEffect(() => {
    if (open) {
      setSearch("");
      setPicked([]);
    }
  }, [open]);

  const objectsQuery = useQuery<{ results: BindableObject[] }>({
    queryKey: ["ops-bindable-objects"],
    queryFn: () =>
      opsApiClient.get<{ results: BindableObject[] }>(BINDABLE_OBJECTS_PATH),
    enabled: open,
  });

  const alreadyAdded = useMemo(
    () =>
      new Set(
        event.visitObjects
          .map((visit) => visit.objectId)
          .filter((id): id is string => id !== null)
      ),
    [event.visitObjects]
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = objectsQuery.data?.results ?? [];
    if (needle === "") return all;
    return all.filter((object) =>
      `${object.code} ${object.name}`.toLowerCase().includes(needle)
    );
  }, [objectsQuery.data, search]);

  const mutation = useMutation({
    mutationFn: async (objectIds: string[]) => {
      const failed: string[] = [];
      for (const objectId of objectIds) {
        try {
          await addVisitObject({ eventId: event.id, objectId });
        } catch {
          failed.push(objectId);
        }
      }
      return failed;
    },
    onSuccess: (failed, objectIds) => {
      invalidateSecurityEvents(queryClient);
      const added = objectIds.length - failed.length;
      if (failed.length === 0) {
        toast({
          title:
            added === 1
              ? "Объект добавлен в мероприятие"
              : `Объектов добавлено: ${added}`,
        });
        onClose();
        return;
      }
      // Молчаливого «готово» на частичном успехе не бывает: окно остаётся
      // открытым с непройденными строками, чтобы человек видел, что именно
      // не добавилось.
      setPicked(failed);
      toast({
        title: `Добавлено ${added} из ${objectIds.length}`,
        description: "Отмеченные объекты добавить не удалось — попробуйте ещё раз.",
        variant: "destructive",
      });
    },
    onError: () =>
      toast({
        title: "Не удалось добавить объекты",
        description: "Сервис временно недоступен. Попробуйте ещё раз.",
        variant: "destructive",
      }),
  });

  function toggle(objectId: string): void {
    setPicked((current) =>
      current.includes(objectId)
        ? current.filter((id) => id !== objectId)
        : [...current, objectId]
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Добавить объекты посещения</DialogTitle>
          <DialogDescription>
            {event.code} · {event.title}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-8"
            placeholder="Поиск по названию или коду объекта"
            aria-label="Поиск объекта"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border">
          {objectsQuery.isPending && (
            <p className="p-4 text-sm text-muted-foreground">
              Загрузка реестра объектов…
            </p>
          )}
          {objectsQuery.isError && (
            <p className="p-4 text-sm text-destructive-ink" role="alert">
              Реестр объектов недоступен — выбрать объект не из чего.
            </p>
          )}
          {objectsQuery.isSuccess && rows.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              По запросу ничего не найдено.
            </p>
          )}
          <ul className="divide-y">
            {rows.map((object) => {
              const added = alreadyAdded.has(object.id);
              return (
                <li key={object.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60 ${
                      added ? "cursor-not-allowed opacity-60" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={picked.includes(object.id)}
                      disabled={added || mutation.isPending}
                      onChange={() => toggle(object.id)}
                    />
                    <span className="flex-1">
                      <span className="font-medium">{object.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {object.code}
                      </span>
                      {/* Отсутствие паспорта названо прямо в списке — как в
                          окне создания: узнать об этом после добавления
                          поздно, но выбирать такой объект не запрещено. */}
                      {object.publishedVersionCount === 0 && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          паспорт не опубликован — версия не привяжется
                        </span>
                      )}
                    </span>
                    {added && (
                      <span className="text-[11px] text-muted-foreground">
                        уже добавлен
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button
            onClick={() => mutation.mutate(picked)}
            disabled={picked.length === 0 || mutation.isPending}
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {picked.length === 0
              ? "Добавить"
              : `Добавить (${picked.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
