"use client";

// Общий вывод ошибок операций этапа: бизнес-правило (422) — текстом с
// сервера; ошибки полей (400) — списком «поле: сообщение».
import type { OpsApiFailure } from "@/lib/ops-errors";

export function StageError({ error }: { error: OpsApiFailure | null }) {
  if (error === null) return null;
  return (
    <p className="text-sm text-destructive-ink" role="alert">
      {error.message}
    </p>
  );
}

export function FieldErrors({
  errors,
}: {
  errors: Record<string, unknown> | null;
}) {
  if (errors === null || Object.keys(errors).length === 0) return null;
  return (
    <ul className="list-disc pl-5 text-xs text-destructive-ink" role="alert">
      {Object.entries(errors).map(([field, value]) => (
        <li key={field}>
          {field}: {Array.isArray(value) ? String(value[0]) : String(value)}
        </li>
      ))}
    </ul>
  );
}
