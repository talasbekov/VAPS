"use client";

// Выбор НЕСКОЛЬКИХ охраняемых лиц бюллетеня (Plane №188). Заказчик: «Там есть
// выбрать справочник ОЛ, туда нужно добавить возможность выбирать несколько
// или возможность добавления ОЛ в список».
//
// ПОЧЕМУ НЕ `<select multiple>`. Оно и есть «выбрать несколько» — но выбранное
// в нём видно, только пока список раскрыт, снятие делается ctrl-кликом (о
// котором никто не знает), а с клавиатуры выбор рушится первым же нажатием
// стрелки. Здесь вместо этого: выбранные стоят ЧИПАМИ над полем, добавление —
// обычный одиночный `<select>`, снятие — крестик на чипе. Каждое действие
// отдельной кнопкой, каждое обратимо на месте.
//
// ПОРЯДОК ЗНАЧИМ, и это не украшение: ПЕРВОЕ лицо — главное, оно печатается в
// колонке «ОЛ» бланка бюллетеня, где место ровно одно. Поэтому чипы стоят в
// порядке добавления (сервер сортирует по имени только ВЫВОД), а первый
// помечен словом — иначе правило есть, а увидеть его негде.
import { Search, X } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import type { ProtectedPerson } from "@/entities/protected-person";

export function ProtectedPersonsPicker({
  value,
  onChange,
  options,
  loading,
  failed = false,
  selectId,
}: {
  /** Выбранные лица В ПОРЯДКЕ ДОБАВЛЕНИЯ: первое — главное. */
  value: string[];
  onChange: (next: string[]) => void;
  options: ProtectedPerson[];
  loading: boolean;
  /** Справочник ОТКАЗАЛ (Plane №788). Отдельно от `loading` и от пустоты:
   * «не ответил» — не то же самое, что «пуст», и подпись поля обязана
   * различать это, а не выбирать между двумя неправдами. */
  failed?: boolean;
  /** Id для `<select>` — на него ведёт подпись поля и фокус после отказа. */
  selectId: string;
}) {
  const byId = new Map(options.map((person) => [person.id, person]));
  const free = options.filter((person) => !value.includes(person.id));

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((id, index) => (
            <li
              key={id}
              className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs"
            >
              {index === 0 && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  главное
                </span>
              )}
              <span className="font-medium">
                {/* Имя из справочника; если лицо из него скрыли — сам
                    идентификатор. Пустая подпись была бы хуже: снять с
                    мероприятия то, чего не видно, нельзя. */}
                {byId.get(id)?.name ?? `лицо №${id}`}
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item !== id))}
                // Имя называет ЛИЦО: таких кнопок в форме столько же, сколько
                // выбрано, и на слух они были бы неразличимы.
                aria-label={`Убрать ${byId.get(id)?.name ?? id} из списка охраняемых лиц`}
                className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Добавление — combobox с поиском по справочнику, а не нативный
          <select> (Plane №419, `[БЛН-11]`): лиц в справочнике десятки, и
          человек ищет по фамилии или позывному. Значение поиска НЕ поле
          формы — выбранные стоят чипами выше. */}
      <PersonsCombobox
        inputId={selectId}
        options={free}
        loading={loading}
        /* 🔴 ПОЛЕ ГОВОРИЛО НЕПРАВДУ ДВАЖДЫ ПОДРЯД (Plane №788). Пока запрос
           переспрашивает (react-query повторяет трижды с задержкой), подпись
           держит «Загрузка справочника…» — человек читает «идёт загрузка» и
           ЖДЁТ, хотя ждать нечего. Когда повторы кончаются, подпись становится
           «Справочник охраняемых лиц пуст» — а он не пуст, он НЕ ОТВЕТИЛ; это
           уже прямое утверждение о данных, сделанное по молчанию сети.
           №632 добавил честную строку РЯДОМ с полем, но само поле продолжало
           обещать своё. Отказ старше и загрузки, и пустоты: если справочника
           нет, «пуст» и «грузится» одинаково неверны. */
        emptyLabel={
          failed
            ? "Справочник не ответил"
            : loading
              ? "Загрузка справочника…"
              : free.length === 0
                ? value.length === 0
                  ? "Справочник охраняемых лиц пуст"
                  : "Все лица справочника уже добавлены"
                : value.length === 0
                  ? "Найти в справочнике ОЛ…"
                  : "Добавить ещё лицо…"
        }
        onPick={(id) => onChange([...value, id])}
      />
    </div>
  );
}


function PersonsCombobox({
  inputId,
  options,
  loading,
  emptyLabel,
  onPick,
}: {
  inputId: string;
  options: ProtectedPerson[];
  loading: boolean;
  emptyLabel: string;
  onPick: (id: string) => void;
}) {
  const listId = useId();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const needle = search.trim().toLowerCase();
  const matches = options.filter(
    (person) =>
      needle === "" ||
      person.name.toLowerCase().includes(needle) ||
      person.callsign.toLowerCase().includes(needle) ||
      person.code.toLowerCase().includes(needle)
  );
  return (
    <div className="relative" data-slot="persons-combobox">
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
        placeholder={emptyLabel}
        disabled={loading || options.length === 0}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-popover text-xs shadow-md"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-muted-foreground">Никого не нашлось.</li>
          )}
          {matches.map((person) => (
            <li key={person.id} role="option" aria-selected={false} className="border-b last:border-0">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(person.id);
                  setSearch("");
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    <span className="mr-1.5 font-mono text-[10px] text-primary">{person.code}</span>
                    {person.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {[
                      person.callsign === "" ? "" : `позывной «${person.callsign}»`,
                      person.category === "FOREIGN" ? "иностранное ОЛ" : "",
                    ]
                      .filter((part) => part !== "")
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
