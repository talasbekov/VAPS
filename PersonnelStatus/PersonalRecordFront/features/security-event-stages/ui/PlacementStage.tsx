"use client";

// Этап 5 «Расстановка»: назначения сотрудников на посты расчёта. Правила:
// два поста одного ОМ одному сотруднику — жёсткий отказ (422); требование
// поста к рейтингу — мягкий 409-конфликт, обходится причиной через общий
// ConflictDialog. Возврат с согласования показывает причину.
//
// Компоновка — из прототипа Smart Josparlau (экран «Расстановка»): слева
// дерево «сектор → посты» с заполненностью, справа карточка выбранного поста.
// Плоский список постов с отдельным подбором в каждом заставлял листать весь
// расчёт, чтобы понять, где дыра.
//
// Чего из прототипа здесь НЕТ и почему: старший сектора, перемещение между
// постами, автоподбор и версии расстановки требуют полей и ручек, которых у
// бэка нет вовсе. Рисовать их поверх живого домена значило бы выдать мок за
// работающую функцию.
import { useState } from "react";
import Link from "next/link";
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
import { useOperationalRatings } from "@/hooks/use-ops-ratings";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import type {
  PlacementAssignment,
  ReconSectorPost,
  SecurityEvent,
} from "@/entities/security-event";
import { StageError } from "./StageErrors";

