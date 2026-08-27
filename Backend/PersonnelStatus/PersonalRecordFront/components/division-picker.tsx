"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Выбор подразделения с поиском (Plane №232).
 *
 * ЗАЧЕМ. Обычный `<Select>` на структуре под пять тысяч человек показывает 581
 * вариант, и найти в нём «Второе управление › Первый отдел» можно только
 * прокруткой. Фильтром переставали пользоваться и уходили в текстовый поиск —
 * а он ищет по ФИО, должности и подразделению разом, то есть отвечает на другой
 * вопрос.
 *
 * ПОИСК ИДЁТ ПО ВСЕЙ ПОДПИСИ, включая путь: «Второе управление первый» находит
 * отдел внутри второго управления, не заставляя вспоминать точное название.
 *
 * КЛАВИАТУРА обязательна: список длинный, и без стрелок с Enter он
 * недоступен тем, кто не пользуется мышью. Esc закрывает, стрелки водят по
 * найденному, Enter выбирает наведённое.
 *
 * СПИСОК ОБРЕЗАН ДО СОТНИ строк: восемьсот узлов DOM в открытом поповере — та
 * же болезнь, от которой лечили реестр, только в миниатюре. Обрезка названа
 * вслух («показаны первые сто»), а не молча прячет остальное.
 */
const VISIBLE_LIMIT = 100;

export interface DivisionOption {
  id: number;
  label: string;
}

export function DivisionPicker({
  value,
  options,
  onChange,
  allLabel = "Все отделы",
  ariaLabel = "Фильтр по отделу",
  className,
}: {
  /** `all` — отбора нет; иначе идентификатор подразделения строкой. */
  value: string;
  options: DivisionOption[];
  onChange: (value: string) => void;
  allLabel?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return options;
    // Каждое слово запроса — своё условие: «второе первый» находит «Второе
    // управление › Первый отдел», хотя подряд эти слова не стоят.
    const words = needle.split(/\s+/);
    return options.filter((option) => {
      const haystack = option.label.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [options, query]);

  const shown = found.slice(0, VISIBLE_LIMIT);
  const selected = options.find((option) => String(option.id) === value);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setHighlighted(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("w-full justify-between font-normal sm:w-64", className)}
        >
          <span className="truncate">{selected?.label ?? allLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            value={query}
            aria-label="Поиск подразделения"
            placeholder="Название или путь…"
            className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlighted((index) => Math.min(index + 1, shown.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (highlighted === 0) choose("all");
                else if (shown[highlighted - 1]) choose(String(shown[highlighted - 1].id));
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
        </div>
        <div ref={listRef} role="listbox" aria-label={ariaLabel} className="max-h-72 overflow-y-auto p-1">
          <Row
            label={allLabel}
            selected={value === "all"}
            highlighted={highlighted === 0}
            onSelect={() => choose("all")}
          />
          {shown.map((option, index) => (
            <Row
              key={option.id}
              label={option.label}
              selected={value === String(option.id)}
              highlighted={highlighted === index + 1}
              onSelect={() => choose(String(option.id))}
            />
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Ничего не найдено
            </p>
          )}
          {found.length > shown.length && (
            <p className="px-2 py-2 text-center text-xs text-muted-foreground">
              Показаны первые {VISIBLE_LIMIT} из {found.length} — уточните запрос
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({
  label,
  selected,
  highlighted,
  onSelect,
}: {
  label: string;
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
        highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
      )}
    >
      <Check className={cn("h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}
