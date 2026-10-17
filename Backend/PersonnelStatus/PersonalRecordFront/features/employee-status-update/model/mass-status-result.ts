export interface MassStatusResult {
  kind: "complete" | "partial" | "rejected" | "unconfirmed";
  applied: number | null;
  remainingEmployeeIds: number[] | null;
  messages: string[];
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(textOf).filter(Boolean).join(" ");
  return "";
}

/** Indexes are meaningful only within the original employee_statuses request. */
export function readMassStatusResult(response: unknown, employeeIds: readonly number[]): MassStatusResult {
  const data = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const updated = data.updated && typeof data.updated === "object" ? data.updated as Record<string, unknown> : {};
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const messages = errors.map(error => error && typeof error === "object" && !Array.isArray(error)
    ? Object.entries(error).filter(([key]) => key !== "section" && key !== "index").map(([, value]) => textOf(value)).filter(Boolean).join(" ")
    : textOf(error)).filter(Boolean);
  const raw = updated.statuses;
  const applied = typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= employeeIds.length ? raw : null;
  const unconfirmed = (): MassStatusResult => ({ kind: "unconfirmed", applied, remainingEmployeeIds: null, messages });
  if (employeeIds.length === 0 || new Set(employeeIds).size !== employeeIds.length || employeeIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return unconfirmed();
  if ((data.errors !== undefined && !Array.isArray(data.errors)) || (data.success !== undefined && typeof data.success !== "boolean")) return unconfirmed();
  if (applied === null || (data.rolled_back !== undefined && typeof data.rolled_back !== "boolean")) return unconfirmed();
  if (data.rolled_back === true && applied !== 0) return unconfirmed();
  if (applied === 0) return { kind: "rejected", applied, remainingEmployeeIds: [...employeeIds], messages: messages.length ? messages : ["Не удалось обновить ни одного сотрудника."] };
  if (data.success === false) return unconfirmed();
  if (applied === employeeIds.length && errors.length === 0) return { kind: "complete", applied, remainingEmployeeIds: [], messages };
  const failedIndexes = new Set<number>();
  for (const error of errors) {
    if (!error || typeof error !== "object" || Array.isArray(error)) return unconfirmed();
    const item = error as Record<string, unknown>;
    if (item.section !== "employee_statuses" || typeof item.index !== "number" || !Number.isInteger(item.index) || item.index < 0 || item.index >= employeeIds.length) return unconfirmed();
    failedIndexes.add(item.index);
  }
  if (failedIndexes.size !== employeeIds.length - applied || failedIndexes.size === 0) return unconfirmed();
  return { kind: "partial", applied, remainingEmployeeIds: employeeIds.filter((_, index) => failedIndexes.has(index)), messages };
}

/** A late response must not replace a selection the user has changed meanwhile. */
export function retainFailedMassSelection(current: string[], submitted: readonly string[], remaining: readonly string[]): string[] {
  const original = new Set(submitted);
  if (current.length !== submitted.length || new Set(current).size !== original.size || current.some(key => !original.has(key)) || remaining.some(key => !original.has(key))) return current;
  return [...remaining];
}
