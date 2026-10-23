"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAcknowledgePersonalDuty, useProfileNextShiftSources } from "@/hooks/use-profile-next-shift";
import { profileServerNow, selectNextProfileShift } from "../model/profile-next-shift";
import { NextShiftCard } from "./NextShiftCard";
import { ProfileEventLink } from "./ProfileEventLink";

/** Mounted only in the owner's profile; never rendered in a foreign read-only profile. */
export function MyNextShift({ employeeId }: { employeeId: string }) {
  const client = useQueryClient();
  const sources = useProfileNextShiftSources(employeeId);
  const { duties, assignments, authorityAvailable } = sources;
  const [, refreshClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => refreshClock(value => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const dutyData = authorityAvailable && !duties.readAccessBlocked ? duties.data : undefined;
  const assignmentData = authorityAvailable && !assignments.readAccessBlocked ? assignments.data : undefined;
  const timeZone = dutyData?.time_zone ?? "Asia/Almaty";
  const now = profileServerNow(dutyData?.generated_at, dutyData?.receivedMonotonicMs, performance.now());
  const shift = now === null ? null : selectNextProfileShift(dutyData?.results ?? [], assignmentData?.results ?? [], now, timeZone);
  const acknowledgement = useAcknowledgePersonalDuty(employeeId, shift, sources);
  const incomplete = now === null || !authorityAvailable || dutyData === undefined || assignmentData === undefined ||
    duties.isError || assignments.isError || Boolean(dutyData?.unlinkedReason || assignmentData?.unlinkedReason);
  const notes: string[] = [];
  if (!authorityAvailable) notes.push("Не удалось подтвердить доступ к личным назначениям. Повторите проверку.");
  else {
    for (const [label, query, data] of [["Личные смены", duties, dutyData], ["Назначения в ОМ", assignments, assignmentData]] as const) {
      if (query.readAccessBlocked) notes.push(`${label} недоступны: доступ к источнику не подтверждён.`);
      else if (query.isError) notes.push(`${label}: не удалось обновить источник${data ? "; показаны сохранённые данные" : ""}.`);
      if (data?.unlinkedReason) notes.push(data.unlinkedReason);
    }
    if (now === null && !duties.isPending) notes.push("Не удалось подтвердить серверное время. Обновите личные смены.");
  }
  return <NextShiftCard shift={shift} timeZone={timeZone} incomplete={incomplete} notes={[...new Set(notes)]}
    acknowledgement={{ ...acknowledgement, onSubmit: () => { void acknowledgement.submit().catch(() => {}); } }}
    loading={authorityAvailable && shift === null && (duties.isPending || assignments.isPending)}
    retrying={duties.isFetching || assignments.isFetching}
    onRetry={() => {
      if (!authorityAvailable) void client.refetchQueries({ queryKey: ["ops-me"], exact: true });
      else { void duties.refetch(); void assignments.refetch(); }
    }}
    instructionLink={shift?.eventId ? <ProfileEventLink eventId={shift.eventId} className="font-medium text-primary underline underline-offset-2" hideWithoutAccess>
      Открыть инструкцию в ОМ
    </ProfileEventLink> : undefined} />;
}
