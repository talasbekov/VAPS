"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DictionariesWorkspace } from "@/features/dictionaries-workspace/ui/DictionariesWorkspace";
import { PageHeader } from "@/components/page-header";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DictionaryReviewTable, DictionarySimilarityDialog, type DictionaryChange } from "@/components/dictionary-review";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError } from "@/lib/ops-errors";

type GeoRow = { id: number; name: string; name_kk: string; code?: string; country?: number; country_name?: string; is_active: boolean; inactive_since: string | null; superseded_by: number | null; usage: { totalCount: number; references: { sourceLabel: string; count: number }[] }; lastChange?: DictionaryChange | null };
type Draft = { name: string; name_kk: string; code?: string; country?: number; confirmSimilar?: boolean };
type Operation = { mode: "create" | "update" | "supersede"; id?: number; body: Draft };

export default function GeoDictionaryPage() {
  const { kind } = useParams<{ kind: string }>();
  const valid = kind === "countries" || kind === "cities";
  const countryMode = kind === "countries";
  const path = `/api/dictionaries/${kind}/`;
  const client = useQueryClient();
  const { hasPermission, isLoading } = useOpsPermissions();
  const canManage = hasPermission("dictionary_value.manage");
  const query = useQuery({ queryKey: ["geo-dictionary", kind], enabled: valid && hasPermission("dictionary.view"), queryFn: () => opsApiClient.get<GeoRow[]>(path) });
  const countries = useQuery({ queryKey: ["geo-dictionary", "countries"], enabled: valid && !countryMode && hasPermission("dictionary.view"), queryFn: () => opsApiClient.get<GeoRow[]>("/api/dictionaries/countries/") });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = query.data?.find((row) => row.id === selectedId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<Operation["mode"]>("create");
  const [pending, setPending] = useState<Operation | null>(null);
  const [removing, setRemoving] = useState<GeoRow | null>(null);
  function invalidate() {
    for (const key of ["geo-dictionary", "ops-countries", "ops-cities", "ops-dictionaries", "ops-security-events"]) void client.invalidateQueries({ queryKey: [key] });
  }
  const save = useMutation({ mutationFn: (op: Operation) => op.mode === "update" ? opsApiClient.patch<GeoRow>(`${path}${op.id}/`, op.body) : opsApiClient.post<GeoRow>(op.mode === "create" ? path : `${path}${op.id}/supersede/`, op.body), onSuccess: (row) => { invalidate(); setDraft(null); setPending(null); setSelectedId(row.id); } });
  const toggle = useMutation({ mutationFn: (row: GeoRow) => opsApiClient.post(`${path}${row.id}/set-active/`, { is_active: !row.is_active }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (row: GeoRow) => opsApiClient.del(`${path}${row.id}/`), onSuccess: () => { invalidate(); setRemoving(null); } });
  function openForm(nextMode: Operation["mode"], row?: GeoRow) {
    setMode(nextMode); save.reset();
    setDraft({ name: row?.name ?? "", name_kk: row?.name_kk ?? "", ...(countryMode ? { code: nextMode === "update" ? row?.code ?? "" : "" } : { country: row?.country }) });
  }
  function submit(op: Operation) { setPending(op); save.mutate(op); }
  if (!isLoading && !hasPermission("dictionary.view")) return <OpsAccessDenied what="справочников" />;
  if (!valid) return <DictionariesWorkspace><p>Справочник не найден</p></DictionariesWorkspace>;
  return <DictionariesWorkspace><div className="space-y-4">
    <PageHeader  title={countryMode ? "Страны" : "Города"} description="Корректирование меняет название. Редактирование создаёт преемника с сохранением истории." />
    <Link href="/security-ops/dictionaries" className="text-primary-ink">← Все справочники</Link>
    {query.isLoading && <p>Загрузка…</p>}{query.isError && <LoadFailure what="значения справочника" onRetry={() => void query.refetch()} />}
    {query.data && <DictionaryReviewTable rows={query.data.map((row) => ({ id: row.id, code: row.code, name: row.country_name ? `${row.name} (${row.country_name})` : row.name, nameKk: row.name_kk, active: row.is_active, count: row.usage.totalCount, inactiveSince: row.inactive_since, successor: row.superseded_by, lastChange: row.lastChange }))} onSelect={(id) => setSelectedId(Number(id))} />}
    {canManage && <Button onClick={() => openForm("create")}>Добавить запись</Button>}
    {selected && <Card><CardContent className="space-y-3 p-4"><p className="font-semibold">{selected.name}</p><p>Ссылок: {selected.usage.totalCount}. {selected.usage.references.map((ref) => `${ref.sourceLabel}: ${ref.count}`).join("; ")}</p>
      {canManage && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!selected.is_active} onClick={() => openForm("update", selected)}>Корректировать</Button><Button variant="outline" disabled={!selected.is_active || selected.superseded_by !== null} onClick={() => openForm("supersede", selected)}>Редактировать</Button>{selected.superseded_by === null && <><Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(selected)}>{selected.is_active ? "Деактивировать" : "Активировать"}</Button><Button variant="outline" onClick={() => { remove.reset(); setRemoving(selected); }}>Удалить</Button></>}</div>}
      {toggle.error && <p role="alert" className="text-destructive">{toggle.error.message}</p>}
    </CardContent></Card>}
    <Dialog open={draft !== null} onOpenChange={(open) => { if (!open && !save.isPending) setDraft(null); }}><DialogContent><DialogHeader><DialogTitle>{mode === "create" ? "Добавление" : mode === "update" ? "Корректирование" : "Редактирование с записью-преемником"}</DialogTitle><DialogDescription>{mode === "supersede" ? "Прежняя запись останется в старых данных и закроется для нового выбора." : "Введите наименования записи."}</DialogDescription></DialogHeader>
      {draft && <div className="space-y-3"><Label htmlFor="geo-name">Наименование (RU) *</Label><Input id="geo-name" maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><Label htmlFor="geo-kk">Наименование (KZ)</Label><Input id="geo-kk" maxLength={255} value={draft.name_kk} onChange={(e) => setDraft({ ...draft, name_kk: e.target.value })} />
        {countryMode ? <><Label htmlFor="geo-code">Код ISO *</Label><Input id="geo-code" maxLength={2} disabled={mode === "update"} value={draft.code ?? ""} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} /></> : <><Label htmlFor="geo-country">Страна *</Label><select id="geo-country" className="h-10 w-full rounded border bg-background" disabled={mode === "update"} value={draft.country ?? ""} onChange={(e) => setDraft({ ...draft, country: Number(e.target.value) })}><option value="">Выберите страну</option>{countries.data?.filter((row) => row.is_active || row.id === draft.country).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{countries.isError && <LoadFailure what="страны" onRetry={() => void countries.refetch()} />}</>}
      </div>}
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error instanceof OpsApiError && save.error.status === 400 ? Object.entries(save.error.details).map(([key, value]) => `${key}: ${String(value)}`).join("; ") : save.error.message}</p>}
      <DialogFooter><Button variant="outline" disabled={save.isPending} onClick={() => setDraft(null)}>Отмена</Button><Button disabled={save.isPending || !draft?.name.trim()} onClick={() => { if (draft) submit({ mode, id: selectedId ?? undefined, body: draft }); }}>Сохранить</Button></DialogFooter>
    </DialogContent></Dialog>
    <DictionarySimilarityDialog error={save.error} pending={save.isPending} onCancel={() => save.reset()} onConfirm={() => { if (pending) submit({ ...pending, body: { ...pending.body, confirmSimilar: true } }); }} onUse={(id) => { save.reset(); setDraft(null); setSelectedId(Number(id)); }} />
    <Dialog open={removing !== null} onOpenChange={(open) => { if (!open && !remove.isPending) setRemoving(null); }}><DialogContent><DialogHeader><DialogTitle>Удалить {removing?.name}?</DialogTitle><DialogDescription>{removing?.usage.totalCount ? `Запись используется (${removing.usage.totalCount}). Она будет деактивирована с сегодняшней датой и сохранится в истории.` : "Связей нет. Запись будет удалена безвозвратно."}</DialogDescription></DialogHeader>{remove.error && <p role="alert" className="text-destructive">{remove.error.message}</p>}<DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>Отмена</Button><Button disabled={remove.isPending} onClick={() => { if (removing) remove.mutate(removing); }}>{removing?.usage.totalCount ? "Деактивировать" : "Удалить"}</Button></DialogFooter></DialogContent></Dialog>
  </div></DictionariesWorkspace>;
}
