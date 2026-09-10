"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ForceCollectionRow } from "@/entities/security-event";
import {
  useAssignForceCampaign,
  useCreateForceCampaign,
  useForceCampaign,
  useForceCampaigns,
  useHandOverForceCampaign,
} from "@/hooks/use-force-campaigns";
import { formatIsoDate } from "@/shared/lib/date";
import { useForceCollection } from "@/hooks/use-force-collections";

export function HqStages({ current }: { current: number }) {
  return <ol aria-label="Этапы работы Штаба" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
    {["Получить потребность", "Разделить по департаментам", "Получить ответы и списки", "Раздать по ОМ и объектам"].map((label, index) => (
      <li key={label} aria-current={current === index + 1 ? "step" : undefined} className={`rounded-xl border p-3 ${current === index + 1 ? "border-primary/40 bg-primary/5" : current > index + 1 ? "bg-success/5" : "bg-card"}`}>
        <span className="text-muted-foreground text-xs">Шаг {index + 1}</span><strong className="mt-1 block text-sm">{label}</strong>
      </li>
    ))}
  </ol>;
}

function CampaignCollectionSummary({ eventId, code }: { eventId: string; code: string }) {
  const collection = useForceCollection(eventId);
  const data = collection.data;
  return <article className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{code} · запросы департаментам</h3><Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline" href={`/employees?view=forces&tab=collections&collection=${encodeURIComponent(eventId)}`}>Открыть сбор {code}</Link></div>
    {collection.isPending ? <p className="text-muted-foreground text-sm">Загрузка запросов…</p> : collection.isError || !data ? <p role="alert" className="text-destructive-ink text-sm">Запросы этого мероприятия не загрузились.</p> : <>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Запрошено", data.allocations.filter(row => row.sentAt).reduce((sum, row) => sum + row.need, 0)], ["Выделяют", data.totals.allocating], ["Прислано", data.totals.sent], ["Недобор", data.totals.shortage]].map(([label, value]) => <div key={label} className="rounded-lg bg-muted/40 p-2"><dt className="text-muted-foreground text-xs">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>
      {data.allocations.filter(row => row.sentAt).map(row => <div key={row.id} className="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm"><span>{row.departmentName}{row.topUpOf ? " · довыделение" : ""}</span><span className="tabular-nums">Запрос {row.need} · выделяют {row.allocating ?? "—"} · прислано {row.sent ?? 0}</span></div>)}
      {data.allocations.every(row => !row.sentAt) && <p className="text-muted-foreground text-sm">Запросы ещё не отправлены. Подготовьте раскладку в сборе мероприятия.</p>}
    </>}
  </article>;
}

const STATUS_LABEL = {
  DRAFT: "Черновик",
  GATHERING: "Сбор пула",
  DISTRIBUTING: "Распределение",
  HANDED_OVER: "Передано в расстановку",
  CLOSED: "Закрыто",
} as const;

interface Props {
  enabled: boolean;
  collectionRows: ForceCollectionRow[];
  openedId: string | null;
  onOpen: (id: string | null) => void;
}

