"use client";

import { useMemo, useState } from "react";
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
    return <ForceCampaignWorkspace campaign={campaign.data} onBack={() => onOpen(null)} />;
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
          <Button type="submit" disabled={create.isPending}>Создать распределение</Button>
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

  return (
    <section className="space-y-5">
      <Button type="button" variant="ghost" onClick={onBack} className="min-h-11">
        <ArrowLeft className="size-4" aria-hidden="true" /> Назад к распределениям
      </Button>
      <div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="font-mono">{campaign.code}</Badge><Badge variant="outline">{STATUS_LABEL[campaign.status]}</Badge></div>
        <h2 className="mt-2 text-2xl font-semibold">{campaign.title}</h2>
        <p className="text-muted-foreground text-sm">{campaign.events.map((row) => `${row.code} · ${formatIsoDate(row.businessDate)}`).join("; ")}</p>
      </div>
      {campaign.warnings.length > 0 && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {campaign.warnings.map((warning) => <p key={warning.eventId}>{warning.message}</p>)}
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(420px,1.4fr)]">
        <div className="space-y-3 rounded-xl border p-4">
          <h3 className="font-semibold">Общий пул</h3>
          {campaign.pool.map((person) => (
            <label key={person.employeeId} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm">
              <input type="radio" name="campaign-employee" value={person.employeeId} checked={employeeId === person.employeeId} onChange={() => setEmployeeId(person.employeeId)} disabled={locked} />
              <span className="flex-1">{person.employeeName || `Сотрудник №${person.employeeId}`}</span>
              <Badge variant="outline">{campaign.assignments.filter((row) => row.employeeId === person.employeeId).length || "Не распределён"}</Badge>
            </label>
          ))}
        </div>
        <div className="space-y-4 rounded-xl border p-4">
          <h3 className="font-semibold">Назначения</h3>
          {!locked && (
            <form className="grid gap-3 md:grid-cols-2" onSubmit={(formEvent) => { formEvent.preventDefault(); assign.mutate({ employeeId, eventId, visitObjectId, demandRowId, overrideConflict: confirmConflict, overrideReason }); }}>
              <label className="space-y-1 text-sm"><span className="font-medium">Сотрудник</span><select aria-label="Сотрудник" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Выберите</option>{campaign.pool.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.employeeName}</option>)}</select></label>
              <label className="space-y-1 text-sm"><span className="font-medium">Мероприятие</span><select aria-label="Мероприятие" value={eventId} onChange={(e) => { setEventId(e.target.value); setVisitObjectId(""); setDemandRowId(""); }} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Выберите</option>{campaign.events.map((row) => <option key={row.eventId} value={row.eventId}>{row.code} · {row.title}</option>)}</select></label>
              <label className="space-y-1 text-sm"><span className="font-medium">Объект</span><select aria-label="Объект" value={visitObjectId} onChange={(e) => { setVisitObjectId(e.target.value); setDemandRowId(""); }} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Выберите</option>{objects.map((row) => <option key={row.visitObjectId} value={row.visitObjectId}>{row.objectName}</option>)}</select></label>
              <label className="space-y-1 text-sm"><span className="font-medium">Строка потребности</span><select aria-label="Строка потребности" value={demandRowId} onChange={(e) => setDemandRowId(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Выберите</option>{demands.map((row) => <option key={row.id} value={row.id}>{row.place || row.specification || row.id}</option>)}</select></label>
              {(hasVisibleConflict || conflictRejected) && <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 md:col-span-2"><p className="text-sm font-medium text-destructive-ink">Период пересекается с существующим назначением сотрудника.</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmConflict} onChange={(e) => setConfirmConflict(e.target.checked)} /> Подтвердить назначение с конфликтом</label><Textarea aria-label="Причина конфликта" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Причина решения Штаба" /></div>}
              {assign.isError && <p role="alert" className="text-destructive-ink text-sm md:col-span-2">{assign.error.message}</p>}
              <Button type="submit" disabled={assign.isPending || !employeeId || !eventId || !visitObjectId || !demandRowId}>Назначить</Button>
            </form>
          )}
          <div className="space-y-2">{selectedAssignments.map((row) => { const assignedEvent = campaign.events.find((item) => item.eventId === row.eventId); const assignedObject = assignedEvent?.visitObjects.find((item) => item.visitObjectId === row.visitObjectId); const demand = assignedEvent?.demandRows.find((item) => item.id === row.demandRowId); return <div key={row.id} className="rounded-md bg-muted/40 p-3 text-sm"><span className="font-medium">{assignedEvent?.code} · {assignedObject?.objectName}</span><p className="text-muted-foreground">{assignedEvent ? `${formatIsoDate(assignedEvent.businessDate)}${assignedEvent.businessDateEnd ? `–${formatIsoDate(assignedEvent.businessDateEnd)}` : ""}${assignedEvent.eventTime ? ` · ${assignedEvent.eventTime.slice(0, 5)}` : ""}` : ""} · {demand?.place || demand?.specification || row.demandRowId}</p>{row.overrideReason && <p className="text-destructive-ink mt-1 text-xs">Конфликт подтверждён: {row.overrideReason}</p>}</div>; })}{employeeId && selectedAssignments.length === 0 && <p className="text-muted-foreground text-sm">Сотрудник пока не распределён.</p>}</div>
          {!locked && <div className="space-y-2 border-t pt-4"><label htmlFor="campaign-handover-comment" className="text-sm font-medium">Комментарий при неполном распределении</label><Textarea id="campaign-handover-comment" value={comment} onChange={(e) => setComment(e.target.value)} /><Button type="button" onClick={() => handOver.mutate({ comment })} disabled={handOver.isPending || campaign.assignments.length === 0}>Передать в расстановку</Button>{handOver.isError && <p role="alert" className="text-destructive-ink text-sm">{handOver.error.message}</p>}</div>}
        </div>
      </div>
    </section>
  );
}
