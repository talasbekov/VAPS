"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ParticipationKind } from "@/hooks/use-participation-catalog";
import { cn } from "@/lib/utils";

export type ParticipationBranch = "PHYSICAL" | "GROUP";
export type ParticipationBranchValue = ParticipationBranch | "";

export function branchOfKind(kindCode: string): ParticipationBranch {
  return kindCode === "PHYSICAL_SQUAD" ? "PHYSICAL" : "GROUP";
}

/**
 * Канонический выбор участия ОМ (№1100, [ОМ-ГР-01]–[ОМ-ГР-07]).
 * Сначала человек выбирает подгруппу статуса, затем свою группу или явно
 * открывает поиск по остальным. Путь владельца различает одинаковые названия.
 */
export function ParticipationKindPicker({
  id,
  branch,
  kindCode,
  roleCode,
  kinds,
  onBranchChange,
  onKindChange,
  onRoleChange,
}: {
  id: string;
  branch: ParticipationBranchValue;
  kindCode: string;
  roleCode: string;
  kinds: ParticipationKind[];
  onBranchChange: (branch: ParticipationBranch) => void;
  onKindChange: (kindCode: string) => void;
  onRoleChange: (roleCode: string) => void;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [search, setSearch] = useState("");
  const groups = kinds.filter((kind) => kind.code !== "PHYSICAL_SQUAD");
  const ownGroups = groups.filter((kind) => kind.isOwn);
  const otherGroups = groups.filter((kind) => !kind.isOwn);
  const selected = groups.find((kind) => kind.code === kindCode) ?? null;
  const selectedIsOwn = selected?.isOwn === true;
  const needle = search.trim().toLocaleLowerCase("ru");
  const filteredOther = useMemo(
    () =>
      otherGroups.filter((kind) =>
        `${kind.label} ${kind.code} ${kind.ownerDivisionPath ?? ""}`
          .toLocaleLowerCase("ru")
          .includes(needle)
      ),
    [otherGroups, needle]
  );

  return (
    <div className="grid min-w-0 gap-2" data-slot="participation-kind-picker">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Подгруппа участия ОМ">
        <Button
          type="button"
          variant={branch === "PHYSICAL" ? "default" : "outline"}
          className="h-11"
          aria-pressed={branch === "PHYSICAL"}
          onClick={() => onBranchChange("PHYSICAL")}
        >
          Физнаряд
        </Button>
        <Button
          type="button"
          variant={branch === "GROUP" ? "default" : "outline"}
          className="h-11"
          aria-pressed={branch === "GROUP"}
          onClick={() => onBranchChange("GROUP")}
        >
          Группы
        </Button>
      </div>

      {branch === "GROUP" ? (
        <>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-own-group`}>Свои группы</Label>
            <Select
              value={selectedIsOwn ? kindCode : ""}
              onValueChange={(value) => onKindChange(value)}
            >
              <SelectTrigger id={`${id}-own-group`} className="h-11 w-full min-w-0 [&>span]:truncate">
                <SelectValue placeholder={ownGroups.length > 0 ? "Выберите свою группу" : "Своих групп нет"} />
              </SelectTrigger>
              <SelectContent>
                {ownGroups.map((kind) => (
                  <SelectItem key={kind.code} value={kind.code}>
                    {kind.label} · {kind.ownerDivisionPath ?? "подразделение не указано"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Popover open={otherOpen} onOpenChange={setOtherOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 w-full justify-between py-2 text-left whitespace-normal"
                aria-label="Выбрать другую группу другого подразделения"
              >
                <span className="min-w-0 truncate">
                  {!selectedIsOwn && selected !== null
                    ? `${selected.label} · ${selected.ownerDivisionPath ?? "владелец не указан"}`
                    : "Другие группы — поиск по подразделениям"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] p-2">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  className="h-11 pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Название группы, департамент, управление или отдел"
                  aria-label="Поиск другой группы"
                />
              </div>
              <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="Другие группы">
                {filteredOther.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">Другие группы не найдены.</p>
                ) : (
                  filteredOther.map((kind) => (
                    <button
                      key={kind.code}
                      type="button"
                      role="option"
                      aria-selected={kind.code === kindCode}
                      className={cn(
                        "flex min-h-11 w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        kind.code === kindCode && "bg-muted"
                      )}
                      onClick={() => {
                        onKindChange(kind.code);
                        setOtherOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check className={cn("mt-0.5 h-4 w-4 shrink-0", kind.code === kindCode ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                      <span>
                        <span className="block font-medium">{kind.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {kind.ownerDivisionPath ?? "Подразделение-владелец не указано"}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>

          {selected !== null ? (
            selected.roles.length > 0 ? (
              <div className="grid gap-1">
                <Label htmlFor={`${id}-role`}>Специальность</Label>
                <Select value={roleCode} onValueChange={onRoleChange}>
                  <SelectTrigger id={`${id}-role`} className="h-11 w-full min-w-0 [&>span]:truncate">
                    <SelectValue placeholder="Выберите специальность" />
                  </SelectTrigger>
                  <SelectContent>
                    {selected.roles.map((role) => (
                      <SelectItem key={role.code} value={role.code}>{role.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Для этой группы специальности не заведены.</p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Сначала выберите свою или другую группу.</p>
          )}
        </>
      ) : branch === "PHYSICAL" ? (
        <p className="text-xs text-muted-foreground">
          Физнаряд поступает в общий резерв; мероприятие и объект назначит Штаб.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Сначала выберите «Физнаряд» или «Группы».
        </p>
      )}
    </div>
  );
}
