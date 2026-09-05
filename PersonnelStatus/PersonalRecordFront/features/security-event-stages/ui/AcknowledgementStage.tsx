"use client";

// Этап 7 «Ознакомление» — экран старшего объекта по спецификации
// `[ОЗН-02]`…`[ОЗН-04]`, `[ОЗН-08]` (Plane №432, Ш-16 плана P2):
//
//  • шапка — «Ознакомились K из N · не подтвердили N · отказов N» и полоса
//    из трёх цветов (зелёный — подтвердил, красный — отказ, серый — ждёт);
//  • список НАЗНАЧЕННЫХ ПО СЕКТОРАМ И ПОСТАМ — так читает расстановку
//    старший, а плоский список на сотне строк не читается никем;
//  • у каждого — «Напомнить» (адресное уведомление ему и руководителям),
//    отказ красным с причиной и «Заменить →» тут же, на этапе 4 (замена
//    больше не ждёт «Проведения»);
//  • «Напомнить всем, кто не подтвердил» вместо кнопки «Отправить
//    уведомления» — рассылка при открытии этапа уходит сама (№402);
//  • «Завершить ознакомление» — активна, когда подтвердили все; иначе
//    подтверждение «K сотрудников не подтвердили. Завершить?» с
//    обязательным комментарием, который ложится в журнал мутаций.
//
// Панели «Экран сотрудника» на странице этапа больше нет (`[ОЗН-08]`):
// сотрудник отвечает со своей карточки в профиле (№405), а здесь — экран
// старшего. Отметка «Отметить ознакомление» за сотрудника осталась —
// «доведено лично» (`[ОЗН-05]`) старший подтверждает сам.
import { useMemo, useState } from "react";
import { Bell, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useAcknowledgePlacement,
  useCompleteAcknowledgement,
  useRemindAllPending,
  useRemindAssignment,
  useReplaceAssignment,
} from "@/hooks/use-security-event-stages";
import { PersonnelPicker } from "@/features/personnel-picker";
import { EVENT_MANAGE, useChainAccess } from "@/features/forces-split/ui/chain-access";
import type { PlacementAssignment, SecurityEvent } from "@/entities/security-event";
import { StageError } from "./StageErrors";
import { formatIsoDateTime } from "@/shared/lib/date";

type Scope = "all" | "pending";

type RowState = "confirmed" | "declined" | "pending";

function stateOf(a: PlacementAssignment): RowState {
  if (a.acknowledgedAt !== null) return "confirmed";
  if ((a.declinedAt ?? null) !== null) return "declined";
  return "pending";
}

