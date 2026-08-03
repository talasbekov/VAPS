"use client";

// Закрытое дело — read-only: итоги направлений, расстановка, журнал.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SecurityEvent } from "@/entities/security-event";
import { JournalList } from "./JournalList";

export function ClosedView({ event }: { event: SecurityEvent }) {
  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Итоги направлений</CardTitle>
        </CardHeader>
        <CardContent>
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
