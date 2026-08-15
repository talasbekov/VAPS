"use client";

// Архив дела — read-only разбор закрытого ОМ: сводка, итоги направлений,
// бюллетень, расчёты и заявки, расстановка снимком, замены, журнал штаба и
// сводка оценивания. Собран по экрану прототипа «Архив дела»: будущий старший
// наряда открывает дело, чтобы понять, какие силы привлекались, кто стоял,
// какие были инциденты и решения.
//
// Отдельного маршрута у архива нет намеренно: закрытое дело — это карточка ОМ
// на стадии «Закрыто», и второй адрес показывал бы ровно то же самое.
//
// Чего из прототипа НЕТ: «все версии расстановки» (версий у расстановки не
// существует — бэк хранит один действующий состав) и оценочные показатели
// «средняя оценка / распределение / благодарности». Последние невыводимы не
// по лени: сама оценка за мероприятие наружу не едет ни одним полем (§19.2),
// а `aggregateRating` в реестре — агрегат СОТРУДНИКА за период политики, а не
// его оценка за это ОМ. Среднее по нему было бы другой величиной под чужой
// подписью.
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JOURNAL_TYPE_LABEL } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useEvaluationRegistry } from "@/hooks/use-ops-ratings";
import { EMPTY_FILTERS } from "@/entities/operational-rating";
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
          <CardTitle>Карточка, бюллетень, программа</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Fact label="Дата проведения" value={event.businessDate} />
          <Fact label="Объект" value={event.objectName} />
          <Fact
            label="Краткое описание"
            value={event.briefDescription === "" ? "—" : event.briefDescription}
          />
          <Fact
            label="Первичные задачи"
            value={event.initialTasks === "" ? "—" : event.initialTasks}
          />
          {event.passportBinding === null ? (
            <p className="text-xs text-muted-foreground">
              Паспорт объекта к делу не привязан.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Паспорт объекта сохранён на момент мероприятия —{" "}
              <Link
                href={`/security-ops/objects/${event.passportBinding.objectId}/passports/${event.passportBinding.versionId}`}
                className="font-semibold text-primary"
              >
                версия {event.passportBinding.versionNumber}
              </Link>{" "}
              (действует с {event.passportBinding.effectiveFrom}). Публикация
              новой редакции этот снимок не переписывает.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Расчёты и заявки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {event.demandRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Потребность не заводилась.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {event.demandRows.map((row) => (
                <li key={row.id} className="rounded-md border p-2.5 text-sm">
                  <span className="font-semibold">
                    {row.sector} · {row.task}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {row.need} чел., смена {row.shift}, группа «{row.group}»
                  </span>
                </li>
              ))}
            </ul>
          )}
          {event.forceRequests.length > 0 && (
            <ul className="flex flex-col gap-1">
              {event.forceRequests.map((request) => (
                <li key={request.id} className="text-sm">
                  <span className="font-semibold">{request.group}</span>{" "}
                  <span className="tabular-nums text-muted-foreground">
                    — выделено {request.allocatedCount} из {request.requestedCount}
                  </span>
                </li>
              ))}
            </ul>
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
          <CardTitle>Изменения и замены</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const replacements = event.journalEntries.filter(
              (entry) => entry.type === "REPLACEMENT"
            );
            if (replacements.length === 0) {
              return (
                <p className="text-xs text-muted-foreground">
                  Замен по ходу мероприятия не было.
                </p>
              );
            }
            return (
              <ul className="flex flex-col gap-1.5">
                {replacements.map((entry) => (
                  <li key={entry.id} className="rounded-md border p-2.5 text-sm">
                    <span className="font-semibold">{entry.title}</span>
                    <span className="text-muted-foreground"> — {entry.description}</span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({JOURNAL_TYPE_LABEL[entry.type]}, {entry.createdAt})
                    </span>
                  </li>
                ))}
              </ul>
            );
          })()}
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

      <EvaluationsSection event={event} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-xs font-semibold text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </p>
  );
}

/**
 * Сводка оценивания по делу. Считается по строкам реестра оценок этого ОМ —
 * тем, что контракт действительно отдаёт: сколько участников оценено, чем
 * (вручную или системной подстановкой), сколько записей исправлено. Значений
 * оценок здесь нет и быть не может (§19.2).
 */
function EvaluationsSection({ event }: { event: SecurityEvent }) {
  const { hasPermission } = useOpsPermissions();
  const canView = hasPermission("rating.view_aggregate");
  const registry = useEvaluationRegistry({
    ...EMPTY_FILTERS,
    event: canView ? event.code : null,
  });

  if (!canView) return null;

  const rows = registry.data?.results ?? [];
  const manual = rows.filter((row) => row.method === "MANUAL").length;
  const systemDefault = rows.filter(
    (row) => row.method === "SYSTEM_DEFAULT"
  ).length;
  const corrected = rows.filter((row) => row.corrected).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Оценки участников</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {registry.isLoading ? (
          <p className="text-xs text-muted-foreground">Загрузка реестра оценок…</p>
        ) : registry.isError ? (
          <p className="text-xs text-destructive">
            Реестр оценок недоступен.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{registry.data?.total ?? 0}</b>
              <span className="text-muted-foreground">оценено</span>
            </span>
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{manual}</b>
              <span className="text-muted-foreground">вручную</span>
            </span>
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{systemDefault}</b>
              <span className="text-muted-foreground">системной подстановкой</span>
            </span>
            <span className="flex items-baseline gap-1">
              <b className="text-sm tabular-nums">{corrected}</b>
              <span className="text-muted-foreground">исправлено</span>
            </span>
          </div>
        )}
        <Link
          href={`/security-ops/ratings/evaluations?event=${encodeURIComponent(event.code)}`}
          className="inline-block text-xs font-semibold text-primary"
        >
          Итоговые оценки участников ОМ →
        </Link>
      </CardContent>
    </Card>
  );
}
