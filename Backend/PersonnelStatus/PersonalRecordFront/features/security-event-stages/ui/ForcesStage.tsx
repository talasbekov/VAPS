"use client";

// Этап 4 «Запрос сил»: агрегированные запросы по группам, выделение
// численности. Завершение возможно только при полном выделении всех запросов.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useCompleteForces,
  useUpdateForceAllocation,
} from "@/hooks/use-security-event-stages";
import type { ForceRequest, SecurityEvent } from "@/entities/security-event";
import { StageError } from "./StageErrors";

const FORCE_STATUS_LABEL: Record<ForceRequest["status"], string> = {
  NOT_SENT: "Не отправлен",
  SENT: "Отправлен",
  PARTIALLY_ALLOCATED: "Выделено частично",
  ALLOCATED: "Выделено",
};

export function ForcesStage({ event }: { event: SecurityEvent }) {
  const complete = useCompleteForces(event.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Выделение сил</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {event.forceRequests.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Запросов нет — потребность не утверждена.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {event.forceRequests.map((request) => (
              <ForceRequestRow
                key={request.id}
                eventId={event.id}
                request={request}
              />
            ))}
          </div>
        )}
        <StageError error={complete.error} />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={complete.isPending}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending
              ? "Завершение…"
              : "Завершить выделение → Расстановка"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ForceRequestRow({
  eventId,
  request,
}: {
  eventId: string;
  request: ForceRequest;
}) {
  const [allocated, setAllocated] = useState(request.allocatedCount);
  const [comment, setComment] = useState(request.comment);
  const update = useUpdateForceAllocation(eventId, request.id);

  const dirty =
    allocated !== request.allocatedCount || comment !== request.comment;

  return (
    <div className="grid grid-cols-2 items-center gap-2 border-b pb-2 last:border-0 md:grid-cols-[1fr_120px_110px_1fr_140px_auto]">
      <span className="text-sm font-semibold">{request.group}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        запрошено: {request.requestedCount}
      </span>
      <Input
        className="h-8 text-xs"
        type="number"
        min={0}
        aria-label={`Выделено: ${request.group}`}
        value={allocated}
        onChange={(e) => setAllocated(Number(e.target.value) || 0)}
      />
      <Input
        className="h-8 text-xs"
        placeholder="Комментарий"
        aria-label={`Комментарий: ${request.group}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <span className="text-xs">{FORCE_STATUS_LABEL[request.status]}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!dirty || update.isPending}
        onClick={() => update.mutate({ allocatedCount: allocated, comment })}
      >
        {update.isPending ? "…" : "Сохранить"}
      </Button>
      <StageError error={update.error} />
    </div>
  );
}
