"use client";

// Этап 5 «Расстановка»: назначения сотрудников на посты расчёта. Правила:
// два поста одного ОМ одному сотруднику — жёсткий отказ (422); требование
// поста к рейтингу — мягкий 409-конфликт, обходится причиной через общий
// ConflictDialog. Возврат с согласования показывает причину.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConflictDialog } from "@/features/ops-conflict-override";
import {
  useAssignPlacement,
  useCompletePlacement,
  usePersonnelRoster,
  useUnassignPlacement,
} from "@/hooks/use-security-event-stages";
import type { SecurityEvent } from "@/entities/security-event";
import { StageError } from "./StageErrors";

export function PlacementStage({ event }: { event: SecurityEvent }) {
  const roster = usePersonnelRoster();
  const assign = useAssignPlacement(event.id);
  const unassign = useUnassignPlacement(event.id);
  const complete = useCompletePlacement(event.id);
  const [selectedByPost, setSelectedByPost] = useState<Record<string, string>>({});

  const assignedEmployeeIds = new Set(
    event.placementAssignments.map((a) => a.employeeId)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Расстановка</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {event.approvalStatus === "RETURNED" && event.approvalComment !== "" && (
          <Alert variant="destructive">
            <AlertDescription>
              Возвращено с согласования: {event.approvalComment}
            </AlertDescription>
          </Alert>
        )}

        {event.reconSectorPosts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Постов нет — расчёт формируется на этапе рекогносцировки.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {event.reconSectorPosts.map((post) => {
              const assignments = event.placementAssignments.filter(
                (a) => a.postId === post.id
              );
              const selected = selectedByPost[post.id] ?? "";
              return (
                <div key={post.id} className="rounded-md border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {post.sector} · {post.post}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      потребность: {post.need}
                      {post.minRating !== null
                        ? ` · мин. рейтинг: ${post.minRating}`
                        : ""}
                    </span>
                  </div>
                  {assignments.length === 0 ? (
                    <p className="mb-2 text-xs text-muted-foreground">
                      Пост не укомплектован.
                    </p>
                  ) : (
                    <ul className="mb-2 flex flex-col gap-1">
                      {assignments.map((assignment) => (
                        <li
                          key={assignment.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span>{assignment.employeeName}</span>
                          {assignment.ratingOverrideReason !== null && (
                            <span
                              className="text-xs text-amber-700"
                              title={assignment.ratingOverrideReason}
                            >
                              (обход предупреждения)
                            </span>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              unassign.mutate({ assignmentId: assignment.id })
                            }
                          >
                            Снять
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Кандидат: ${post.post}`}
                      className="h-8 min-w-56 rounded-md border border-input bg-background px-2 text-xs"
                      value={selected}
                      onChange={(e) =>
                        setSelectedByPost((prev) => ({
                          ...prev,
                          [post.id]: e.target.value,
                        }))
                      }
                    >
                      <option value="">— выберите сотрудника —</option>
                      {(roster.data?.results ?? []).map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name} · {person.rankLabel} · {person.unit}
                          {assignedEmployeeIds.has(person.id)
                            ? " — уже назначен"
                            : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={selected === "" || assign.isPending}
                      onClick={() =>
                        assign.mutate({ postId: post.id, employeeId: selected })
                      }
                    >
                      Назначить
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <StageError error={assign.error} />
        <StageError error={unassign.error} />
        <StageError error={complete.error} />

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={complete.isPending}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending
              ? "Завершение…"
              : "Завершить расстановку → Согласование"}
          </Button>
        </div>

        {/* мягкий 409: причина обхода уходит повтором мутации с override */}
        <ConflictDialog
          conflict={assign.conflict}
          onOverride={(reason) => assign.confirmOverride(reason)}
          onCancel={() => assign.dismissConflict()}
        />
      </CardContent>
    </Card>
  );
}
