"use client";

import { Check } from "lucide-react";

// Этап 7 «Ознакомление»: каждый назначенный подтверждает прочтение; этап
// завершается только когда подтвердили все (правило бэка, не экрана).
//
// Компоновка — «экран старшего объекта» из прототипа Smart Josparlau: полоса
// готовности, счётчик и список с состоянием по каждому. Добавлен фильтр
// «Ожидают»: на большом ОМ список назначений — сотни строк, и найти в нём
// оставшихся глазами нельзя, а именно они держат этап.
//
// Экран двухколоночный, как в прототипе: слева «Экран сотрудника» — своё
// назначение и подтверждение от первого лица, справа «Экран старшего
// объекта» — готовность по всем назначенным.
//
// Своё назначение опознаётся по ЖИВОЙ связи учётки с кадровой записью
// (`/api/ops/personnel/me/` → Employee.user). Сопоставление по ФИО отвергнуто:
// тёзка увидел бы чужое назначение как своё. Привязки может не быть — тогда
// колонка честно говорит, что учётка не привязана, а не молчит.
//
// Статуса «Недоступен» из прототипа нет: доступности сотрудника на дату в
// назначении не хранится. Кнопки «Уведомить повторно» нет: ручки повторного
// уведомления не существует.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAcknowledgePlacement,
  useCompleteAcknowledgement,
  usePersonnelMe,
} from "@/hooks/use-security-event-stages";
import type { SecurityEvent } from "@/entities/security-event";
import { StageError } from "./StageErrors";

type Scope = "all" | "pending";

export function AcknowledgementStage({ event }: { event: SecurityEvent }) {
  const acknowledge = useAcknowledgePlacement(event.id);
  const complete = useCompleteAcknowledgement(event.id);
  const [scope, setScope] = useState<Scope>("all");

  const me = usePersonnelMe();
  const assignments = event.placementAssignments;
  const acknowledgedCount = assignments.filter(
    (a) => a.acknowledgedAt !== null
  ).length;
  const pending = assignments.filter((a) => a.acknowledgedAt === null);
  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));
  const visible = scope === "pending" ? pending : assignments;
  const percent =
    assignments.length === 0
      ? 0
      : Math.round((acknowledgedCount / assignments.length) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Ознакомление ({acknowledgedCount}/{assignments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border p-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Экран сотрудника
          </p>
          <MyAssignment
            event={event}
            meId={me.data?.id ?? null}
            meFailed={me.isError}
            loading={me.isLoading}
            onAcknowledge={(assignmentId) => acknowledge.mutate({ assignmentId })}
            pending={acknowledge.isPending}
          />
        </section>

        <section className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground">
          Экран старшего объекта
        </p>
        <div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Готовность ознакомления"
          >
            <div
              className={percent === 100 ? "h-full bg-green-500" : "h-full bg-amber-500"}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending.length === 0
              ? "Подтвердили все назначенные."
              : `Ожидают подтверждения: ${pending.length}. Пока подтвердили не все, этап не завершится.`}
          </p>
        </div>

        {pending.length > 0 && (
          <div className="inline-flex gap-1 rounded-md bg-muted p-1">
            {(
              [
                ["all", `Все (${assignments.length})`],
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

        {visible.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {assignments.length === 0
              ? "Назначений нет — ознакамливаться некому."
              : "В этой выборке никого нет."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((assignment) => {
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
                    <span className="ml-auto inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
                      Подтверждено ({assignment.acknowledgedAt})
                    </span>
                  ) : (
                    <>
                      <span className="ml-auto inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        Ожидается
                      </span>
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
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

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
              : "Завершить этап и перейти далее"}
          </Button>
        </div>
        </section>
      </CardContent>
    </Card>
  );
}

/**
 * «Ваше назначение» — карточка от первого лица. Три честных исхода: учётка не
 * привязана к сотруднику, привязана но в этом ОМ не назначен, назначен —
 * тогда подтверждение доступно прямо здесь.
 */
function MyAssignment({
  event,
  meId,
  meFailed,
  loading,
  onAcknowledge,
  pending,
}: {
  event: SecurityEvent;
  meId: string | null;
  meFailed: boolean;
  loading: boolean;
  onAcknowledge: (assignmentId: string) => void;
  pending: boolean;
}) {
  if (loading) {
    return <p className="mt-2 text-xs text-muted-foreground">Загрузка…</p>;
  }
  if (meFailed || meId === null) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Учётная запись не привязана к сотруднику — своё назначение показать
        нечем.
      </p>
    );
  }
  const mine = event.placementAssignments.find((a) => a.employeeId === meId);
  if (mine === undefined) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Вы не назначены на это мероприятие.
      </p>
    );
  }
  const post = event.reconSectorPosts.find((p) => p.id === mine.postId);
  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm font-semibold">Ваше назначение · {event.code}</p>
      <dl className="space-y-1 text-xs">
        <Row label="Объект" value={event.objectName} />
        <Row
          label="Сектор / пост"
          value={post ? `${post.sector} · ${post.post}` : mine.postId}
        />
        <Row label="Дата" value={event.businessDate} />
        <Row label="Задача поста" value={post?.task === "" ? "—" : (post?.task ?? "—")} />
      </dl>
      {mine.acknowledgedAt !== null ? (
        <p className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
          Подтверждено ({mine.acknowledgedAt})
        </p>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => onAcknowledge(mine.id)}
        >
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Ознакомлен
        </Button>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
