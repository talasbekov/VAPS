"use client";

// Этап 8 «Проведение»: журнал штаба (инструктаж/распоряжение/инцидент),
// замена выбывшего (атомарно: снять + назначить + запись в журнал) и
// закрытие с обязательными итогами ВСЕХ направлений.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useAddJournalEntry,
  useCloseSecurityEvent,
  usePersonnelRoster,
  useReplaceAssignment,
} from "@/hooks/use-security-event-stages";
import { JOURNAL_TYPE_LABEL } from "@/entities/security-event";
import type {
  JournalEntryType,
  SecurityEvent,
} from "@/entities/security-event";
import { FieldErrors, StageError } from "./StageErrors";
import { JournalList } from "./JournalList";

export function ConductStage({ event }: { event: SecurityEvent }) {
  return (
    <div className="flex flex-col gap-4">
      <JournalPanel event={event} />
      <ReplacementPanel event={event} />
      <ClosurePanel event={event} />
    </div>
  );
}

function JournalPanel({ event }: { event: SecurityEvent }) {
  const [type, setType] = useState<JournalEntryType>("INSTRUCTION");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const add = useAddJournalEntry(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Журнал штаба</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="journal-type">Тип</Label>
            <select
              id="journal-type"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as JournalEntryType)}
            >
              {(["INSTRUCTION", "ORDER", "INCIDENT"] as const).map((value) => (
                <option key={value} value={value}>
                  {JOURNAL_TYPE_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="journal-title">Заголовок *</Label>
            <Input
              id="journal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="journal-description">Описание</Label>
            <Input
              id="journal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={add.isPending}
            onClick={() => {
              setFieldErrors(null);
              add.mutate({ type, title, description });
              setTitle("");
              setDescription("");
            }}
          >
            {add.isPending ? "Запись…" : "Добавить запись"}
          </Button>
        </div>
        <FieldErrors errors={fieldErrors} />
        <StageError error={add.error} />
        <JournalList entries={event.journalEntries} />
      </CardContent>
    </Card>
  );
}

function ReplacementPanel({ event }: { event: SecurityEvent }) {
  const roster = usePersonnelRoster();
  const [assignmentId, setAssignmentId] = useState("");
  const [incomingEmployeeId, setIncomingEmployeeId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const replace = useReplaceAssignment(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Замена выбывшего</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="replace-assignment">Кого заменить</Label>
            <select
              id="replace-assignment"
              className="h-9 min-w-56 rounded-md border border-input bg-background px-2 text-sm"
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value)}
            >
              <option value="">— выберите назначение —</option>
              {event.placementAssignments.map((assignment) => {
                const post = postById.get(assignment.postId);
                return (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.employeeName} ({post?.post ?? assignment.postId})
                  </option>
                );
              })}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-incoming">Кем</Label>
            <select
              id="replace-incoming"
              className="h-9 min-w-56 rounded-md border border-input bg-background px-2 text-sm"
              value={incomingEmployeeId}
              onChange={(e) => setIncomingEmployeeId(e.target.value)}
            >
              <option value="">— выберите сотрудника —</option>
              {(roster.data?.results ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.rankLabel}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="replace-reason">Причина *</Label>
            <Input
              id="replace-reason"
              placeholder="Например: болезнь"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={
              replace.isPending || assignmentId === "" || incomingEmployeeId === ""
            }
            onClick={() => {
              setFieldErrors(null);
              replace.mutate({ assignmentId, incomingEmployeeId, reasonCode });
            }}
          >
            {replace.isPending ? "Замена…" : "Заменить"}
          </Button>
        </div>
        <FieldErrors errors={fieldErrors} />
        <StageError error={replace.error} />
      </CardContent>
    </Card>
  );
}

function ClosurePanel({ event }: { event: SecurityEvent }) {
  // направления = секторы расчёта; итог обязателен по каждому
  const directions = [...new Set(event.reconSectorPosts.map((p) => p.sector))];
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const close = useCloseSecurityEvent(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Закрытие мероприятия</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Итоги обязательны по каждому направлению — частичное закрытие
          невозможно.
        </p>
        {directions.map((direction) => (
          <div key={direction} className="space-y-1">
            <Label htmlFor={`closure-${direction}`}>{direction} *</Label>
            <Textarea
              id={`closure-${direction}`}
              value={summaries[direction] ?? ""}
              onChange={(e) =>
                setSummaries((prev) => ({ ...prev, [direction]: e.target.value }))
              }
            />
          </div>
        ))}
        <FieldErrors errors={fieldErrors} />
        <StageError error={close.error} />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={close.isPending}
            onClick={() => {
              setFieldErrors(null);
              close.mutate({
                directionSummaries: directions.map((direction) => ({
                  direction,
                  summary: summaries[direction] ?? "",
                })),
              });
            }}
          >
            {close.isPending ? "Закрытие…" : "Закрыть мероприятие"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
