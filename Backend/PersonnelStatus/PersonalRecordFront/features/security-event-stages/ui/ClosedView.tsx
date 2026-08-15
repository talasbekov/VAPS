"use client";

// Закрытое дело — read-only: сводка, итоги направлений, расстановка, журнал.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SecurityEvent } from "@/entities/security-event";
import { JournalList } from "./JournalList";
import { closureFacts } from "./ConductStage";

export function ClosedView({ event }: { event: SecurityEvent }) {
  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));
  // Та же сводка, что видел закрывающий, — снимком: закрытое дело смотрят,
  // чтобы понять, чем мероприятие кончилось, а не только что в нём написали.
  const facts = closureFacts(event);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Итоги направлений</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-4 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">
                {facts.assigned} / {facts.need}
              </b>
              <span className="text-muted-foreground">назначено / потребность</span>
            </span>
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{facts.replacements}</b>
              <span className="text-muted-foreground">замен</span>
            </span>
            <span className="flex items-baseline gap-1">
              <b
                className={`text-sm tabular-nums ${facts.incidents > 0 ? "text-amber-700" : ""}`}
              >
                {facts.incidents}
              </b>
              <span className="text-muted-foreground">инцидентов</span>
            </span>
          </div>
          {event.closureDirectionSummaries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Итогов нет.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {event.closureDirectionSummaries.map((item) => (
                <li key={item.direction} className="rounded-md border p-2.5 text-sm">
                  <span className="font-semibold">{item.direction}</span> —{" "}
                  <span className="text-muted-foreground">{item.summary}</span>
                </li>
              ))}
            </ul>
          )}
          {event.closedAt !== null && (
            <p className="mt-2 text-xs text-muted-foreground">
              Закрыто: {event.closedAt}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Расстановка (снимок)</CardTitle>
        </CardHeader>
        <CardContent>
          {event.placementAssignments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Назначений не было.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {event.placementAssignments.map((assignment) => {
                const post = postById.get(assignment.postId);
                return (
                  <li key={assignment.id} className="text-sm">
                    <span className="font-semibold">{assignment.employeeName}</span>{" "}
                    <span className="text-muted-foreground">
                      — {post ? `${post.sector} · ${post.post}` : assignment.postId}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Журнал штаба</CardTitle>
        </CardHeader>
        <CardContent>
          <JournalList entries={event.journalEntries} />
        </CardContent>
      </Card>
    </div>
  );
}
