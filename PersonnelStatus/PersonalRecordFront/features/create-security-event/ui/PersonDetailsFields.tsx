"use client";

// Атрибуты визита у лиц бюллетеня (Plane №418, `[МД-03]`): прибытие,
// убытие, борта, старший делегации. Строки — по лицам, ОТМЕЧЕННЫМ в списке
// выше: снятое лицо уходит вместе с атрибутами, добавленное получает пустые.
import type { EventProtectedPerson, EventProtectedPersonDetails } from "@/entities/security-event";
import { Input } from "@/components/ui/input";

export type PersonDetailsMap = Record<string, EventProtectedPersonDetails>;

/** Стартовые значения из мероприятия — правка начинается с того, что есть. */
export function detailsOf(persons: EventProtectedPerson[]): PersonDetailsMap {
  const map: PersonDetailsMap = {};
  for (const p of persons) {
    map[p.id] = {
      id: p.id,
      arrivalAt: p.arrivalAt ?? "",
      departureAt: p.departureAt ?? "",
      flightArrival: p.flightArrival,
      flightDeparture: p.flightDeparture,
      isSenior: p.isSenior,
    };
  }
  return map;
}

export function PersonDetailsFields({
  persons,
  selectedIds,
  value,
  onChange,
  labelClassName,
  controlClassName,
}: {
  persons: EventProtectedPerson[];
  selectedIds: string[];
  value: PersonDetailsMap;
  onChange: (next: PersonDetailsMap) => void;
  labelClassName: string;
  controlClassName: string;
}) {
  if (selectedIds.length === 0) return null;
  const nameOf = new Map(persons.map((p) => [p.id, p.name]));
  const patch = (id: string, fields: Partial<EventProtectedPersonDetails>) =>
    onChange({ ...value, [id]: { ...(value[id] ?? { id }), id, ...fields } });
  return (
    // `min-w-0` на fieldset и `max-w-full` на обёртке: без них таблица с
    // шестью полями раздвигала окно за край экрана (первый снимок), а не
    // прокручивалась внутри.
    <fieldset className="min-w-0 max-w-full space-y-2" data-testid="person-details">
      <legend className={labelClassName}>Лица на мероприятии — время и борт</legend>
      <div className="max-w-full overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">Лицо</th>
              <th className="px-2 py-1.5 text-left font-semibold">Прибытие</th>
              <th className="px-2 py-1.5 text-left font-semibold">Борт</th>
              <th className="px-2 py-1.5 text-left font-semibold">Убытие</th>
              <th className="px-2 py-1.5 text-left font-semibold">Борт</th>
              <th className="px-2 py-1.5 text-left font-semibold">Старший</th>
            </tr>
          </thead>
          <tbody>
            {selectedIds.map((id) => {
              const row = value[id] ?? { id };
              return (
                <tr key={id} className="border-t" data-testid={`person-details-${id}`}>
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap">
                    {nameOf.get(id) ?? "— новое лицо —"}
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="datetime-local"
                      aria-label={`Прибытие: ${nameOf.get(id) ?? id}`}
                      className={`${controlClassName} w-[168px] text-xs`}
                      value={row.arrivalAt ?? ""}
                      onChange={(e) => patch(id, { arrivalAt: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      aria-label={`Борт прибытия: ${nameOf.get(id) ?? id}`}
                      // Столько же, сколько принимает сервер
                      // (`event_location.py`): 101-й символ он отбивает 400-м,
                      // и без ограничения человек узнавал об этом только по
                      // тому, что окно не закрылось (Plane №618).
                      maxLength={100}
                      className={`${controlClassName} w-[84px] text-xs`}
                      placeholder="KC 871"
                      value={row.flightArrival ?? ""}
                      onChange={(e) => patch(id, { flightArrival: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="datetime-local"
                      aria-label={`Убытие: ${nameOf.get(id) ?? id}`}
                      className={`${controlClassName} w-[168px] text-xs`}
                      value={row.departureAt ?? ""}
                      onChange={(e) => patch(id, { departureAt: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      aria-label={`Борт убытия: ${nameOf.get(id) ?? id}`}
                      // Столько же, сколько принимает сервер
                      // (`event_location.py`): 101-й символ он отбивает 400-м,
                      // и без ограничения человек узнавал об этом только по
                      // тому, что окно не закрылось (Plane №618).
                      maxLength={100}
                      className={`${controlClassName} w-[84px] text-xs`}
                      placeholder="KC 872"
                      value={row.flightDeparture ?? ""}
                      onChange={(e) => patch(id, { flightDeparture: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Старший: ${nameOf.get(id) ?? id}`}
                      className="h-4 w-4"
                      checked={row.isSenior ?? false}
                      onChange={(e) => patch(id, { isSenior: e.target.checked })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}
