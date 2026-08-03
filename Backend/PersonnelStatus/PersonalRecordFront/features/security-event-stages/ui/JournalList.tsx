"use client";

// Список записей журнала штаба — общий для «Проведения» и закрытого дела.
import { Badge } from "@/components/ui/badge";
import { JOURNAL_TYPE_LABEL } from "@/entities/security-event";
import type { JournalEntry } from "@/entities/security-event";

export function JournalList({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Записей пока нет.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-md border p-2.5 text-sm">
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{JOURNAL_TYPE_LABEL[entry.type]}</Badge>
            <span className="font-semibold">{entry.title}</span>
            <span className="text-[11px] text-muted-foreground">
              {entry.createdAt}
            </span>
          </div>
          {entry.description !== "" && (
            <p className="text-xs text-muted-foreground">{entry.description}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
