"use client";

import { useRef, useState } from "react";
import { useOpsReadAccess, useOpsProtectedRead } from "@/hooks/use-ops-protected-read";
import { opsApiClient } from "@/lib/ops-api";
import { SECURITY_EVENTS_PATH, securityEventDetailPath, type ListSecurityEventsResponse, type SecurityEvent } from "@/entities/security-event/model/types";
import { assistantDate } from "@/features/om-assistant/model";
import { Button } from "@/components/ui/button";

// Reuse the event registry API, with the same actor/scope checks as other
// assistant reads. Event creation authority does not authorize registry reads.
export function useAssistantEventOptions(search: string, date: string, page: number, enabled: boolean) {
  const params = new URLSearchParams({ search: search.trim(), page: String(page), page_size: "10" });
  if (date) { params.set("from", date); params.set("to", date); }
  const query = params.toString();
  return useOpsProtectedRead<ListSecurityEventsResponse>(["ops-assistant-events", "list"], [query], useOpsReadAccess("event.view"),
    () => opsApiClient.get(`${SECURITY_EVENTS_PATH}?${query}`), { enabled });
}

export function useAssistantSelectedEvent(id: string) {
  return useOpsProtectedRead<SecurityEvent>(["ops-assistant-events", "selected"], [id], useOpsReadAccess("event.view"),
    () => opsApiClient.get(securityEventDetailPath(encodeURIComponent(id))), { enabled: !!id });
}

const field = "mt-1 min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm";

export function AssistantEventPicker({ value, onChange, disabled = false }: {
  value: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  const access = useOpsReadAccess("event.view");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const summary = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const options = useAssistantEventOptions(search, date, page, open);
  const selected = useAssistantSelectedEvent(value);
  // An error refresh may retain cached data. Do not label that data as current.
  const event = !selected.isError && selected.data?.id === value ? selected.data : undefined;
  const rows = options.isError ? [] : options.data?.results ?? [];
  const canSelect = !disabled && access.allowed && options.canAct;
  return <div ref={container} tabIndex={-1} className="space-y-2 text-sm" aria-label="Существующее ОМ">
    {value && <div className="rounded-lg border bg-muted/30 p-3" role="status">
      {event ? <><p className="font-medium break-words">{event.title}</p><p>{assistantDate(event.businessDate)}{event.code && ` · ${event.code}`}</p></>
        : <p>{!access.allowed || selected.isError || selected.readAccessBlocked ? "Выбранное ОМ сохранено, но его сведения сейчас недоступны." : "Проверяем выбранное ОМ…"}</p>}
      <Button type="button" variant="ghost" className="mt-1 h-auto min-h-9 whitespace-normal" disabled={disabled} onClick={() => { onChange(""); (summary.current ?? container.current)?.focus(); }}>Не связывать с ОМ</Button>
      {access.allowed && (selected.isError || selected.readAccessBlocked) && <Button type="button" variant="outline" disabled={disabled || selected.isFetching} onClick={() => void selected.refetch()}>Проверить выбранное ОМ</Button>}
    </div>}
    {!access.allowed ? <p className="text-muted-foreground">Нет доступа к реестру ОМ. Выбор существующего мероприятия недоступен.</p>
      : <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary ref={summary} className="min-h-9 cursor-pointer font-medium">{value ? "Выбрать другое ОМ" : "Выбрать существующее ОМ"}</summary>
        <div className="space-y-3 pt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Название ОМ<input type="search" maxLength={200} className={field} value={search} disabled={disabled}
              onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
            <label>Дата ОМ<input type="date" className={field} value={date} disabled={disabled}
              onChange={event => { setDate(event.target.value); setPage(1); }} /></label>
          </div>
          {options.isError || options.readAccessBlocked ? <div role="status">
            <p>{options.readAccessBlocked ? "Реестр ОМ недоступен. Выбранная связь сохранена." : "Не удалось загрузить ОМ. Попробуйте ещё раз."}</p>
            <Button type="button" variant="outline" disabled={disabled || options.isFetching} onClick={() => void options.refetch()}>Повторить поиск</Button>
          </div> : options.isPending ? <p role="status">Загружаем ОМ…</p> : <>
            {options.isFetching && <p role="status">Обновляем список ОМ…</p>}
            {rows.length ? <ul className="space-y-1" aria-label="Найденные ОМ">{rows.map(row => <li key={row.id}>
              <button type="button" className="w-full rounded-lg border p-3 text-left disabled:opacity-60" disabled={!canSelect} aria-pressed={row.id === value}
                onClick={() => { if (canSelect) { onChange(row.id); setOpen(false); summary.current?.focus(); } }}>
                <span className="block break-words font-medium">{row.title}</span>
                <span className="text-muted-foreground">{assistantDate(row.businessDate)}{row.code && ` · ${row.code}`}</span>
              </button>
            </li>)}</ul> : <p role="status">ОМ не найдены. Измените название или дату.</p>}
            {(page > 1 || options.data?.next) && <nav className="flex flex-wrap items-center gap-2" aria-label="Страницы поиска ОМ">
              <Button type="button" variant="outline" disabled={!canSelect || page <= 1} onClick={() => setPage(page - 1)}>Назад</Button>
              <span aria-live="polite">Страница {page}</span>
              <Button type="button" variant="outline" disabled={!canSelect || !options.data?.next} onClick={() => setPage(page + 1)}>Далее</Button>
            </nav>}
          </>}
        </div>
      </details>}
  </div>;
}