export function AcknowledgementStage({ event }: { event: SecurityEvent }) {
  const access = useChainAccess();
  const acknowledge = useAcknowledgePlacement(event.id);
  const remindOne = useRemindAssignment(event.id);
  const remindAll = useRemindAllPending(event.id);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeComment, setCompleteComment] = useState("");
  const complete = useCompleteAcknowledgement(event.id);
  const [scope, setScope] = useState<Scope>("all");
  const [replacing, setReplacing] = useState<PlacementAssignment | null>(null);

  const assignments = event.placementAssignments;
  const confirmed = assignments.filter((a) => stateOf(a) === "confirmed");
  const declined = assignments.filter((a) => stateOf(a) === "declined");
  const pending = assignments.filter((a) => stateOf(a) === "pending");
  const total = assignments.length;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  // Группировка по секторам и постам — в порядке расчёта постов.
  const groups = useMemo(() => {
    const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));
    const rows = scope === "pending" ? pending : assignments;
    const bySector = new Map<string, Map<string, { post: string; rows: PlacementAssignment[] }>>();
    for (const a of rows) {
      const post = postById.get(a.postId);
      const sector = post?.sector ?? "Пост вне расчёта";
      const label = post?.post ?? a.postId;
      const posts = bySector.get(sector) ?? new Map();
      const bucket = posts.get(a.postId) ?? { post: label, rows: [] };
      bucket.rows.push(a);
      posts.set(a.postId, bucket);
      bySector.set(sector, posts);
    }
    return [...bySector.entries()].map(([sector, posts]) => ({
      sector,
      posts: [...posts.values()],
    }));
  }, [assignments, event.reconSectorPosts, pending, scope]);

  const canManage = access.can(EVENT_MANAGE);
  const allConfirmed = total > 0 && confirmed.length === total;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Ознакомление</CardTitle>
            {/* Шапка одной строкой (`[ОЗН-02]`) — без дублирующего «(K/N)». */}
            <p className="mt-1 text-sm text-muted-foreground" data-testid="ack-summary">
              {/* `[ОЗН-02]` (Plane №447): «Ознакомились K из N · не открыли M ·
                  отказов D · срок подтверждения ДД.ММ ЧЧ:ММ». «Открыл и не
                  нажал» система не различает (карточка №452) — считаем как
                  «не открыли». */}
              Ознакомились {confirmed.length} из {total} · не открыли {pending.length} · отказов{" "}
              {declined.length}
              {event.acknowledgementDeadline
                ? ` · срок подтверждения ${formatIsoDateTime(event.acknowledgementDeadline)}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={remindAll.isPending || pending.length === 0 || !canManage}
              title={
                !canManage
                  ? access.reason(EVENT_MANAGE) || undefined
                  : pending.length === 0
                    ? "Все подтвердили — напоминать некому"
                    : "Напомнить каждому, кто ещё не подтвердил, и их руководителям"
              }
              onClick={() => remindAll.mutate({})}
            >
              <Bell className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {remindAll.isPending ? "Отправка…" : `Напомнить всем, кто не подтвердил (${pending.length})`}
            </Button>
            <Button
              type="button"
              disabled={complete.isPending || !canManage || total === 0}
              title={access.reason(EVENT_MANAGE) || undefined}
              onClick={() =>
                allConfirmed ? complete.mutate({}) : setCompleteOpen(true)
              }
            >
              {complete.isPending ? "Завершение…" : "Завершить ознакомление"}
            </Button>
          </div>
        </div>

        {/* Полоса трёх цветов: подтвердил / отказ / ждёт (`[ОЗН-02]`). */}
        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct(confirmed.length)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Готовность ознакомления"
        >
          <div className="h-full bg-green-500" style={{ width: `${pct(confirmed.length)}%` }} data-segment="confirmed" />
          <div className="h-full bg-red-500" style={{ width: `${pct(declined.length)}%` }} data-segment="declined" />
          <div className="h-full bg-muted-foreground/30" style={{ width: `${pct(pending.length)}%` }} data-segment="pending" />
        </div>
        <p className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground" data-testid="ack-legend">
          <span><span className="inline-block h-2 w-2 rounded-full bg-green-500" /> подтвердил</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" /> не открывал</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> отказ</span>
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {pending.length > 0 && (
          <div className="inline-flex gap-1 rounded-md bg-muted p-1">
            {(
              [
                ["all", `Все (${total})`],
                ["pending", `Ожидают (${pending.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`rounded px-2.5 py-1 text-xs font-semibold ${
                  scope === value ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {total === 0
              ? "Назначений нет — ознакамливаться некому."
              : "В этой выборке никого нет."}
          </p>
        ) : (
          <div className="space-y-4" data-testid="ack-groups">
            {groups.map((group) => (
              <section key={group.sector} aria-label={`Сектор ${group.sector}`} className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                  {group.sector}
                </h3>
                {group.posts.map((bucket) => (
                  <div key={bucket.post} className="rounded-md border">
                    <p className="border-b bg-muted/40 px-2.5 py-1.5 text-xs font-semibold">
                      {bucket.post}
                    </p>
                    <ul className="divide-y">
                      {bucket.rows.map((assignment) => (
                        <AssignmentRow
                          key={assignment.id}
                          assignment={assignment}
                          canManage={canManage}
                          onAcknowledge={() => acknowledge.mutate({ assignmentId: assignment.id })}
                          onRemind={() => remindOne.mutate({ assignmentId: assignment.id })}
                          onReplace={() => setReplacing(assignment)}
                          busy={acknowledge.isPending || remindOne.isPending}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

        <StageError error={acknowledge.error} />
        <StageError error={remindOne.error} />
        <StageError error={remindAll.error} />
        <StageError error={complete.error} />

        {(remindOne.data ?? remindAll.data) !== undefined && (
          <p
            className={
              (remindOne.data ?? remindAll.data)!.unlinkedEmployeeIds.length > 0
                ? "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                : "rounded-md border px-3 py-2 text-xs text-muted-foreground"
            }
            data-testid="remind-report"
          >
            Напоминание отправлено: {(remindOne.data ?? remindAll.data)!.employees} заступающим и{" "}
            {(remindOne.data ?? remindAll.data)!.supervisors} руководителям.
            {(remindOne.data ?? remindAll.data)!.unlinkedEmployeeIds.length > 0 && (
              <>
                {" "}Не дошло до {(remindOne.data ?? remindAll.data)!.unlinkedEmployeeIds.length}:
                у их кадровых записей нет связанной учётной записи.
              </>
            )}
          </p>
        )}

        {replacing !== null && (
          <ReplaceInline
            event={event}
            assignment={replacing}
            onClose={() => setReplacing(null)}
          />
        )}
      </CardContent>

      {/* Подтверждение завершения при неподтвердивших (`[ОЗН-04]`). */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {total - confirmed.length} {peopleWord(total - confirmed.length)} не подтвердили. Завершить?
            </DialogTitle>
            <DialogDescription>
              Этап перейдёт на «Проведение» без их подтверждения. Комментарий
              обязателен — он ложится в журнал мутаций вместе с числом
              неподтвердивших.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ack-complete-comment">Комментарий</Label>
            <Textarea
              id="ack-complete-comment"
              rows={3}
              placeholder="Например: доведено устно на разводе"
              value={completeComment}
              onChange={(e) => setCompleteComment(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={completeComment.trim() === "" || complete.isPending}
              onClick={() => {
                void complete
                  .mutateAsync({ force: true, comment: completeComment.trim() })
                  .then(() => {
                    setCompleteOpen(false);
                    setCompleteComment("");
                  })
                  .catch(() => undefined);
              }}
            >
              Завершить без подтверждения всех
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AssignmentRow({
  assignment,
  canManage,
  onAcknowledge,
  onRemind,
  onReplace,
  busy,
}: {
  assignment: PlacementAssignment;
  canManage: boolean;
  onAcknowledge: () => void;
  onRemind: () => void;
  onReplace: () => void;
  busy: boolean;
}) {
  const state = stateOf(assignment);
  return (
    <li
      className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-sm"
      data-testid={`ack-row-${assignment.id}`}
      data-state={state}
    >
      <span className="font-semibold">{assignment.employeeName}</span>
      {assignment.divisionName !== "" && (
        <span className="text-xs text-muted-foreground">{assignment.divisionName}</span>
      )}
      {state === "confirmed" && (
        <span className="ml-auto inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
          Ознакомлен{assignment.acknowledgedVia === "personal" ? " лично" : ""}{" "}
          {formatIsoDateTime(assignment.acknowledgedAt ?? "")}
          {assignment.acknowledgedVia === "personal" && (assignment.acknowledgedBy ?? "") !== ""
            ? ` · ${assignment.acknowledgedBy}`
            : ""}
        </span>
      )}
      {state === "declined" && (
        <>
          <span
            className="ml-auto inline-flex max-w-[320px] rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800"
            title={assignment.declineReason ?? undefined}
          >
            <X className="mr-1 h-3 w-3" aria-hidden="true" />
            Не может заступить
            {assignment.declineReason ? `: ${assignment.declineReason}` : ""}
          </span>
          {/* 🔴 ЧЬИ ЭТО СЛОВА (Plane №588). Отказ читается как сказанное САМИМ
              сотрудником, а вписать его может и старший — гейт ручки пускает
              старшего и ведущего ОМ намеренно: человек может позвонить. Пока
              автора не было, чужая формулировка выдавалась за его собственную.
              Подпись стоит ОТДЕЛЬНОЙ строкой, а не внутри плашки: у плашки
              есть предел ширины, и длинная причина обрезала бы именно то, ради
              чего подпись добавлена.
              Показывается ТОЛЬКО когда записал не сам сотрудник: способ берётся
              полем `declinedVia`, а не сравнением подписи с фамилией — подписи
              приходят из разных источников и совпадают не всегда. */}
          {assignment.declinedVia === "personal" &&
            (assignment.declinedBy ?? "") !== "" && (
              <span className="text-[11px] text-muted-foreground">
                записал: {assignment.declinedBy}
              </span>
            )}
          <Button type="button" size="sm" variant="destructive" disabled={!canManage} onClick={onReplace}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Заменить →
          </Button>
        </>
      )}
      {state === "pending" && (
        <>
          <span className="ml-auto inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            Ожидается
            {(assignment.remindedAt ?? null) !== null &&
              ` · напомнили ${formatIsoDateTime(assignment.remindedAt ?? "")}`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !canManage}
            aria-label={`Напомнить: ${assignment.employeeName}`}
            onClick={onRemind}
          >
            <Bell className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Напомнить
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !canManage}
            title="Ознакомлен лично — доведено устно, отметка старшего"
            onClick={onAcknowledge}
          >
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Ознакомлен лично
          </Button>
        </>
      )}
    </li>
  );
}

/** Замена отказавшегося прямо на этапе (`[ОЗН-03]`): кого — задано строкой,
 * кем — подбор с поиском на сервере, причина — обязательна. */
function ReplaceInline({
  event,
  assignment,
  onClose,
}: {
  event: SecurityEvent;
  assignment: PlacementAssignment;
  onClose: () => void;
}) {
  const [incomingEmployeeId, setIncomingEmployeeId] = useState("");
  const [reasonCode, setReasonCode] = useState(
    assignment.declineReason ? `Отказ: ${assignment.declineReason}` : ""
  );
  const replace = useReplaceAssignment(event.id);
  const post = event.reconSectorPosts.find((p) => p.id === assignment.postId);
  return (
    <section
      aria-label="Замена отказавшегося"
      className="space-y-3 rounded-md border border-red-200 bg-red-50/40 p-3"
      data-testid="ack-replace"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm">
          Заменить <b>{assignment.employeeName}</b>
          {post ? ` на посту «${post.sector} · ${post.post}»` : ""}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть замену">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ack-replace-reason">Причина *</Label>
        <Input
          id="ack-replace-reason"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          placeholder="Например: болезнь"
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Кем заменить</p>
        <PersonnelPicker
          value={incomingEmployeeId === "" ? null : incomingEmployeeId}
          onPick={(id) => setIncomingEmployeeId((current) => (current === id ? "" : id))}
          pageSize={8}
          searchInputId="ack-replace-search"
        />
      </div>
      <StageError error={replace.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button
          type="button"
          disabled={replace.isPending || incomingEmployeeId === "" || reasonCode.trim() === ""}
          onClick={() => {
            void replace
              .mutateAsync({ assignmentId: assignment.id, incomingEmployeeId, reasonCode: reasonCode.trim() })
              .then(onClose)
              .catch(() => undefined);
          }}
        >
          {replace.isPending ? "Замена…" : "Заменить"}
        </Button>
      </div>
    </section>
  );
}

function peopleWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return "сотрудник";
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return "сотрудника";
  return "сотрудников";
}
