"use client";

// Подбор сотрудника: поиск и страницы НА СЕРВЕРЕ (Plane «Реестр ОМ-35.3»).
//
// Один компонент на все окна, где выбирают человека, — потому что раньше
// каждое окно грузило кадровый снимок ЦЕЛИКОМ и фильтровало его на клиенте.
// Такой «поиск» отвечает «никого не нашлось», имея в виду «нет в загруженном»,
// и на живой кадровой базе врёт тем громче, чем она больше.
//
// Найденное считает сервер («найдено N»), а не длина страницы: счётчик по
// странице обещал бы, что список кончился, ровно на её краю.
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePersonnelPage } from "@/hooks/use-security-event-stages";

export interface PersonnelPickerProps {
  /** Выбранный сотрудник; null — ещё не выбран. */
  value: string | null;
  onPick: (employeeId: string) => void;
  /** Кого предлагать нельзя (уже назначен и т. п.). */
  disabledIds?: Set<string>;
  /** Словом — ПОЧЕМУ строка недоступна: серая строка без причины читается
   *  как сбой списка. */
  disabledNote?: string;
  pageSize?: number;
  /** Сбрасывает поиск и страницу: окно открылось заново — начинаем с чистого
   *  листа, а не с прошлого запроса. */
  resetKey?: unknown;
}

export function PersonnelPicker({
  value,
  onPick,
  disabledIds,
  disabledNote = "недоступен",
  pageSize = 20,
  resetKey,
}: PersonnelPickerProps) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setSearch("");
    setQuery("");
    setPage(1);
  }, [resetKey]);

  // Запрос уходит с задержкой: иначе каждое нажатие клавиши — свой круг к
  // серверу, и ответы приходят в обгон друг друга.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const roster = usePersonnelPage({ search: query, page, pageSize });
  const people = roster.data?.results ?? [];
  const total = roster.data?.count ?? 0;
  const blocked = disabledIds ?? new Set<string>();

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          className="pl-8"
          placeholder="Поиск по ФИО, званию, подразделению или табельному номеру"
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
            {query.trim() === ""
              ? "Кадровый список пуст."
              : "По запросу никого не нашлось."}
          </p>
        )}
        <ul>
          {people.map((person) => {
            const already = blocked.has(person.id);
            return (
              <li key={person.id} className="border-b last:border-0">
                <button
                  type="button"
                  disabled={already}
                  onClick={() => onPick(person.id)}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
                    value === person.id ? "bg-muted" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{person.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {person.rankLabel}
                      {person.unit === "" ? "" : ` · ${person.unit}`}
                    </span>
                  </span>
                  {already && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {disabledNote}
                    </span>
                  )}
                  {!already && value === person.id && (
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

      {/* Строка листания показывается всегда, когда список не пуст: «найдено
          N» — ответ сервера на поиск, и он нужен даже на единственной
          странице, чтобы человек знал, что видит всех, а не первых. */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span aria-live="polite">
            Найдено {total} · страница {page}
          </span>
          <span className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={roster.data?.previous === null || roster.isFetching}
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
            >
              Назад
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={roster.data?.next === null || roster.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              Дальше
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
