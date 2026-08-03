"use client";

// Этап 7 «Ознакомление»: каждый назначенный подтверждает прочтение; этап
// завершается только когда подтвердили все.
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAcknowledgePlacement,
  useCompleteAcknowledgement,
} from "@/hooks/use-security-event-stages";
import type { SecurityEvent } from "@/entities/security-event";
import { StageError } from "./StageErrors";

export function AcknowledgementStage({ event }: { event: SecurityEvent }) {
  const acknowledge = useAcknowledgePlacement(event.id);
  const complete = useCompleteAcknowledgement(event.id);

  const acknowledgedCount = event.placementAssignments.filter(
    (a) => a.acknowledgedAt !== null
  ).length;
  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Ознакомление ({acknowledgedCount}/{event.placementAssignments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="flex flex-col gap-1.5">
          {event.placementAssignments.map((assignment) => {
            const post = postById.get(assignment.postId);
            return (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-sm"
              >
                <span className="font-semibold">{assignment.employeeName}</span>
                <span className="text-muted-foreground">
                  {post ? `${post.sector} · ${post.post}` : assignment.postId}
                </span>
                {assignment.acknowledgedAt !== null ? (
                  <span className="text-xs font-semibold text-green-700">
                    ✓ Ознакомлен ({assignment.acknowledgedAt})
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={acknowledge.isPending}
                    onClick={() =>
                      acknowledge.mutate({ assignmentId: assignment.id })
                    }
                  >
                    Отметить ознакомление
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        <StageError error={acknowledge.error} />
        <StageError error={complete.error} />

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={complete.isPending}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending
              ? "Завершение…"
              : "Завершить ознакомление → Проведение"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
