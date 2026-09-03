"use client";

// Старший наряда / ГВО — combobox с поиском НА СЕРВЕРЕ (Plane №419,
// `[БЛН-11]`/`[БЛН-13]`): вместо списка сотрудников со страницами
// «Назад / Дальше» — поле, в которое человек печатает фамилию, и восемь
// лучших совпадений под ним. Совпадений больше — строка «уточните запрос»,
// а не страницы: старшего знают по имени, листать 440 строк незачем.
import { useEffect, useId, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePersonnelPage } from "@/hooks/use-security-event-stages";

const LIMIT = 8;

export interface ChiefChoice {
  id: string;
  name: string;
}

export function ChiefCombobox({
  value,
  onChange,
  inputId,
  placeholder = "Начните вводить фамилию",
}: {
  value: ChiefChoice | null;
  onChange: (next: ChiefChoice | null) => void;
  /** Id поля поиска — на него ведёт подпись поля формы. */
  inputId: string;
  placeholder?: string;
}) {
  const listId = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const roster = usePersonnelPage({
    search: query,
    page: 1,
    pageSize: LIMIT,
    enabled: open,
  });
  const people = roster.data?.results ?? [];
  const total = roster.data?.count ?? 0;

  if (value !== null) {
    return (
      <div
        className="flex h-10 items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 text-sm"
        data-slot="chief-combobox"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate font-medium">{value.name}</span>
        </span>
        <button
          type="button"
          id={inputId}
          onClick={() => {
            onChange(null);
            setOpen(true);
          }}
          aria-label={`Снять старшего ${value.name}`}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" data-slot="chief-combobox">
      <Search
        className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className="h-10 rounded-lg pl-8"
        placeholder={placeholder}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Закрытие с задержкой: клик по пункту списка иначе терял цель —
        // blur срабатывал раньше click.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover text-xs shadow-md"
        >
          {roster.isPending && (
            <li className="px-3 py-2 text-muted-foreground">Поиск…</li>
          )}
          {roster.isError && (
            <li className="px-3 py-2 text-muted-foreground">
              Кадровый список сейчас недоступен.
            </li>
          )}
          {roster.data && people.length === 0 && (
            <li className="px-3 py-2 text-muted-foreground">
              {query === "" ? "Кадровый список пуст." : "По запросу никого не нашлось."}
            </li>
          )}
          {people.map((person) => (
            <li key={person.id} role="option" aria-selected={false} className="border-b last:border-0">
              <button
                type="button"
                // preventDefault на mousedown: поле не теряет фокус, список
                // не закрывается до клика; выбор — по click, иначе пункт
                // исчезал под курсором между нажатием и отпусканием.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ id: person.id, name: person.name });
                  setSearch("");
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{person.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {[person.rankLabel, person.unit].filter((p) => p !== "").join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {total > LIMIT && (
            <li className="px-3 py-1.5 text-[11px] text-muted-foreground" aria-live="polite">
              Показаны {people.length} из {total} — уточните запрос
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
