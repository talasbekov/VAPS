"use client";

// Этап 6 «Согласование»: утверждение расстановки (сразу открывает
// «Ознакомление») либо возврат на доработку с обязательной причиной.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useApprovePlacement,
  useReturnPlacement,
} from "@/hooks/use-security-event-stages";
import type { SecurityEvent } from "@/entities/security-event";
import { FieldErrors, StageError } from "./StageErrors";

export function ApprovalStage({ event }: { event: SecurityEvent }) {
  const approve = useApprovePlacement(event.id);
  const [comment, setComment] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const returnBack = useReturnPlacement(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Согласование расстановки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="flex flex-col gap-1.5">
          {event.placementAssignments.map((assignment) => {
            const post = postById.get(assignment.postId);
            return (
              <li key={assignment.id} className="rounded-md border p-2.5 text-sm">
                <span className="font-semibold">{assignment.employeeName}</span>{" "}
                <span className="text-muted-foreground">
                  — {post ? `${post.sector} · ${post.post}` : assignment.postId}
                  {assignment.ratingOverrideReason !== null
                    ? ` · обход предупреждения: ${assignment.ratingOverrideReason}`
                    : ""}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="space-y-1">
          <Label htmlFor="approval-comment">Причина возврата (при возврате)</Label>
          <Textarea
            id="approval-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <FieldErrors errors={fieldErrors} />
        <StageError error={approve.error} />
        <StageError error={returnBack.error} />

        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={returnBack.isPending}
            onClick={() => {
              setFieldErrors(null);
              returnBack.mutate({ comment });
            }}
          >
            {returnBack.isPending ? "Возврат…" : "Вернуть на доработку"}
          </Button>
          <Button
            type="button"
            disabled={approve.isPending}
            onClick={() => approve.mutate({})}
          >
            {approve.isPending ? "Утверждение…" : "Утвердить → Ознакомление"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
