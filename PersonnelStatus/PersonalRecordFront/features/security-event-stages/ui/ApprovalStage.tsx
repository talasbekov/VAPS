"use client";

import { X } from "lucide-react";

// Этап 6 «Согласование»: утверждение расстановки (сразу открывает
// «Ознакомление») либо возврат на доработку с обязательной причиной.
//
// Компоновка — из прототипа Smart Josparlau (экран «Согласование
// расстановки»): сводка сверху, расчёт по секторам, отдельный блок с тем, что
// согласующий обязан увидеть до решения, и решение внизу.
//
// Чего из прототипа НЕТ и почему:
//
// * МАРШРУТ СОГЛАСОВАНИЯ (несколько согласующих по порядку, «отправить/
//   отозвать», решение по каждому) — модели согласующих у бэка нет вовсе:
//   ручка одна, решение принимает тот, кто открыл этап. Нарисовать список с
//   порядком и статусами значило бы изобразить процесс, которого не
//   существует;
// * ЭЦП и «расстановка изменена — нужно повторное согласование»: подписи и
//   версий расстановки бэк не хранит, отличить изменённую от согласованной
//   нечем;
// * «КОНФЛИКТЫ ТЕКУЩЕЙ РАССТАНОВКИ» отдельной таблицей: поле conflictsCount
//   заводится нулём и НИКОГДА не пересчитывается — таблица из него всегда
//   говорила бы «конфликтов не выявлено», то есть врала бы уверенно. Вместо
//   него показано то, что бэк действительно записывает: обходы мягкого
//   предупреждения по рейтингу с причиной, введённой при назначении.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useAddApprover,
  useApprovePlacement,
  useDecideApprover,
  useRemoveApprover,
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
  const postLabel = (postId: string): string => {
    const post = postById.get(postId);
    return post ? `${post.sector} · ${post.post}` : postId;
  };

  const totalNeed = event.reconSectorPosts.reduce(
    (sum, post) => sum + post.need,
    0
  );
  const understaffed = event.reconSectorPosts.filter(
    (post) =>
      event.placementAssignments.filter((a) => a.postId === post.id).length <
      post.need
  ).length;
  const overrides = event.placementAssignments.filter(
    (a) => a.ratingOverrideReason !== null
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Согласование расстановки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {event.approvalStatus === "RETURNED" && event.approvalComment !== "" && (
          <Alert>
            <AlertDescription>
              Прошлый возврат: {event.approvalComment}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-4 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Kpi value={String(event.reconSectorPosts.length)} label="постов" />
          <Kpi
            value={`${event.placementAssignments.length} / ${totalNeed}`}
            label="назначено / потребность"
          />
          <Kpi
            value={String(understaffed)}
            label="не укомплектовано"
            alarming={understaffed > 0}
          />
          <Kpi
            value={String(overrides.length)}
            label="обходов предупреждений"
            alarming={overrides.length > 0}
          />
          <Kpi value={event.updatedAt} label="обновлено" />
        </div>

        <ApprovalRoute event={event} />

        <section>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            Расчёт на согласование
          </p>
          {event.placementAssignments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Назначений нет.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {event.placementAssignments.map((assignment) => (
                <li key={assignment.id} className="rounded-md border p-2.5 text-sm">
                  <span className="font-semibold">{assignment.employeeName}</span>{" "}
                  <span className="text-muted-foreground">
                    — {postLabel(assignment.postId)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Обходы предупреждений — то, ради чего согласующий и смотрит расчёт:
            назначения, прошедшие мимо требования поста к рейтингу. */}
        <section>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            Обходы предупреждений при назначении
          </p>
          {overrides.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Обходов не было — все назначения прошли без предупреждений.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {overrides.map((assignment) => (
                <li
                  key={assignment.id}
                  className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm"
                >
                  <span className="font-semibold">{assignment.employeeName}</span>{" "}
                  <span className="text-muted-foreground">
                    — {postLabel(assignment.postId)}
                  </span>
                  <p className="text-xs text-amber-800">
                    Обоснование: {assignment.ratingOverrideReason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

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

function Kpi({
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

const APPROVER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Ожидает решения",
  APPROVED: "Согласовано",
  RETURNED: "Возвращено",
};

/**
 * Маршрут согласования из прототипа: кто согласует, в каком порядке и с каким
 * решением. Порядок — позиция в списке, номер строки её и показывает.
 */
function ApprovalRoute({ event }: { event: SecurityEvent }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [position, setPosition] = useState("");
  const [returnFor, setReturnFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const add = useAddApprover(event.id, {
    onEvent: () => {
      setAdding(false);
      setName("");
      setUnit("");
      setPosition("");
    },
  });
  const remove = useRemoveApprover(event.id);
  // Детали 400 показываем полем: без onFormError пользователь видел бы только
  // общее «Проверьте заполнение формы», а причина отказа («укажите причину
  // возврата») оставалась бы в ответе сервера.
  const [decideErrors, setDecideErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const decide = useDecideApprover(event.id, {
    onFormError: (details) => setDecideErrors(details),
    onEvent: () => {
      setReturnFor(null);
      setReason("");
      setDecideErrors(null);
    },
  });

  return (
    <section className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs font-semibold">Маршрут согласования</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding((prev) => !prev)}
        >
          + Добавить согласующего
        </Button>
      </div>

      {adding && (
        <div className="flex flex-wrap gap-2 border-b p-2">
          <Input
            className="h-8 w-48 text-xs"
            placeholder="ФИО"
            aria-label="ФИО согласующего"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            className="h-8 w-44 text-xs"
            placeholder="Подразделение"
            aria-label="Подразделение согласующего"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <Input
            className="h-8 w-40 text-xs"
            placeholder="Должность"
            aria-label="Должность согласующего"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={add.isPending}
            onClick={() => add.mutate({ name, unit, position })}
          >
            Добавить
          </Button>
        </div>
      )}

      {event.approvalRoute.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Маршрут пуст — согласующие не назначены.
        </p>
      ) : (
        <ul className="divide-y">
          {event.approvalRoute.map((approver, index) => (
            <li key={approver.id} className="space-y-1 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="font-semibold">{approver.name}</span>
                <span className="text-xs text-muted-foreground">
                  {approver.unit}
                  {approver.position === "" ? "" : ` · ${approver.position}`}
                </span>
                <span
                  className={
                    approver.status === "APPROVED"
                      ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
                      : approver.status === "RETURNED"
                        ? "inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800"
                        : "inline-flex rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold"
                  }
                >
                  {APPROVER_STATUS_LABEL[approver.status]}
                </span>
                {approver.decidedAt !== null && (
                  <span className="text-xs text-muted-foreground">
                    {approver.decidedAt}
                  </span>
                )}
                {approver.status === "PENDING" && (
                  <span className="ml-auto flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          approverId: approver.id,
                          decision: "APPROVED",
                          comment: "",
                        })
                      }
                    >
                      Согласовать
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setReturnFor((prev) =>
                          prev === approver.id ? null : approver.id
                        )
                      }
                    >
                      Вернуть
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Снять согласующего ${approver.name}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ approverId: approver.id })}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                )}
              </div>
              {approver.comment !== "" && (
                <p className="pl-7 text-xs text-muted-foreground">
                  {approver.comment}
                </p>
              )}
              {returnFor === approver.id && (
                <div className="flex flex-wrap gap-2 pl-7">
                  <Input
                    className="h-8 w-72 text-xs"
                    placeholder="Укажите, что необходимо исправить"
                    aria-label={`Причина возврата: ${approver.name}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        approverId: approver.id,
                        decision: "RETURNED",
                        comment: reason,
                      })
                    }
                  >
                    Подтвердить возврат
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <FieldErrors errors={decideErrors} />
      <StageError error={add.error} />
      <StageError error={remove.error} />
      <StageError error={decide.error} />
    </section>
  );
}