export function PlacementStage({ event }: { event: SecurityEvent }) {
  const roster = usePersonnelRoster();
  const assign = useAssignPlacement(event.id);
  const unassign = useUnassignPlacement(event.id);
  const complete = useCompletePlacement(event.id);
  const { hasPermission } = useOpsPermissions();
  // Агрегат рейтинга — отдельное право (§19). Без него запрос не уходит
  // вовсе, а плашка рейтинга просто не рисуется: пустое место честнее
  // прочерка, который читается как «рейтинга нет».
  const canSeeRatings = hasPermission("rating.view_aggregate");
  const ratingOf = useRatingLookup(canSeeRatings);

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState("");

  const posts = event.reconSectorPosts;
  // Выбор переживает перерисовку, но не удаление поста на рекогносцировке.
  const selectedPost =
    posts.find((post) => post.id === selectedPostId) ?? posts[0] ?? null;

  const assignedEmployeeIds = new Set(
    event.placementAssignments.map((a) => a.employeeId)
  );
  const assignmentsOf = (postId: string): PlacementAssignment[] =>
    event.placementAssignments.filter((a) => a.postId === postId);

  const totalNeed = posts.reduce((sum, post) => sum + post.need, 0);
  const totalAssigned = event.placementAssignments.length;
  const understaffed = posts.filter(
    (post) => assignmentsOf(post.id).length < post.need
  ).length;

  // Порядок секторов — как в расчёте рекогносцировки, без сортировки:
  // расчёт ведут сверху вниз, и перестановка сбила бы привычный обход.
  const sectors: { name: string; posts: ReconSectorPost[] }[] = [];
  for (const post of posts) {
    const existing = sectors.find((sector) => sector.name === post.sector);
    if (existing === undefined) sectors.push({ name: post.sector, posts: [post] });
    else existing.posts.push(post);
  }

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

        {posts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Постов нет — расчёт формируется на этапе рекогносцировки.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-4 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <Kpi value={posts.length} label="постов" />
              <Kpi value={totalAssigned} label="назначено" />
              <Kpi value={totalNeed} label="потребность" />
              <Kpi
                value={understaffed}
                label="не укомплектовано"
                alarming={understaffed > 0}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(220px,280px)_1fr]">
              <aside className="rounded-md border">
                <p className="border-b px-3 py-2 text-xs font-semibold text-muted-foreground">
                  Объекты и посты
                </p>
                <div className="max-h-[420px] overflow-y-auto p-2">
                  {sectors.map((sector) => (
                    <div key={sector.name} className="mb-2">
                      <p className="px-1 py-1 text-xs font-semibold">
                        {sector.name}
                      </p>
                      <ul className="flex flex-col gap-1">
                        {sector.posts.map((post) => {
                          const count = assignmentsOf(post.id).length;
                          const full = count >= post.need;
                          const isSelected = selectedPost?.id === post.id;
                          return (
                            <li key={post.id}>
                              <button
                                type="button"
                                aria-current={isSelected}
                                onClick={() => {
                                  setSelectedPostId(post.id);
                                  setCandidate("");
                                }}
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                                  isSelected ? "bg-accent" : "hover:bg-muted"
                                }`}
                              >
                                <span
                                  aria-hidden
                                  className={`h-2 w-2 shrink-0 rounded-full ${
                                    full ? "bg-green-500" : "bg-amber-500"
                                  }`}
                                />
                                <span className="flex-1 truncate">{post.post}</span>
                                <span
                                  className={`shrink-0 tabular-nums ${
                                    full ? "text-muted-foreground" : "text-amber-700"
                                  }`}
                                >
                                  {count}/{post.need}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </aside>

              {selectedPost !== null && (
                <PostPanel
                  event={event}
                  post={selectedPost}
                  assignments={assignmentsOf(selectedPost.id)}
                  assignedEmployeeIds={assignedEmployeeIds}
                  roster={roster.data?.results ?? []}
                  ratingOf={ratingOf}
                  candidate={candidate}
                  onCandidate={setCandidate}
                  onAssign={() =>
                    assign.mutate({
                      postId: selectedPost.id,
                      employeeId: candidate,
                    })
                  }
                  assignPending={assign.isPending}
                  onUnassign={(assignmentId) => unassign.mutate({ assignmentId })}
                />
              )}
            </div>
          </>
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

/** Рейтинг по сотруднику: null — права нет либо агрегат не посчитан. */
function useRatingLookup(enabled: boolean): (employeeId: string) => number | null {
  const query = useOperationalRatings({ enabled });
  return (employeeId: string) => {
    const found = query.data?.results.find(
      (item) => item.employeeId === employeeId
    );
    return found?.aggregateRating ?? null;
  };
}

function Kpi({
  value,
  label,
  alarming = false,
}: {
  value: number;
  label: string;
  alarming?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1">
      <b
        className={`text-sm tabular-nums ${alarming ? "text-amber-700" : ""}`}
      >
        {value}
      </b>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function PostPanel({
  event,
  post,
  assignments,
  assignedEmployeeIds,
  roster,
  ratingOf,
  candidate,
  onCandidate,
  onAssign,
  assignPending,
  onUnassign,
}: {
  event: SecurityEvent;
  post: ReconSectorPost;
  assignments: PlacementAssignment[];
  assignedEmployeeIds: ReadonlySet<string>;
  roster: { id: string; name: string; rankLabel: string; unit: string }[];
  ratingOf: (employeeId: string) => number | null;
  candidate: string;
  onCandidate: (value: string) => void;
  onAssign: () => void;
  assignPending: boolean;
  onUnassign: (assignmentId: string) => void;
}) {
  const full = assignments.length >= post.need;
  const binding = event.passportBinding;
  return (
    <section className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {post.sector} · {post.post}
          </p>
          <p className="text-xs text-muted-foreground">
            потребность: {post.need}
            {post.minRating !== null ? ` · мин. рейтинг: ${post.minRating}` : ""}
          </p>
        </div>
        <span
          className={
            full
              ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
              : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
          }
        >
          {full
            ? "Укомплектован"
            : `Назначено ${assignments.length} из ${post.need}`}
        </span>
      </div>

      {post.requirements !== "" && (
        <p className="mb-2 text-xs">
          <span className="font-semibold text-muted-foreground">
            Требования поста:{" "}
          </span>
          {post.requirements}
        </p>
      )}
      {post.task !== "" && (
        <p className="mb-2 text-xs">
          <span className="font-semibold text-muted-foreground">
            Задача поста:{" "}
          </span>
          {post.task}
        </p>
      )}
      {/* Паспорт открывается ровно той версией, к которой привязано ОМ, —
          не действующей: согласованный расчёт не переписывается публикацией
          новой редакции (entities/security-event: PassportBinding). */}
      {binding !== null && (
        <Link
          href={`/security-ops/objects/${binding.objectId}/passports/${binding.versionId}`}
          className="mb-3 inline-block text-xs font-semibold text-primary"
        >
          Паспорт поста (версия {binding.versionNumber}) →
        </Link>
      )}

      {assignments.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">Пост не укомплектован.</p>
      ) : (
        <ul className="mb-2 flex flex-col gap-1">
          {assignments.map((assignment) => {
            const rating = ratingOf(assignment.employeeId);
            return (
              <li key={assignment.id} className="flex items-center gap-2 text-sm">
                <span>{assignment.employeeName}</span>
                {rating !== null && (
                  <span
                    className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                    title="Оперативный рейтинг сотрудника"
                  >
                    {rating}
                  </span>
                )}
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
                  onClick={() => onUnassign(assignment.id)}
                >
                  Снять
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Кандидат: ${post.post}`}
          className="h-8 min-w-56 rounded-md border border-input bg-background px-2 text-xs"
          value={candidate}
          onChange={(e) => onCandidate(e.target.value)}
        >
          <option value="">— выберите сотрудника —</option>
          {roster.map((person) => {
            const rating = ratingOf(person.id);
            return (
              <option key={person.id} value={person.id}>
                {person.name} · {person.rankLabel} · {person.unit}
                {rating !== null ? ` · рейтинг ${rating}` : ""}
                {assignedEmployeeIds.has(person.id) ? " — уже назначен" : ""}
              </option>
            );
          })}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={candidate === "" || assignPending}
          onClick={onAssign}
        >
          Назначить
        </Button>
      </div>
    </section>
  );
}