export function ForceCampaignsPanel({ enabled, collectionRows, openedId, onOpen }: Props) {
  const campaigns = useForceCampaigns(enabled && openedId === null);
  const campaign = useForceCampaign(openedId, enabled);
  const create = useCreateForceCampaign();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [eventIds, setEventIds] = useState<string[]>([]);

  if (openedId !== null) {
    if (campaign.isPending) return <p className="text-muted-foreground">Загрузка распределения…</p>;
    if (campaign.isError || !campaign.data) {
      return <p role="alert" className="text-destructive-ink">Распределение не загрузилось.</p>;
    }
    return <ForceCampaignWorkspace key={campaign.data.id} campaign={campaign.data} onBack={() => onOpen(null)} />;
  }

  const rows = campaigns.data?.results ?? [];
  return (
    <section aria-labelledby="force-campaigns-heading" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="force-campaigns-heading" className="text-lg font-semibold">
            Распределения по мероприятиям
          </h2>
          <p className="text-muted-foreground text-sm">
            Общий пул нескольких ОМ и решения Штаба по назначениям
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setCreating((value) => !value)}>
          <Plus className="size-4" aria-hidden="true" /> Новое распределение
        </Button>
      </div>

      {creating && (
        <form
          className="space-y-3 rounded-lg border bg-muted/20 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (create.isPending || !title.trim() || eventIds.length === 0) return;
            create.mutate(
              { title, eventIds },
              { onSuccess: (created) => onOpen(created.id) }
            );
          }}
        >
          <label htmlFor="force-campaign-title" className="text-sm font-medium">Название</label>
          <Input id="force-campaign-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Мероприятия</legend>
            {collectionRows.map((row) => (
              <label key={row.eventId} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm">
                <input
                  type="checkbox"
                  checked={eventIds.includes(row.eventId)}
                  onChange={() => setEventIds((current) => current.includes(row.eventId) ? current.filter((id) => id !== row.eventId) : [...current, row.eventId])}
                />
                <span><span className="font-mono">{row.code}</span> · {row.title}</span>
              </label>
            ))}
          </fieldset>
          {create.isError && <p role="alert" className="text-destructive-ink text-sm">{create.error.message}</p>}
          <Button type="submit" disabled={create.isPending || !title.trim() || eventIds.length === 0}>Создать распределение</Button>
        </form>
      )}

      {campaigns.isError && <p role="alert" className="text-destructive-ink text-sm">Кампании не загрузились.</p>}
      {!campaigns.isPending && !campaigns.isError && rows.length === 0 && (
        <p className="text-muted-foreground text-sm">Отдельных распределений пока нет.</p>
      )}
      <div className="grid gap-2 lg:grid-cols-2">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onOpen(row.id)}
            aria-label={`Открыть распределение ${row.code}`}
            className="flex min-h-16 items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-mono">{row.code}</Badge>
                <Badge variant="outline">{STATUS_LABEL[row.status]}</Badge>
              </span>
              <span className="mt-1 block font-medium">{row.title}</span>
              <span className="text-muted-foreground text-xs">ОМ: {row.events.length} · Общий пул: {row.pool.length}</span>
            </span>
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function ForceCampaignWorkspace({ campaign, onBack }: { campaign: NonNullable<ReturnType<typeof useForceCampaign>["data"]>; onBack: () => void }) {
  const assign = useAssignForceCampaign(campaign.id);
  const handOver = useHandOverForceCampaign(campaign.id);
  const [employeeId, setEmployeeId] = useState("");
  const [eventId, setEventId] = useState("");
  const [visitObjectId, setVisitObjectId] = useState("");
  const [demandRowId, setDemandRowId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmConflict, setConfirmConflict] = useState(false);
  const [comment, setComment] = useState("");
  const event = campaign.events.find((row) => row.eventId === eventId);
  const objects = event?.visitObjects ?? [];
  const demands = useMemo(
    () => (event?.demandRows ?? []).filter((row) => !visitObjectId || row.visitObjectId === visitObjectId),
    [event, visitObjectId]
  );
  const locked = campaign.status === "HANDED_OVER" || campaign.status === "CLOSED";
  const selectedAssignments = campaign.assignments.filter((row) => row.employeeId === employeeId);
  const hasVisibleConflict = Boolean(event && selectedAssignments.some((row) => {
    const assignedEvent = campaign.events.find((item) => item.eventId === row.eventId);
    if (!assignedEvent) return false;
    const assignedEnd = assignedEvent.businessDateEnd ?? assignedEvent.businessDate;
    const targetEnd = event.businessDateEnd ?? event.businessDate;
    return assignedEvent.businessDate <= targetEnd && event.businessDate <= assignedEnd;
  }));
  const conflictRejected = assign.error && "errorCode" in assign.error && assign.error.errorCode === "FORCE_CAMPAIGN_TIME_CONFLICT";
  const resetConflict = () => { setConfirmConflict(false); setOverrideReason(""); assign.reset(); };
  const conflictRequired = hasVisibleConflict || Boolean(conflictRejected);
  const busy = assign.isPending || handOver.isPending;
  const canAssign = !busy && !locked && Boolean(employeeId && eventId && visitObjectId && demandRowId) && (!conflictRequired || (confirmConflict && overrideReason.trim().length > 0));
  const physicalNeed = campaign.events.reduce((sum, item) => sum + item.demandRows.filter(row => (row.kindCode ?? "PHYSICAL_SQUAD") === "PHYSICAL_SQUAD").reduce((total, row) => total + (row.need ?? 0), 0), 0);
  const unassigned = campaign.pool.filter(person => !campaign.assignments.some(row => row.employeeId === person.employeeId)).length;

  return (
    <section className="min-w-0 space-y-5">
      <Button type="button" variant="ghost" onClick={onBack} className="min-h-11">
        <ArrowLeft className="size-4" aria-hidden="true" /> Назад к распределениям
      </Button>
      <div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="font-mono">{campaign.code}</Badge><Badge variant="outline">{STATUS_LABEL[campaign.status]}</Badge></div>
        <h2 className="mt-2 text-2xl font-semibold">{campaign.title}</h2>
        <p className="text-muted-foreground text-sm">{campaign.events.map((row) => `${row.code} · ${formatIsoDate(row.businessDate)}`).join("; ")}</p>
      </div>
      <HqStages current={campaign.assignments.length > 0 || locked ? 4 : campaign.pool.length > 0 ? 3 : 2} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Потребность физнаряда", physicalNeed], ["Людей в общем пуле", campaign.pool.length], ["Назначений на объекты", campaign.assignments.length], ["Не распределено из пула", unassigned]].map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-3"><span className="text-muted-foreground text-xs">{label}</span><strong className="mt-1 block text-2xl tabular-nums">{value}</strong></div>)}</div>
      <section aria-label="Запросы мероприятий" className="grid gap-3 xl:grid-cols-2">{campaign.events.map(item => <CampaignCollectionSummary key={item.eventId} eventId={item.eventId} code={item.code} />)}</section>
      <div><h3 className="font-semibold">4. Распределение по ОМ и объектам</h3><p className="text-muted-foreground text-sm">Штаб назначает мероприятие, объект и строку потребности. Расстановка по постам — работа старшего объекта.</p></div>
      {campaign.warnings.length > 0 && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {campaign.warnings.map((warning) => <p key={warning.eventId}>{warning.message}</p>)}
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">Общий пул</h3>
          {campaign.pool.map((person) => (
            <label key={person.employeeId} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm">
              <input type="radio" name="campaign-employee" value={person.employeeId} checked={employeeId === person.employeeId} onChange={() => { setEmployeeId(person.employeeId); resetConflict(); }} disabled={locked || busy} />
              <span className="flex-1">
                {person.employeeName || `Сотрудник №${person.employeeId}`}
                <span className="text-muted-foreground block text-xs">
                  {person.kindCode === "PHYSICAL_SQUAD" ? "Физнаряд · резерв" : person.kindCode}
                </span>
              </span>
              <Badge variant="outline">{campaign.assignments.filter((row) => row.employeeId === person.employeeId).length || "Не распределён"}</Badge>
            </label>
          ))}
        </div>
        <div className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">Объекты и ёмкость</h3>
          <div className="space-y-2">{campaign.events.flatMap(item => item.demandRows.map(demand => {
            const assigned = campaign.assignments.filter(row => row.eventId === item.eventId && row.demandRowId === demand.id).length;
            const object = item.visitObjects.find(row => row.visitObjectId === demand.visitObjectId);
            return <div key={`${item.eventId}-${demand.id}`} className="rounded-lg border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{item.code} · {object?.objectName ?? "Объект не указан"}</strong><Badge variant="outline">{assigned} из {demand.need ?? "—"}</Badge></div><p className="text-muted-foreground mt-1">{(demand.kindCode ?? "PHYSICAL_SQUAD") === "PHYSICAL_SQUAD" ? "Физический наряд" : "Специальная группа"} · {demand.place || demand.specification}{demand.need !== undefined && assigned < demand.need ? ` · недобор ${demand.need - assigned}` : ""}</p></div>;
          }))}</div>
          <h3 className="font-semibold">Назначения</h3>
          {!locked && (
            <form className="grid gap-3 md:grid-cols-2" onSubmit={(formEvent) => { formEvent.preventDefault(); if (!canAssign) return; assign.mutate({ employeeId, eventId, visitObjectId, demandRowId, ...(conflictRequired && confirmConflict ? { overrideConflict: true, overrideReason: overrideReason.trim() } : {}) }, { onSuccess: resetConflict }); }}>
              <label className="space-y-1 text-sm"><span className="font-medium">Сотрудник</span><select aria-label="Сотрудник" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); resetConflict(); }} disabled={busy} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Выберите</option>{campaign.pool.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.employeeName}</option>)}</select></label>
              <label className="space-y-1 text-sm"><span className="font-medium">Мероприятие</span><select aria-label="Мероприятие" value={eventId} onChange={(e) => { setEventId(e.target.value); setVisitObjectId(""); setDemandRowId(""); resetConflict(); }} disabled={busy} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Выберите</option>{campaign.events.map((row) => <option key={row.eventId} value={row.eventId}>{row.code} · {row.title}</option>)}</select></label>
              <label className="space-y-1 text-sm"><span className="font-medium">Объект</span><select aria-label="Объект" value={visitObjectId} onChange={(e) => { setVisitObjectId(e.target.value); setDemandRowId(""); resetConflict(); }} disabled={busy} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Выберите</option>{objects.map((row) => <option key={row.visitObjectId} value={row.visitObjectId}>{row.objectName}</option>)}</select></label>
              <label className="space-y-1 text-sm"><span className="font-medium">Строка потребности</span><select aria-label="Строка потребности" value={demandRowId} onChange={(e) => { setDemandRowId(e.target.value); resetConflict(); }} disabled={busy} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Выберите</option>{demands.map((row) => <option key={row.id} value={row.id}>{row.place || row.specification || row.id}</option>)}</select></label>
              {(hasVisibleConflict || conflictRejected) && <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 md:col-span-2"><p className="text-sm font-medium text-destructive-ink">Период пересекается с существующим назначением сотрудника.</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmConflict} onChange={(e) => setConfirmConflict(e.target.checked)} /> Подтвердить назначение с конфликтом</label><Textarea aria-label="Причина конфликта" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Причина решения Штаба" /></div>}
              {assign.isError && <p role="alert" className="text-destructive-ink text-sm md:col-span-2">{assign.error.message}</p>}
              <Button type="submit" disabled={!canAssign}>Назначить</Button>
            </form>
          )}
          <div className="space-y-2">{selectedAssignments.map((row) => { const assignedEvent = campaign.events.find((item) => item.eventId === row.eventId); const assignedObject = assignedEvent?.visitObjects.find((item) => item.visitObjectId === row.visitObjectId); const demand = assignedEvent?.demandRows.find((item) => item.id === row.demandRowId); return <div key={row.id} className="rounded-md bg-muted/40 p-3 text-sm"><span className="font-medium">{assignedEvent?.code} · {assignedObject?.objectName}</span><p className="text-muted-foreground">{assignedEvent ? `${formatIsoDate(assignedEvent.businessDate)}${assignedEvent.businessDateEnd ? `–${formatIsoDate(assignedEvent.businessDateEnd)}` : ""}${assignedEvent.eventTime ? ` · ${assignedEvent.eventTime.slice(0, 5)}` : ""}` : ""} · {demand?.place || demand?.specification || row.demandRowId}</p>{row.overrideReason && <p className="text-destructive-ink mt-1 text-xs">Конфликт подтверждён: {row.overrideReason}</p>}</div>; })}{employeeId && selectedAssignments.length === 0 && <p className="text-muted-foreground text-sm">Сотрудник пока не распределён.</p>}</div>
          {!locked && <div className="space-y-2 border-t pt-4"><label htmlFor="campaign-handover-comment" className="text-sm font-medium">Комментарий при неполном распределении</label><Textarea id="campaign-handover-comment" value={comment} onChange={(e) => setComment(e.target.value)} /><Button type="button" onClick={() => { if (!busy) handOver.mutate({ comment }); }} disabled={busy || campaign.assignments.length === 0}>Передать в расстановку</Button>{handOver.isError && <p role="alert" className="text-destructive-ink text-sm">{handOver.error.message}</p>}</div>}
        </div>
      </div>
    </section>
  );
}
