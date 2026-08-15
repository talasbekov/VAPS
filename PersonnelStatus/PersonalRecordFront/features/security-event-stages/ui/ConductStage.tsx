"use client";

// Этап 8 «Проведение»: журнал штаба (инструктаж/распоряжение/инцидент),
// замена выбывшего (атомарно: снять + назначить + запись в журнал) и
// закрытие с обязательными итогами ВСЕХ направлений.
import { useState } from "react";
import Link from "next/link";
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
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
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

/**
 * Сводка «план / факт» из ЖИВЫХ данных карточки. Человеко-часов здесь нет,
 * хотя в прототипе они есть: учёта часов у домена ОМ не существует вовсе, и
 * посчитать их из назначений нельзя — вышла бы выдумка на месте отчётной
 * цифры.
 */
export function closureFacts(event: SecurityEvent): {
  assigned: number;
  need: number;
  replacements: number;
  incidents: number;
} {
  return {
    assigned: event.placementAssignments.length,
    need: event.reconSectorPosts.reduce((sum, post) => sum + post.need, 0),
    replacements: event.journalEntries.filter((e) => e.type === "REPLACEMENT")
      .length,
    incidents: event.journalEntries.filter((e) => e.type === "INCIDENT").length,
  };
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
  const { hasPermission } = useOpsPermissions();

  const facts = closureFacts(event);
  const ready = directions.filter(
    (direction) => (summaries[direction] ?? "").trim() !== ""
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Закрытие и итоги</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-4 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Fact value={`${facts.assigned} / ${facts.need}`} label="назначено / потребность" />
          <Fact value={String(facts.replacements)} label="замен" />
          <Fact
            value={String(facts.incidents)}
            label="инцидентов"
            alarming={facts.incidents > 0}
          />
        </div>

        {/* Готовность к закрытию — из прототипа: до этого о нехватке итогов
            узнавали только по 422 после нажатия. Кнопка при этом НЕ
            блокируется: владелец правила один — сервер, и клиентский гард
            рядом с ним лишь маскировал бы его отказ. */}
        <div className="rounded-md border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div>
              <p className="text-sm font-semibold">Готовность к закрытию</p>
              <p className="text-xs text-muted-foreground">
                Итоги обязательны по каждому направлению — частичное закрытие
                невозможно.
              </p>
            </div>
            <span
              className={
                ready.length === directions.length && directions.length > 0
                  ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
                  : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
              }
            >
              {ready.length} из {directions.length} готовы
            </span>
          </div>
          {directions.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              Направлений нет — расчёт постов пуст.
            </p>
          ) : (
            <div className="space-y-3 p-3">
              {directions.map((direction) => {
                const filled = (summaries[direction] ?? "").trim() !== "";
                return (
                  <div key={direction} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`closure-${direction}`}>{direction} *</Label>
                      <span
                        className={
                          filled
                            ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10.5px] font-semibold text-green-800"
                            : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800"
                        }
                      >
                        {filled ? "Готово" : "Ожидается"}
                      </span>
                    </div>
                    <Textarea
                      id={`closure-${direction}`}
                      value={summaries[direction] ?? ""}
                      onChange={(e) =>
                        setSummaries((prev) => ({
                          ...prev,
                          [direction]: e.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Оценка участников — живой отдельный экран (§19), а не копия его
            таблицы здесь: две точки ввода оценок расходились бы. */}
        {hasPermission("rating.evaluate") && (
          <Link
            href="/security-ops/ratings/workspace"
            className="inline-block text-xs font-semibold text-primary"
          >
            Оценка участников ОМ →
          </Link>
        )}

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

function Fact({
  value,
  label,
  alarming = false,
}: {
  value: string;
  label: string;
  alarming?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1">
      <b className={`text-sm tabular-nums ${alarming ? "text-amber-700" : ""}`}>
        {value}
      </b>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
