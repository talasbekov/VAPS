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
import { X } from "lucide-react";
import type { ProtectedPerson } from "@/entities/protected-person";

export function ProtectedPersonsPicker({
  value,
  onChange,
  options,
  loading,
  selectId,
}: {
  /** Выбранные лица В ПОРЯДКЕ ДОБАВЛЕНИЯ: первое — главное. */
  value: string[];
  onChange: (next: string[]) => void;
  options: ProtectedPerson[];
  loading: boolean;
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

      {/* Значение селекта НЕ хранится: он не поле формы, а действие
          «добавить». Оставаясь выбранным, лицо выглядело бы выбранным дважды
          — и чипом, и в списке. */}
      <select
        id={selectId}
        className={
          "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm " +
          "outline-none transition-[color,box-shadow] focus-visible:border-ring " +
          "focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
          "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50"
        }
        value=""
        disabled={loading || free.length === 0}
        onChange={(e) => {
          if (e.target.value !== "") onChange([...value, e.target.value]);
        }}
      >
        <option value="">
          {loading
            ? "Загрузка справочника…"
            : free.length === 0
              ? value.length === 0
                ? "Справочник охраняемых лиц пуст"
                : "Все лица справочника уже добавлены"
              : value.length === 0
                ? "— выберите из справочника ОЛ —"
                : "— добавить ещё лицо —"}
        </option>
        {free.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
            {person.callsign === "" ? "" : ` · ${person.callsign}`}
            {person.category === "FOREIGN" ? " · иностранное ОЛ" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
