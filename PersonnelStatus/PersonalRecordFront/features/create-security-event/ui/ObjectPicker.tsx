"use client";

// Выбор объекта в окне «Создать бюллетень»: список с поиском, возможность
// завести отсутствующий и право НИЧЕГО не выбрать (ClickUp 86eyqf7a7).
//
// Почему не <select>: реестр объектов растёт, и в родном списке выбирать
// становится нечем — искать в нём можно только первой буквой. Поповер со
// строкой поиска решает это, не уводя человека со страницы.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { opsApiClient } from "@/lib/ops-api";
import { OpsValidationError } from "@/lib/ops-errors";
import type { BindableObject } from "@/entities/security-event";

const OBJECTS_PATH = "/api/ops/objects/";

export function ObjectPicker({
  objects,
  isLoading,
  value,
  onChange,
  controlClassName,
}: {
  objects: BindableObject[];
  isLoading: boolean;
  /** Пустая строка — объект не выбран; это допустимое состояние. */
  value: string;
  onChange: (objectId: string) => void;
  controlClassName: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftError, setDraftError] = useState("");

  const selected = objects.find((object) => object.id === value);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return objects;
    return objects.filter((object) =>
      `${object.code} ${object.name}`.toLowerCase().includes(needle)
    );
  }, [objects, search]);

  const creation = useMutation({
    mutationFn: (name: string) =>
      opsApiClient.post<BindableObject>(OBJECTS_PATH, { name }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: ["ops-security-events", "bindable-objects"],
      });
      // Заведённый объект сразу становится выбранным: человек добавлял его
      // ради этого мероприятия, и второй раз искать его в списке незачем.
      onChange(created.id);
      setCreating(false);
      setDraftName("");
      setSearch("");
      setOpen(false);
    },
    onError: (error: unknown) => {
      // Ошибку поля показываем НА МЕСТЕ, у поля названия: «объект с таким
      // названием уже есть» — самый частый исход, и он про введённое слово.
      const detail =
        error instanceof OpsValidationError
          ? (error.details as { name?: string[] } | undefined)?.name?.[0]
          : undefined;
      setDraftError(detail ?? "Не удалось завести объект. Попробуйте ещё раз.");
    },
  });

  function pick(objectId: string): void {
    onChange(objectId);
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCreating(false);
          setDraftError("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Объект"
          disabled={isLoading}
          className={`${controlClassName} flex w-full items-center justify-between gap-2 text-left`}
        >
          <span className={selected === undefined ? "text-muted-foreground" : ""}>
            {isLoading
              ? "Загрузка реестра…"
              : selected === undefined
                ? "— объект не выбран —"
                : `${selected.code} · ${selected.name}`}
          </span>
          <ChevronsUpDown
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="relative border-b">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="h-9 border-0 pl-8 focus-visible:ring-0"
            placeholder="Поиск по названию или коду"
            aria-label="Поиск объекта"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <ul className="max-h-56 overflow-y-auto py-1">
          {/* «Не выбран» — такой же выбор, как остальные: снять уже выбранный
              объект иначе было бы нечем. */}
          <li>
            <button
              type="button"
              onClick={() => pick("")}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
            >
              {value === "" && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              <span className={value === "" ? "" : "pl-[22px]"}>
                — объект не выбран —
              </span>
            </button>
          </li>
          {rows.map((object) => (
            <li key={object.id}>
              <button
                type="button"
                onClick={() => pick(object.id)}
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                {object.id === value ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <span className="w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>
                  <span className="font-medium">{object.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {object.code}
                  </span>
                  {/* Как в прежнем списке: отсутствие паспорта названо прямо
                      здесь — узнать об этом после создания ОМ поздно. */}
                  {object.publishedVersionCount === 0 && (
                    <span className="block text-[11px] text-muted-foreground">
                      паспорт не опубликован
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              По запросу ничего не найдено.
            </li>
          )}
        </ul>

        <div className="border-t p-2">
          {creating ? (
            <div className="space-y-1.5">
              <Input
                className="h-9"
                autoFocus
                placeholder="Название нового объекта"
                aria-label="Название нового объекта"
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.target.value);
                  setDraftError("");
                }}
              />
              {draftError !== "" && (
                <p className="text-xs text-destructive-ink" role="alert">
                  {draftError}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Заводится минимальная карточка: код присвоится сам, паспорт
                оформит владелец объекта.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCreating(false);
                    setDraftError("");
                  }}
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={draftName.trim() === "" || creation.isPending}
                  onClick={() => creation.mutate(draftName.trim())}
                >
                  {creation.isPending && (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  )}
                  Завести
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                setDraftName(search.trim());
                setCreating(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Объекта нет в списке — завести
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
