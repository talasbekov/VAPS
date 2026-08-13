"use client";

// Хранилище нарядов. Единственный владелец записей о том, кто на каком объекте
// заступил: пишет модалка статусов, читает карточка объекта.
//
// Почему клиентское: у statuses.EmployeeStatus на бэкенде нет полей наряда
// (тип дежурства/объект/пост/группа), а бэкенд в эту работу не входит. Слой
// намеренно узкий — заменить его на HTTP-клиент значит переписать этот файл,
// потребители про localStorage не знают.
//
// Записи живут по одной на сотрудника: у человека один текущий наряд. Из этого
// следует главное свойство связки — смена статуса на любой другой снимает наряд,
// и сотрудник пропадает из карточки объекта без отдельного действия.

import type { DutyAssignment } from "./types";

const STORAGE_KEY = "vaps.duty-assignments.v1";

type Listener = () => void;

let cache: DutyAssignment[] | null = null;
const listeners = new Set<Listener>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parse(raw: string | null): DutyAssignment[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Записи чужой/старой формы отбрасываем поштучно: один битый элемент не
    // должен обнулять весь список заступивших.
    return parsed.filter(
      (item): item is DutyAssignment =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as DutyAssignment).employeeKey === "string" &&
        typeof (item as DutyAssignment).objectId === "string" &&
        typeof (item as DutyAssignment).startDate === "string" &&
        typeof (item as DutyAssignment).endDate === "string"
    );
  } catch {
    return [];
  }
}

function load(): DutyAssignment[] {
  if (cache) return cache;
  if (!isBrowser()) return [];
  cache = parse(window.localStorage.getItem(STORAGE_KEY));
  return cache;
}

function commit(next: DutyAssignment[]): void {
  cache = next;
  if (isBrowser()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Переполнение/приватный режим: запись в памяти уже обновлена, экран
      // покажет актуальное состояние — молча терять её из-за квоты не нужно.
    }
  }
  listeners.forEach((listener) => listener());
}

/** Снимок для useSyncExternalStore: ссылка стабильна, пока не было записи. */
export function getDutyAssignmentsSnapshot(): DutyAssignment[] {
  return load();
}

/** Сервер рендерит пустой список — localStorage там нет. */
export function getDutyAssignmentsServerSnapshot(): DutyAssignment[] {
  return EMPTY;
}

const EMPTY: DutyAssignment[] = [];

export function subscribeToDutyAssignments(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  };
  if (isBrowser()) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (isBrowser()) window.removeEventListener("storage", onStorage);
  };
}

/** Заступление: наряд сотрудника заменяется целиком, а не дополняется. */
export function upsertDutyAssignment(assignment: DutyAssignment): void {
  const rest = load().filter(
    (item) => item.employeeKey !== assignment.employeeKey
  );
  commit([...rest, assignment]);
}

/**
 * Снятие наряда. Вызывается на КАЖДОМ сохранении статуса, отличного от
 * «На дежурстве»: наряд — расшифровка статуса, и пережить его он не может.
 */
export function removeDutyAssignment(employeeKey: string): void {
  const current = load();
  const next = current.filter((item) => item.employeeKey !== employeeKey);
  if (next.length === current.length) return;
  commit(next);
}

export function findDutyAssignment(
  employeeKey: string
): DutyAssignment | undefined {
  return load().find((item) => item.employeeKey === employeeKey);
}
