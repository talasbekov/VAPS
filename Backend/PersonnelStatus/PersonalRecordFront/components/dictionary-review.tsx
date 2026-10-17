"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { OpsApiError } from "@/lib/ops-errors";

import type { DictionaryChange } from "@/entities/dictionary";
export type { DictionaryChange } from "@/entities/dictionary";
export type ReviewRow = { id: string | number; code?: string; name: string; nameKk?: string; active: boolean; inactiveSince?: string | null; count: number; tracked?: boolean; lastChange?: DictionaryChange | null; successor?: string | number | null; familyCount?: number };
const operations: Record<string, string> = { DICTIONARY_ENTRY_CREATED: "Добавление", DICTIONARY_ENTRY_UPDATED: "Корректирование", DICTIONARY_ENTRY_SUPERSEDED: "Редактирование", DICTIONARY_ENTRY_SET_ACTIVE: "Изменение активности" };
export function DictionaryReviewTable({ rows, onSelect, nameFirst = false }: { rows: ReviewRow[]; onSelect: (id: string | number) => void; nameFirst?: boolean }) {
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState("all");
  const [usage, setUsage] = useState("all");
  const needle = search.toLocaleLowerCase().trim();
  const filtered = rows.filter((row) =>
    `${row.name} ${row.nameKk ?? ""} ${row.code ?? ""}`.toLocaleLowerCase().includes(needle) &&
    (activity === "all" || row.active === (activity === "active")) &&
    (usage === "all" || (row.tracked !== false && (usage === "used" ? row.count > 0 : row.count === 0)))
  );
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Input className="max-w-sm" aria-label="Поиск значений" placeholder="Название или код" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select aria-label="Статус значений" className="rounded-md border bg-background px-2" value={activity} onChange={(e) => setActivity(e.target.value)}><option value="all">Все статусы</option><option value="active">Активные</option><option value="inactive">Неактуальные</option></select>
      <select aria-label="Использование значений" className="rounded-md border bg-background px-2" value={usage} onChange={(e) => setUsage(e.target.value)}><option value="all">Все связи</option><option value="used">Со связями</option><option value="unused">Без связей</option></select>
    </div>
    <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow>
      {nameFirst ? <><TableHead className="whitespace-normal">Наименование (RU)</TableHead><TableHead>Действия</TableHead><TableHead>Наименование (KZ)</TableHead><TableHead>Код</TableHead></> : <><TableHead>Код</TableHead><TableHead>Наименование (KZ)</TableHead><TableHead>Наименование (RU)</TableHead></>}
      <TableHead>Статус</TableHead><TableHead>Ссылок</TableHead><TableHead>Последнее изменение</TableHead><TableHead>Дата неактуальности</TableHead>{!nameFirst && <TableHead>Действия</TableHead>}
    </TableRow></TableHeader><TableBody>
      {filtered.map((row) => <TableRow key={row.id} className={row.active ? "" : "text-muted-foreground"}>
        {nameFirst ? <><TableCell><div className="w-36 whitespace-normal [overflow-wrap:anywhere] md:w-64">{row.name}</div></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => onSelect(row.id)}>Открыть</Button></TableCell><TableCell>{row.nameKk || "—"}</TableCell><TableCell>{row.code ?? row.id}</TableCell></> : <><TableCell>{row.code ?? row.id}</TableCell><TableCell>{row.nameKk || "—"}</TableCell><TableCell>{row.name}</TableCell></>}
        <TableCell>{row.successor ? `Заменена на ${row.successor}` : row.active ? "Активна" : "Неактуальна"}</TableCell>
        <TableCell>{row.tracked === false ? "Неизвестно" : row.count}{row.familyCount !== undefined && row.familyCount !== row.count && <div className="text-xs">С цепочкой замен: {row.familyCount}</div>}</TableCell>
        <TableCell>{row.lastChange ? <><div>{row.lastChange.operation === "DICTIONARY_ENTRY_SET_ACTIVE" ? (row.active ? "Активация" : "Деактивация") : operations[row.lastChange.operation] ?? row.lastChange.operation}</div><div className="text-xs">{new Date(row.lastChange.at).toLocaleString("ru-RU")} · {row.lastChange.actor}</div></> : "Нет сведений"}</TableCell>
        <TableCell>{row.inactiveSince ? new Date(`${row.inactiveSince}T00:00:00`).toLocaleDateString("ru-RU") : "—"}</TableCell>
        {!nameFirst && <TableCell><Button size="sm" variant="outline" onClick={() => onSelect(row.id)}>Открыть</Button></TableCell>}
      </TableRow>)}
      {filtered.length === 0 && <TableRow><TableCell colSpan={8}>Записи не найдены</TableCell></TableRow>}
    </TableBody></Table></div>
  </div>;
}

type SimilarRow = { id: string | number; label?: string; labelKk?: string; name?: string; name_kk?: string; isActive?: boolean; is_active?: boolean; usage?: { totalCount: number } };
export function DictionarySimilarityDialog({ error, pending, canConfirm = true, onCancel, onConfirm, onUse }: { error: Error | null; pending: boolean; canConfirm?: boolean; onCancel: () => void; onConfirm: () => void; onUse: (id: string | number) => void }) {
  const open = error instanceof OpsApiError && error.errorCode === "DICTIONARY_SIMILAR_ENTRIES";
  const matches = open && Array.isArray(error.details.similarEntries) ? error.details.similarEntries as SimilarRow[] : [];
  return <Dialog open={open} onOpenChange={(value) => { if (!value && !pending) onCancel(); }}><DialogContent><DialogHeader><DialogTitle>Найдены похожие записи</DialogTitle><DialogDescription>Проверьте существующие значения перед добавлением нового.</DialogDescription></DialogHeader>
    <ul className="max-h-80 space-y-3 overflow-y-auto">{matches.map((row) => <li key={row.id} className="space-y-1 rounded border p-2"><div>{row.label ?? row.name} · {row.labelKk || row.name_kk || "—"}</div><p className="text-xs">{(row.isActive ?? row.is_active) ? "Активна" : "Неактуальна"} · Ссылок: {row.usage?.totalCount ?? 0}</p><Button variant="outline" size="sm" disabled={pending} onClick={() => onUse(row.id)}>Использовать существующую</Button></li>)}</ul>
    <DialogFooter><Button variant="outline" disabled={pending} onClick={onCancel}>Вернуться к форме</Button><Button disabled={pending || !canConfirm} onClick={() => { if (canConfirm) onConfirm(); }}>Всё равно создать</Button></DialogFooter>
  </DialogContent></Dialog>;
}
